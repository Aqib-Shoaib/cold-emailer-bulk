import {
  ArrowRight,
  CalendarBlank,
  DownloadSimple,
  Envelope,
  FileText,
  Funnel,
  Info,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  ShieldCheck,
  UserPlus,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { countSelectableContacts } from "@/lib/contacts";
import { estimateSendMinutes } from "@/lib/scheduler";
import { getPrisma } from "@/lib/prisma";
import { SETTINGS_ROW_ID, toPublicSettings } from "@/lib/settings";
import { settingsValues } from "@/lib/settings";
import { SETTING_SECTIONS } from "@/lib/settings-schema";
import { appendBulkFooter, renderTemplate, TEMPLATE_VARIABLES, templateContext } from "@/lib/templates";
import { createUnsubscribeToken } from "@/lib/unsubscribe";
import { getStatistics, parseStatisticsFilters, rate } from "@/lib/statistics";
import { SettingsForm, type SettingsFeedback } from "./settings-form";
import { CsvImport } from "./csv-import";
import { AiDraftAssistant } from "./ai-draft-assistant";

const validViews = new Set([
  "dashboard",
  "contacts",
  "campaigns",
  "templates",
  "inbox",
  "knowledge",
  "users",
  "settings",
  "operations",
]);

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ view?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const segments = (await params).view;
  const view = segments?.[0] ?? "dashboard";
  if (segments && (segments.length !== 1 || !validViews.has(view))) notFound();

  const query = await searchParams;
  const single = (key: string) => {
    const value = query[key];
    return typeof value === "string" ? value : undefined;
  };

  switch (view) {
    case "settings":
      return (
        <SettingsView
          search={{
            notice: single("notice"),
            error: single("error"),
            detail: single("detail"),
            fields: single("fields"),
          }}
        />
      );
    case "users":
      return (
        <UsersView
          feedback={{ notice: single("notice"), error: single("error") }}
        />
      );
    case "contacts":
      return (
        <ContactsView
          search={{
            query: single("q"), status: single("status"), list: single("list"), page: single("page"),
            notice: single("notice"), error: single("error"), imported: single("imported"),
            duplicates: single("duplicates"), invalid: single("invalid"),
          }}
        />
      );
    case "templates":
      return (
        <TemplatesView search={{
          template: single("template"), status: single("status"), contactEmail: single("contactEmail"),
          campaignName: single("campaignName"), notice: single("notice"), error: single("error"), missing: single("missing"),
        }} />
      );
    case "campaigns":
      return <CampaignsView search={{ campaign: single("campaign"), notice: single("notice"), error: single("error") }} />;
    case "knowledge":
      return <KnowledgeView search={{ source: single("source"), notice: single("notice"), error: single("error") }} />;
    case "inbox":
      return <InboxView search={{ message: single("message"), query: single("q"), notice: single("notice"), error: single("error"), detail: single("detail"), count: single("count") }} />;
    case "operations":
      return <OperationsView search={{ notice: single("notice"), error: single("error") }} />;
    default:
      return <DashboardView search={{ from: single("from"), to: single("to"), campaign: single("campaign"), template: single("template"), list: single("list") }} />;
  }
}

/* ------------------------------ operations ------------------------------ */

async function OperationsView({ search }: { search: { notice?: string; error?: string } }) {
  const prisma = getPrisma();
  const now = new Date();
  const [services, heartbeat, failedJobs, audits, alerts, settings] = await Promise.all([
    prisma.serviceStatus.findMany(),
    prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } }),
    prisma.job.findMany({
      where: { status: "FAILED" },
      include: { campaign: { select: { name: true } }, recipient: { select: { email: true } }, emailMessage: { select: { status: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.auditEvent.findMany({
      where: { OR: [{ targetType: "Campaign" }, { targetType: "AppSettings" }, { targetType: "Job" }] },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.operationalAlert.findMany({ orderBy: { updatedAt: "desc" }, take: 30 }),
    prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } }),
  ]);
  const values = settingsValues(settings?.values);
  const service = (id: string, configured: boolean) => {
    const item = services.find((entry) => entry.id === id);
    return configured ? item ?? { state: "UNCHECKED", message: "Not checked yet.", checkedAt: null } : { state: "UNCONFIGURED", message: "Configure this service in Settings.", checkedAt: null };
  };
  const workerOnline = Boolean(heartbeat && now.getTime() - heartbeat.lastSeenAt.getTime() < 120_000);
  const cards = [
    { name: "Web", state: "OK", detail: "This page rendered successfully." },
    { name: "Database", state: "OK", detail: "Operational queries completed." },
    { name: "Worker", state: workerOnline ? "OK" : "ERROR", detail: heartbeat ? `Last heartbeat ${heartbeat.lastSeenAt.toLocaleString()}` : "No heartbeat recorded." },
    { name: "SMTP", ...service("smtp", Boolean(values.smtpHost && settings?.smtpPasswordEnc)), detail: service("smtp", Boolean(values.smtpHost && settings?.smtpPasswordEnc)).message },
    { name: "IMAP", ...service("imap", Boolean(values.imapHost && settings?.imapPasswordEnc)), detail: service("imap", Boolean(values.imapHost && settings?.imapPasswordEnc)).message },
    { name: "AI", ...service("ai", Boolean(settings?.aiApiKeyEnc)), detail: service("ai", Boolean(settings?.aiApiKeyEnc)).message },
  ];
  const feedback = search.notice === "retried" ? "The failed job was queued for a safe retry." : search.notice === "canceled" ? "The failed job was canceled." : search.error === "unsafe" ? "That job may already have been accepted, so retry is blocked to prevent a duplicate." : search.error ? "The job action could not be completed." : null;

  return <Page>
    <PageHeader title="Operations" description="Service health, failed delivery recovery, alerts, and administrative history." />
    {feedback ? <p role={search.error ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${search.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{feedback}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">{cards.map((card) => <Panel key={card.name} className="p-4 sm:p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{card.name}</p><div className="mt-3"><Status value={String(card.state).toLowerCase()} /></div><p className="mt-3 text-xs leading-5 text-[var(--muted)]">{card.detail || "Last check passed."}</p></Panel>)}</div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel className="p-0"><div className="p-5 sm:p-6"><SectionTitle title={`Failed jobs (${failedJobs.length})`} description="Only confirmed failures can be retried. Accepted and unknown outcomes stay blocked." /></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-y bg-[var(--surface-soft)] text-xs text-[var(--muted)]"><tr><Th>Recipient</Th><Th>Campaign</Th><Th>Outcome</Th><Th>Failure</Th><Th>Actions</Th></tr></thead><tbody>{failedJobs.map((job) => { const safe = !job.emailMessage || job.emailMessage.status === "FAILED"; return <tr key={job.id} className="border-b last:border-0"><Td>{job.recipient.email}</Td><Td>{job.campaign.name}</Td><Td><Status value={(job.emailMessage?.status ?? "not attempted").toLowerCase().replaceAll("_", " ")} /></Td><Td><p className="max-w-64 text-xs text-[var(--danger)]">{job.lastError || "No detail recorded."}</p></Td><Td><div className="flex gap-2">{safe ? <form action="/api/operations/retry" method="post"><input type="hidden" name="jobId" value={job.id} /><button className={buttonClass(true)} type="submit">Retry</button></form> : <span className="text-xs text-[var(--muted)]">Retry blocked</span>}<form action="/api/operations/cancel" method="post"><input type="hidden" name="jobId" value={job.id} /><button className={buttonClass(false)} type="submit">Cancel</button></form></div></Td></tr>})}{!failedJobs.length ? <tr><Td colSpan={5} className="py-10 text-center text-[var(--muted)]">No failed jobs.</Td></tr> : null}</tbody></table></div></Panel>
      <Panel><SectionTitle title="Operational alerts" description={`Email notifications go to ${values.notificationEmail || "no configured address"}. Cooldown: ${values.alertCooldownMinutes} minutes.`} /><div className="mt-5 space-y-3">{alerts.map((alert) => <div key={alert.id} className="rounded-xl bg-[var(--surface-soft)] p-4"><div className="flex items-center justify-between gap-3"><Status value={alert.active ? "active" : "resolved"} /><time className="text-xs text-[var(--muted)]">{alert.updatedAt.toLocaleString()}</time></div><p className="mt-2 text-sm font-semibold">{alert.kind}</p><p className="mt-1 text-xs text-[var(--muted)]">{alert.detail}</p></div>)}{!alerts.length ? <p className="text-sm text-[var(--muted)]">No operational alerts recorded.</p> : null}</div></Panel>
    </div>
    <Panel className="p-0"><div className="p-5 sm:p-6"><SectionTitle title="Campaign and settings audit" description="Recent administrative changes, including failed-job recovery actions." /></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-y bg-[var(--surface-soft)] text-xs text-[var(--muted)]"><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Target</Th></tr></thead><tbody>{audits.map((audit) => <tr key={audit.id} className="border-b last:border-0"><Td>{audit.createdAt.toLocaleString()}</Td><Td>{audit.actor?.name ?? "System"}</Td><Td>{audit.action}</Td><Td className="font-mono text-xs">{audit.targetType} {audit.targetId ?? ""}</Td></tr>)}</tbody></table></div></Panel>
  </Page>;
}

/* ------------------------------ settings ------------------------------ */

function parseSettingsFeedback({
  notice,
  error,
  detail,
  fields,
}: {
  notice?: string;
  error?: string;
  detail?: string;
  fields?: string;
}): SettingsFeedback {
  if (notice === "saved") return { kind: "saved", fields: [], detail: "" };
  if (error === "forbidden")
    return { kind: "forbidden", fields: [], detail: "" };
  if (error === "encryption")
    return { kind: "encryption", fields: [], detail: "" };
  if (error === "secret") return { kind: "secret", fields: [], detail: "" };
  if (error === "validation") {
    return {
      kind: "validation",
      fields: (fields ?? "").split(",").filter(Boolean),
      detail: "",
    };
  }
  if (error === "test")
    return { kind: "test", fields: [], detail: detail ?? "" };
  if (error === "smtp-failed" || error === "imap-failed") {
    return { kind: error, fields: [], detail: detail ?? "" };
  }
  if (notice === "smtp-ok") return { kind: "smtp-ok", fields: [], detail: "" };
  if (notice === "imap-ok") return { kind: "imap-ok", fields: [], detail: "" };
  return { kind: "none", fields: [], detail: "" };
}

async function SettingsView({
  search,
}: {
  search: { notice?: string; error?: string; detail?: string; fields?: string };
}) {
  const cookieStore = await cookies();
  const currentUser = await getSessionUser(
    cookieStore.get(SESSION_COOKIE)?.value,
  );
  if (!currentUser) return null;

  const prisma = getPrisma();
  const row = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ROW_ID },
  });
  const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
  const settings = toPublicSettings(
    row ?? {
      values: {},
      sendingPaused: true,
      sendingPausedReason: "Initial setup",
      updatedAt: new Date(),
    },
    {
      smtp_password_enc: row?.smtpPasswordEnc ?? null,
      imap_password_enc: row?.imapPasswordEnc ?? null,
      ai_api_key_enc: row?.aiApiKeyEnc ?? null,
    },
    encryptionKey,
  );

  const feedback = parseSettingsFeedback(search);
  const feedbackMessages: Partial<Record<SettingsFeedback["kind"], string>> = {
    saved: "Settings saved.",
    forbidden: "You cannot change settings.",
    encryption:
      "The server encryption key is missing; settings changes are disabled.",
    secret:
      "No password is configured yet for that connection. Save one first, then test.",
    test: "Enter the host and port before testing the connection.",
    "smtp-failed": feedback.detail || "The SMTP connection failed.",
    "imap-failed": feedback.detail || "The IMAP connection failed.",
    "smtp-ok": "The SMTP connection and sign-in succeeded.",
    "imap-ok": "The IMAP connection and sign-in succeeded.",
  };
  const validationMessage =
    feedback.kind === "validation"
      ? `Some values could not be saved. Check the highlighted sections (${feedback.fields.join(", ")}).`
      : null;

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Configure identity, delivery, safety, tracking, and alerts. Values are validated and secrets are stored encrypted."
      />
      {feedback.kind !== "none" ? (
        <p
          role={
            feedback.kind === "saved" || feedback.kind.endsWith("ok")
              ? "status"
              : "alert"
          }
          className={`rounded-xl px-4 py-3 text-sm ${feedback.kind === "saved" || feedback.kind.endsWith("ok") ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
        >
          {validationMessage ?? feedbackMessages[feedback.kind]}
        </p>
      ) : null}
      <SettingsForm
        sections={SETTING_SECTIONS}
        settings={settings}
        feedback={feedback}
      />
    </Page>
  );
}

/* ------------------------------ users ------------------------------ */

async function UsersView({
  feedback,
}: {
  feedback: { notice?: string; error?: string };
}) {
  const cookieStore = await cookies();
  const currentUser = await getSessionUser(
    cookieStore.get(SESSION_COOKIE)?.value,
  );
  if (!currentUser) return null;

  const users = await getPrisma().user.findMany({
    orderBy: { createdAt: "asc" },
  });
  const activeCount = users.filter((user) => user.active).length;
  const message = feedbackMessage(feedback);

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Admins share product access. Only the super admin can deactivate or delete users."
      />
      {message ? (
        <p
          role={feedback.error ? "alert" : "status"}
          className={`rounded-xl px-4 py-3 text-sm ${feedback.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}
        >
          {message}
        </p>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Panel className="p-0">
          <div className="p-5 sm:p-6">
            <SectionTitle
              title="Workspace users"
              description={`${activeCount} active ${activeCount === 1 ? "user can" : "users can"} access this workspace.`}
            />
          </div>
          <div className="border-t">
            {users.map((user) => (
              <UserRow
                key={user.id}
                id={user.id}
                name={user.name}
                email={user.email}
                role={user.role}
                active={user.active}
                canManage={
                  currentUser.role === "SUPER_ADMIN" && user.role === "ADMIN"
                }
              />
            ))}
          </div>
        </Panel>
        <div className="space-y-5">
          {currentUser.role === "SUPER_ADMIN" ? (
            <Panel>
              <SectionTitle
                title="Add an admin"
                description="Set an initial password and share it with the user yourself."
              />
              <form
                action="/api/users/create"
                method="post"
                className="mt-5 space-y-4"
              >
                <Field
                  label="Full name"
                  hint="Shown in activity and account menus"
                >
                  <input
                    className="input"
                    name="name"
                    minLength={2}
                    maxLength={120}
                    autoComplete="name"
                    placeholder="Enter full name"
                    required
                  />
                </Field>
                <Field label="Email address" hint="Used to sign in">
                  <input
                    className="input"
                    name="email"
                    type="email"
                    maxLength={320}
                    autoComplete="email"
                    placeholder="name@company.com"
                    required
                  />
                </Field>
                <Field label="Initial password" hint="Use 12 to 200 characters">
                  <input
                    className="input"
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={200}
                    autoComplete="new-password"
                    placeholder="Enter a secure password"
                    required
                  />
                </Field>
                <button
                  type="submit"
                  className={`${buttonClass(true)} w-full justify-center`}
                >
                  <UserPlus size={17} />
                  Create admin
                </button>
              </form>
            </Panel>
          ) : null}
          <Panel>
            <SectionTitle
              title="Your security"
              description="Change your password or sign out other browser sessions."
            />
            <form
              action="/api/account/change-password"
              method="post"
              className="mt-5 space-y-4"
            >
              <Field
                label="Current password"
                hint="Confirms this sensitive change"
              >
                <input
                  className="input"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Field label="New password" hint="Use 12 to 200 characters">
                <input
                  className="input"
                  name="newPassword"
                  type="password"
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field
                label="Confirm new password"
                hint="Enter the same new password again"
              >
                <input
                  className="input"
                  name="confirmation"
                  type="password"
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <button
                type="submit"
                className={`${buttonClass(true)} w-full justify-center`}
              >
                Change password
              </button>
            </form>
            <details className="mt-5 border-t pt-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Sign out other sessions
              </summary>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                This immediately signs your account out everywhere except this
                browser.
              </p>
              <form action="/api/account/revoke-sessions" method="post">
                <button type="submit" className={`${buttonClass(false)} mt-3`}>
                  Confirm sign out
                </button>
              </form>
            </details>
          </Panel>
        </div>
      </div>
    </Page>
  );
}

function feedbackMessage({
  notice,
  error,
}: {
  notice?: string;
  error?: string;
}) {
  if (error === "forbidden") return "Only the super admin can manage users.";
  if (error === "security")
    return "The security change could not be completed. Check the passwords and try again.";
  if (error === "invalid")
    return "The user change could not be completed. Check the details and try again.";
  if (notice === "created") return "Admin created successfully.";
  if (notice === "updated") return "Admin access updated.";
  if (notice === "deleted") return "Admin deleted permanently.";
  if (notice === "security-updated") return "Security settings updated.";
  return null;
}

function UserRow({
  id,
  name,
  email,
  role,
  active,
  canManage,
}: {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN";
  active: boolean;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0 sm:px-6">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-1 truncate text-xs text-[var(--muted)]">{email}</p>
      </div>
      <Status value={role === "SUPER_ADMIN" ? "Super admin" : "Admin"} />
      <span
        className={`text-xs ${active ? "text-[var(--accent-strong)]" : "text-[var(--danger)]"}`}
      >
        {active ? "Active" : "Inactive"}
      </span>
      {canManage ? (
        active ? (
          <details className="w-full rounded-xl bg-[var(--surface-soft)] p-3 sm:w-auto">
            <summary className="cursor-pointer text-xs font-semibold">
              Manage
            </summary>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Deactivation signs this user out immediately. Deletion is
              permanent.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action="/api/users/deactivate" method="post">
                <input type="hidden" name="userId" value={id} />
                <button type="submit" className={buttonClass(false)}>
                  Deactivate
                </button>
              </form>
              <form action="/api/users/delete" method="post">
                <input type="hidden" name="userId" value={id} />
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center rounded-xl border border-[var(--danger)] px-3.5 py-2 text-sm font-semibold text-[var(--danger)]"
                >
                  Delete permanently
                </button>
              </form>
            </div>
          </details>
        ) : (
          <form action="/api/users/activate" method="post">
            <input type="hidden" name="userId" value={id} />
            <button type="submit" className={buttonClass(false)}>
              Reactivate
            </button>
          </form>
        )
      ) : null}
    </div>
  );
}

/* ------------------------------ dashboard ------------------------------ */

async function DashboardView({ search }: { search: { from?: string; to?: string; campaign?: string; template?: string; list?: string } }) {
  const prisma = getPrisma();
  const filters = parseStatisticsFilters(search);
  const [stats, campaigns, templates, lists, recentCampaigns, recentReplies, settings, unread] = await Promise.all([
    getStatistics(filters),
    prisma.campaign.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.template.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.contactList.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.campaign.findMany({ include: { _count: { select: { emailMessages: { where: { smtpAcceptedAt: { not: null } } }, inboundMessages: { where: { kind: "REPLY" } } } } }, orderBy: { updatedAt: "desc" }, take: 5 }),
    prisma.inboundMessage.findMany({ where: { kind: "REPLY" }, include: { contact: { select: { firstName: true, lastName: true, company: true } } }, orderBy: { receivedAt: "desc" }, take: 5 }),
    prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } }),
    prisma.inboundMessage.count({ where: { readAt: null } }),
  ]);
  const values = settingsValues(settings?.values);
  const query = new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const metrics = [
    { label: "Queued jobs", value: stats.queued, note: "All jobs in the selected scope" },
    { label: "Send attempts", value: stats.attempted, note: `${stats.smtpAccepted.toLocaleString()} SMTP accepted (${rate(stats.smtpAccepted, stats.attempted)})` },
    { label: "Replies", value: stats.replied, note: `${rate(stats.replied, stats.acceptedRecipients)} of distinct accepted recipients` },
    { label: "Bounces", value: stats.bounced, note: `${rate(stats.bounced, stats.smtpAccepted)} of SMTP-accepted messages` },
    { label: "Unique opens", value: stats.opened, note: `${rate(stats.opened, stats.smtpAccepted)} of SMTP-accepted messages` },
    { label: "Unique clicks", value: stats.clicked, note: `${rate(stats.clicked, stats.smtpAccepted)} of SMTP-accepted messages` },
  ];

  return <Page>
    <PageHeader title="Delivery and response statistics" description="Stored facts only. SMTP acceptance does not guarantee inbox delivery." action={<PrimaryLink href="/campaigns"><Plus size={17} />New campaign</PrimaryLink>} />
    <Panel><form action="/dashboard" className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <label className="text-xs font-medium">From<input className="input mt-1" name="from" type="date" defaultValue={search.from} /></label>
      <label className="text-xs font-medium">Through<input className="input mt-1" name="to" type="date" defaultValue={search.to} /></label>
      <label className="text-xs font-medium">Campaign<select className="input mt-1" name="campaign" defaultValue={search.campaign ?? ""}><option value="">All campaigns</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-xs font-medium">Template<select className="input mt-1" name="template" defaultValue={search.template ?? ""}><option value="">All templates</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-xs font-medium">Contact list<select className="input mt-1" name="list" defaultValue={search.list ?? ""}><option value="">All lists</option>{lists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="flex items-end gap-2"><button className={buttonClass(true)} type="submit">Apply</button><Link className={buttonClass(false)} href={`/api/statistics/export?${query}`}>Export</Link></div>
    </form></Panel>
    <Panel className="overflow-hidden p-0"><div className="grid sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric, index) => <div key={metric.label} className={`px-5 py-5 sm:px-6 ${index ? "border-t sm:border-l" : ""}`}><p className="text-sm text-[var(--muted)]">{metric.label}</p><p className="mt-2 font-mono text-3xl font-semibold tracking-tight">{metric.value.toLocaleString()}</p><p className="mt-1.5 text-xs text-[var(--accent-strong)]">{metric.note}</p></div>)}</div></Panel>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <Panel className="p-0"><div className="flex items-center justify-between px-5 py-5 sm:px-6"><SectionTitle title="Recent campaigns" description="Latest audience and response activity." /><TextLink href="/campaigns">View all</TextLink></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-y bg-[var(--surface-soft)]/60 text-xs text-[var(--muted)]"><tr><Th>Campaign</Th><Th>Status</Th><Th>Audience</Th><Th>SMTP accepted</Th><Th>Replies</Th></tr></thead><tbody>{recentCampaigns.map((campaign) => <CampaignRow key={campaign.id} name={campaign.name} status={campaign.status.toLowerCase()} audience={campaign.audienceCount.toLocaleString()} sent={campaign._count.emailMessages.toLocaleString()} replies={campaign._count.inboundMessages.toLocaleString()} />)}{!recentCampaigns.length ? <tr><Td colSpan={5} className="py-8 text-center text-[var(--muted)]">No campaigns yet.</Td></tr> : null}</tbody></table></div></Panel>
      <Panel><SectionTitle title="Recent replies" description="Matched recipient responses." /><div className="mt-5 space-y-1">{recentReplies.map((reply) => { const name = [reply.contact?.firstName, reply.contact?.lastName].filter(Boolean).join(" ") || reply.fromName || reply.fromEmail; return <ReplyRow key={reply.id} initials={name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()} name={name} company={reply.contact?.company || reply.subject} time={reply.receivedAt.toLocaleString()} />; })}{!recentReplies.length ? <p className="text-sm text-[var(--muted)]">No matched replies yet.</p> : null}</div></Panel>
    </div>
    <Panel><SectionTitle title="Definitions and partial states" description="Rates use explicit denominators and never infer delivery." /><ul className="mt-4 grid gap-2 text-sm text-[var(--muted)] md:grid-cols-2"><li>Reply and unsubscribe rates: distinct recipients divided by distinct recipients with SMTP acceptance.</li><li>Open and click rates: unique tracked messages divided by SMTP-accepted messages.</li><li>Failed and UNKNOWN are attempted messages. UNKNOWN may have been accepted and is never retried automatically.</li><li>Open tracking is {values.openTrackingEnabled.toLowerCase()} and is distorted by privacy proxies and image blocking. Click tracking is {values.clickTrackingEnabled.toLowerCase()}.</li><li>{unread.toLocaleString()} unread inbound message{unread === 1 ? "" : "s"}. {settings?.sendingPaused ? `Sending is paused: ${settings.sendingPausedReason}` : "Sending is enabled within configured safeguards."}</li><li>{stats.unsubscribed.toLocaleString()} distinct accepted recipient{stats.unsubscribed === 1 ? "" : "s"} unsubscribed in this scope.</li></ul></Panel>
  </Page>;
}

async function ContactsView({
  search,
}: {
  search: { query?: string; status?: string; list?: string; page?: string; notice?: string; error?: string; imported?: string; duplicates?: string; invalid?: string };
}) {
  const query = search.query?.trim().slice(0, 100) ?? "";
  const status = search.status === "archived" ? "archived" : "active";
  const listId = search.list ?? "";
  const page = Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1);
  const pageSize = 50;
  const prisma = getPrisma();
  const where = {
    archivedAt: status === "archived" ? { not: null } : null,
    ...(listId ? { memberships: { some: { listId } } } : {}),
    ...(query ? {
      OR: ["email", "firstName", "lastName", "company", "title"].map((field) => ({
        [field]: { contains: query, mode: "insensitive" as const },
      })),
    } : {}),
  };
  const [contacts, filteredCount, activeCount, selectableCount, archivedCount, suppressionCount, lists, imports] = await Promise.all([
    prisma.contact.findMany({ where, include: { memberships: true, _count: { select: { emailMessages: true, inboundMessages: true, trackingEvents: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.contact.count({ where }),
    prisma.contact.count({ where: { archivedAt: null } }),
    countSelectableContacts(),
    prisma.contact.count({ where: { archivedAt: { not: null } } }),
    prisma.suppression.count(),
    prisma.contactList.findMany({ include: { _count: { select: { memberships: true } } }, orderBy: { name: "asc" } }),
    prisma.contactImport.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const suppressions = new Map(
    (await prisma.suppression.findMany({ where: { email: { in: contacts.map((contact) => contact.email) } } }))
      .map((suppression) => [suppression.email, suppression.reason]),
  );
  const message = search.error === "invalid"
    ? "The contact change could not be completed. Check the values and try again."
    : search.notice === "created"
      ? "Contact created."
      : search.notice === "list-created"
        ? "Contact list created."
        : search.notice === "imported"
          ? `Import complete: ${search.imported ?? "0"} added, ${search.duplicates ?? "0"} duplicates skipped, ${search.invalid ?? "0"} invalid.`
      : search.notice === "updated"
        ? "Contact updated."
        : null;
  const filters = new URLSearchParams();
  if (query) filters.set("q", query);
  filters.set("status", status);
  if (listId) filters.set("list", listId);
  const pageHref = (target: number) => {
    const params = new URLSearchParams(filters);
    params.set("page", String(target));
    return `/contacts?${params}`;
  };

  return (
    <Page>
      <PageHeader
        title="Contacts"
        description="Keep prospect data organized, clean, and safe to contact."
        action={<div className="flex flex-wrap gap-2"><Link className={buttonClass(false)} href={`/api/contacts/export?${filters}`}><DownloadSimple size={17} />Export filtered CSV</Link><PrimaryLink href="#add-contact"><UserPlus size={17} />Add contact</PrimaryLink></div>}
      />
      {message ? <p role={search.error ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${search.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{message}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr]">
        <MiniStat label="Active contacts" value={activeCount.toLocaleString()} note={`${selectableCount.toLocaleString()} eligible for campaigns after suppression checks`} />
        <MiniStat label="Archived contacts" value={archivedCount.toLocaleString()} note="Kept out of active workflows" />
        <Panel className="flex items-center justify-between gap-4 bg-[var(--danger-soft)]">
          <div>
            <p className="text-sm font-medium">Suppression list</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {suppressionCount.toLocaleString()} blocked {suppressionCount === 1 ? "address" : "addresses"}. Suppressions survive contact deletion.
            </p>
          </div>
        </Panel>
      </div>
      <Panel id="add-contact">
        <SectionTitle title="Add a contact" description="Email is required and stored in normalized lowercase form." />
        <form action="/api/contacts/create" method="post" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ContactField label="Email" name="email" type="email" maxLength={320} required />
          <ContactField label="First name" name="firstName" maxLength={120} />
          <ContactField label="Last name" name="lastName" maxLength={120} />
          <ContactField label="Company" name="company" maxLength={160} />
          <ContactField label="Job title" name="title" maxLength={160} />
          <ContactField label="Tags" name="tags" maxLength={500} placeholder="priority, logistics" />
          <label className="text-sm font-medium sm:col-span-2 xl:col-span-3">Custom fields (JSON object)<textarea className="input mt-2 min-h-24 font-mono text-xs" name="customFields" maxLength={10000} defaultValue="{}" /></label>
          <button type="submit" className={`${buttonClass(true)} justify-center sm:col-span-2 xl:col-span-3`}>Create contact</button>
        </form>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <SectionTitle title="Import CSV" description="Preview columns, choose their destination, and import valid rows without duplicating email addresses." />
          <CsvImport />
          {imports.length ? <div className="mt-5 border-t pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Recent imports</p><div className="mt-3 space-y-2">{imports.map((item) => <details key={item.id} className="rounded-xl bg-[var(--surface-soft)] p-3 text-xs"><summary className="cursor-pointer font-semibold">{item.fileName}: {item.importedCount} added, {item.duplicateCount} duplicates, {item.invalidCount} invalid</summary>{item.invalidCount ? <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--danger)]">{Array.isArray(item.errors) ? item.errors.slice(0, 20).map((error, index) => <li key={index}>{String(error)}</li>) : null}</ul> : <p className="mt-2 text-[var(--muted)]">Every row was valid.</p>}</details>)}</div></div> : null}
        </Panel>
        <Panel>
          <SectionTitle title="Contact lists" description="Lists organize contacts for filtering and later campaign audiences." />
          <form action="/api/contacts/create-list" method="post" className="mt-5 space-y-3">
            <ContactField label="List name" name="name" maxLength={160} required />
            <label className="block text-sm font-medium">Description<textarea className="input mt-2 min-h-20" name="description" maxLength={500} /></label>
            <button className={buttonClass(true)} type="submit"><Plus size={17} />Create list</button>
          </form>
          <div className="mt-5 space-y-2 border-t pt-4">{lists.map((list) => <div key={list.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-soft)] p-3"><div><Link className="text-sm font-semibold hover:underline" href={`/contacts?status=active&list=${list.id}`}>{list.name}</Link><p className="mt-1 text-xs text-[var(--muted)]">{list._count.memberships} contacts{list.description ? ` · ${list.description}` : ""}</p></div><details className="text-right"><summary className="cursor-pointer text-xs font-semibold text-[var(--danger)]">Delete</summary><p className="mt-2 max-w-48 text-xs text-[var(--muted)]">Deletes this list only; contacts remain.</p><form action="/api/contacts/delete-list" method="post" className="mt-2"><input type="hidden" name="listId" value={list.id} /><button className="text-xs font-semibold text-[var(--danger)]" type="submit">Confirm deletion</button></form></details></div>)}{!lists.length ? <p className="text-sm text-[var(--muted)]">No lists yet.</p> : null}</div>
        </Panel>
      </div>
      <Panel className="p-0">
        <form method="get" action="/contacts" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="relative flex-1">
            <MagnifyingGlass
              aria-hidden
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]"
            />
            <input
              aria-label="Search contacts"
              name="q"
              defaultValue={query}
              placeholder="Search name, company, or email"
              className="input pl-10"
            />
          </div>
          <select name="status" defaultValue={status} className="input sm:w-40" aria-label="Contact status">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <select name="list" defaultValue={listId} className="input sm:w-48" aria-label="Contact list"><option value="">All lists</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
          <button type="submit" className={buttonClass(false)}><Funnel size={17} />Apply</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-y bg-[var(--surface-soft)]/60 text-xs text-[var(--muted)]">
              <tr>
                <Th>Contact</Th>
                <Th>Company</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Tags</Th>
                <Th>Lists</Th>
                <Th>Last SMTP-accepted email</Th>
                <Th>Last received email</Th>
                <Th>Stored activity</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email;
                const suppression = suppressions.get(contact.email);
                return (
                <tr
                  key={contact.id}
                  className="border-b last:border-0 hover:bg-[var(--surface-soft)]/45"
                >
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={name} />
                      <div>
                        <p className="font-medium">{name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {contact.email}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>{contact.company || "—"}</Td>
                  <Td className="text-[var(--muted)]">{contact.title || "—"}</Td>
                  <Td>
                    <Status value={suppression ? "Suppressed" : contact.archivedAt ? "Archived" : "Active"} />
                    {suppression ? <p className="mt-1 max-w-40 text-xs text-[var(--danger)]">{suppressionExplanation(suppression)}</p> : null}
                  </Td>
                  <Td className="text-[var(--muted)]">{contact.tags.join(", ") || "—"}</Td>
                  <Td className="text-[var(--muted)]">{contact.memberships.map(({ listId: memberListId }) => lists.find(({ id }) => id === memberListId)?.name).filter(Boolean).join(", ") || "—"}</Td>
                  <Td className="text-[var(--muted)]">{contact.lastEmailAcceptedAt ? <><span className="block text-xs text-[var(--foreground)]">{contact.lastEmailSubject}</span><span className="mt-1 block text-xs">{contact.lastEmailAcceptedAt.toLocaleString()}</span></> : "—"}</Td>
                  <Td className="text-[var(--muted)]">{contact.lastEmailReceivedAt ? <><span className="block text-xs text-[var(--foreground)]">{contact.lastReceivedSubject}</span><span className="mt-1 block text-xs">{contact.lastEmailReceivedAt.toLocaleString()}</span></> : "—"}</Td>
                  <Td className="text-xs text-[var(--muted)]">{contact._count.emailMessages} outbound · {contact._count.inboundMessages} inbound · {contact._count.trackingEvents} tracked</Td>
                  <Td><ContactActions contact={contact} suppression={suppression} lists={lists} /></Td>
                </tr>
                );
              })}
              {contacts.length === 0 ? <tr><Td colSpan={10} className="py-10 text-center text-[var(--muted)]">No contacts match this view.</Td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-5 py-4 text-xs text-[var(--muted)]">
          <span>Showing {contacts.length ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + contacts.length}` : "0"} of {filteredCount.toLocaleString()}</span>
          <span className="flex gap-2">{page > 1 ? <Link className="font-semibold text-[var(--accent-strong)]" href={pageHref(page - 1)}>Previous</Link> : null}{page * pageSize < filteredCount ? <Link className="font-semibold text-[var(--accent-strong)]" href={pageHref(page + 1)}>Next</Link> : null}</span>
        </div>
      </Panel>
    </Page>
  );
}

function ContactField({ label, name, type = "text", ...props }: { label: string; name: string; type?: string; maxLength?: number; required?: boolean; placeholder?: string; defaultValue?: string }) {
  return <label className="text-sm font-medium">{label}<input className="input mt-2" name={name} type={type} {...props} /></label>;
}

function suppressionExplanation(reason: string) {
  return ({
    MANUAL: "Manually blocked by an admin",
    UNSUBSCRIBED: "Recipient unsubscribed",
    BOUNCED: "Address bounced",
    COMPLAINED: "Recipient reported spam",
  } as Record<string, string>)[reason] ?? "Blocked from campaigns";
}

function ContactActions({ contact, suppression, lists }: { contact: { id: string; email: string; firstName: string; lastName: string; company: string; title: string; tags: string[]; customFields: unknown; archivedAt: Date | null; memberships: { listId: string }[] }; suppression?: string; lists: { id: string; name: string }[] }) {
  const memberIds = new Set(contact.memberships.map(({ listId }) => listId));
  return (
    <details className="min-w-48 rounded-xl border bg-[var(--surface-raised)] p-3">
      <summary className="cursor-pointer text-xs font-semibold">Manage</summary>
      <form action="/api/contacts/update" method="post" className="mt-3 space-y-2">
        <input type="hidden" name="contactId" value={contact.id} />
        <ContactField label="Email" name="email" type="email" maxLength={320} required defaultValue={contact.email} />
        <ContactField label="First name" name="firstName" maxLength={120} defaultValue={contact.firstName} />
        <ContactField label="Last name" name="lastName" maxLength={120} defaultValue={contact.lastName} />
        <ContactField label="Company" name="company" maxLength={160} defaultValue={contact.company} />
        <ContactField label="Job title" name="title" maxLength={160} defaultValue={contact.title} />
        <ContactField label="Tags" name="tags" maxLength={500} defaultValue={contact.tags.join(", ")} />
        <label className="block text-sm font-medium">Custom fields<textarea className="input mt-2 min-h-24 font-mono text-xs" name="customFields" maxLength={10000} defaultValue={JSON.stringify(contact.customFields, null, 2)} /></label>
        <button type="submit" className={`${buttonClass(true)} w-full justify-center`}>Save</button>
      </form>
      {lists.length ? <div className="mt-3 border-t pt-3"><p className="text-xs font-semibold">List membership</p><div className="mt-2 space-y-2">{contact.memberships.map(({ listId }) => <form key={listId} action="/api/contacts/remove-list" method="post" className="flex items-center justify-between gap-2"><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="listId" value={listId} /><span className="text-xs text-[var(--muted)]">{lists.find(({ id }) => id === listId)?.name}</span><button className="text-xs font-semibold text-[var(--danger)]" type="submit">Remove</button></form>)}</div>{lists.some(({ id }) => !memberIds.has(id)) ? <form action="/api/contacts/add-list" method="post" className="mt-2 flex gap-2"><input type="hidden" name="contactId" value={contact.id} /><select className="input text-xs" name="listId" aria-label="Add to list">{lists.filter(({ id }) => !memberIds.has(id)).map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select><button className={buttonClass(false)} type="submit">Add</button></form> : null}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
        <form action={`/api/contacts/${contact.archivedAt ? "restore" : "archive"}`} method="post"><input type="hidden" name="contactId" value={contact.id} /><button className={buttonClass(false)} type="submit">{contact.archivedAt ? "Restore" : "Archive"}</button></form>
        <form action={`/api/contacts/${suppression === "MANUAL" ? "unsuppress" : "suppress"}`} method="post"><input type="hidden" name="contactId" value={contact.id} /><button className={buttonClass(false)} type="submit" disabled={Boolean(suppression && suppression !== "MANUAL")}>{suppression === "MANUAL" ? "Remove manual suppression" : "Suppress"}</button></form>
      </div>
      <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-xs font-semibold text-[var(--danger)]">Delete permanently</summary><p className="mt-2 text-xs text-[var(--muted)]">The contact is deleted, but any suppression remains.</p><form action="/api/contacts/delete" method="post"><input type="hidden" name="contactId" value={contact.id} /><button type="submit" className="mt-2 text-xs font-semibold text-[var(--danger)]">Confirm deletion</button></form></details>
    </details>
  );
}

async function CampaignsView({ search }: { search: { campaign?: string; notice?: string; error?: string } }) {
  const prisma = getPrisma();
  const [campaigns, lists, templates, settings, deliveryGroups, inboundGroups, trackingGroups, workers, recentMessages] = await Promise.all([
    prisma.campaign.findMany({
      include: {
        contactList: true,
        steps: { include: { template: true }, orderBy: { position: "asc" } },
        recipients: { take: 1, orderBy: { createdAt: "asc" } },
        _count: { select: { recipients: true, jobs: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.contactList.findMany({ include: { _count: { select: { memberships: true } } }, orderBy: { name: "asc" } }),
    prisma.template.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } }),
    prisma.emailMessage.groupBy({ by: ["campaignId", "status"], _count: true }),
    prisma.inboundMessage.groupBy({ by: ["campaignId", "kind"], where: { campaignId: { not: null } }, _count: true }),
    prisma.trackingEvent.groupBy({ by: ["campaignId", "type"], _count: true }),
    prisma.$queryRaw<Array<{ workerId: string; lastSeenAt: Date; online: boolean }>>`
      SELECT "worker_id" AS "workerId", "last_seen_at" AS "lastSeenAt",
             "last_seen_at" > CURRENT_TIMESTAMP - INTERVAL '30 seconds' AS "online"
      FROM "worker_heartbeats" ORDER BY "last_seen_at" DESC LIMIT 1
    `,
    prisma.emailMessage.findMany({ include: { campaign: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const values = settingsValues(settings?.values);
  const worker = workers[0];
  const message = search.error === "invalid"
    ? "The campaign change could not be completed. Check its values and current state."
    : search.error === "state"
      ? "That action is not available in the campaign's current state."
      : search.error === "config"
        ? "Complete sender identity, recipient source, SMTP credentials, public URL, and any required tracking notice in Settings before scheduling."
      : search.error === "audience"
        ? "The eligible audience is empty or exceeds the configured maximum. Review the campaign details."
        : search.error === "missing"
          ? "Review found contacts with missing template values. The affected addresses are listed on the campaign."
          : search.error === "schedule"
            ? `Choose a valid local start time at least ${values.minimumStartDelayMinutes} minutes from now.`
            : search.notice === "created"
              ? "Campaign draft created."
              : search.notice === "reviewed"
                ? "Audience snapshot reviewed and ready to schedule."
                : search.notice === "scheduled"
                  ? "Campaign scheduled. The worker will not send before its due time."
                  : search.notice === "updated"
                    ? "Campaign updated."
                    : null;
  const deliveryCount = (campaignId: string, status: string) => deliveryGroups.find((group) => group.campaignId === campaignId && group.status === status)?._count ?? 0;
  const inboundCount = (campaignId: string, kind: string) => inboundGroups.find((group) => group.campaignId === campaignId && group.kind === kind)?._count ?? 0;
  const trackingCount = (campaignId: string, type: string) => trackingGroups.find((group) => group.campaignId === campaignId && group.type === type)?._count ?? 0;
  const acceptedCount = (campaignId: string) => deliveryCount(campaignId, "SMTP_ACCEPTED") + deliveryCount(campaignId, "BOUNCED");
  const workerOnline = worker?.online ?? false;
  return (
    <Page>
      <PageHeader
        title="Campaigns"
        description="Plan outreach, review every audience, and control sending from one place."
        action={<PrimaryLink href="#new-campaign"><Plus size={17} />New campaign</PrimaryLink>}
      />
      {message ? <p role={search.error ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${search.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{message}</p> : null}
      <SafetyBanner paused={settings?.sendingPaused ?? true} reason={settings?.sendingPausedReason ?? "Initial setup"} />
      <div className="grid gap-4 sm:grid-cols-3">
        <MiniStat label="Campaigns" value={campaigns.length.toLocaleString()} note="Drafts and historical campaigns" />
        <MiniStat label="SMTP-accepted messages" value={deliveryGroups.filter(({ status }) => status === "SMTP_ACCEPTED" || status === "BOUNCED").reduce((sum, item) => sum + item._count, 0).toLocaleString()} note="Accepted by SMTP; some may later bounce" />
        <MiniStat label="Worker" value={workerOnline ? "Online" : "Offline"} note={worker ? `Last heartbeat ${worker.lastSeenAt.toLocaleString()}` : "No worker heartbeat recorded"} />
      </div>
      <Panel id="new-campaign">
        <SectionTitle title="New campaign draft" description="Choose a contact list and first template. Nothing is queued until review and scheduling are complete." />
        <form action="/api/campaigns/create" method="post" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <ContactField label="Campaign name" name="name" maxLength={160} required />
          <label className="text-sm font-medium">Contact list<select className="input mt-2" name="contactListId" required>{lists.map((list) => <option key={list.id} value={list.id}>{list.name} ({list._count.memberships})</option>)}</select></label>
          <label className="text-sm font-medium">First template<select className="input mt-2" name="templateId" required>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <ContactField label="Timezone" name="timezone" maxLength={64} required defaultValue={values.smtpTimezone} />
          <ContactField label="Daily cap" name="dailyCap" type="number" required defaultValue={values.defaultDailyCap} />
          <button className={`${buttonClass(true)} justify-center sm:col-span-2 xl:col-span-5`} type="submit" disabled={!lists.length || !templates.length}>Create draft</button>
        </form>
        {!lists.length || !templates.length ? <p className="mt-3 text-xs text-[var(--danger)]">Create at least one contact list and one active template first.</p> : null}
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        {campaigns.map((campaign) => (
          <Panel
            key={campaign.name}
            className="group hover:border-[var(--accent)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Status value={campaign.status.toLowerCase()} />
                <h2 className="mt-3 text-lg font-semibold tracking-tight">
                  {campaign.name}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {campaign.audienceCount.toLocaleString()} snapshotted recipients · {campaign.excludedCount.toLocaleString()} excluded
                </p>
              </div>
              <span className="text-xs text-[var(--muted)]">{campaign.contactList?.name ?? "Deleted list"}</span>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
              <CampaignFact
                icon={<CalendarBlank size={16} />}
                value={campaign.scheduledAt ? `${campaign.scheduledAt.toLocaleString()} (${campaign.timezone})` : "Not scheduled"}
              />
              <CampaignFact
                icon={<PaperPlaneTilt size={16} />}
                value={`${acceptedCount(campaign.id)} SMTP accepted`}
              />
              <CampaignFact
                icon={<Envelope size={16} />}
                value={`${deliveryCount(campaign.id, "UNKNOWN")} unknown · ${deliveryCount(campaign.id, "FAILED")} failed`}
              />
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">{deliveryCount(campaign.id, "BOUNCED")} bounced · {inboundCount(campaign.id, "REPLY")} replied · {trackingCount(campaign.id, "UNSUBSCRIBED")} unsubscribed · {trackingCount(campaign.id, "OPENED")} opened · {trackingCount(campaign.id, "CLICKED")} clicked</p>
            {campaign.audienceCount ? <p className="mt-4 text-xs text-[var(--muted)]">Estimated minimum window: about {estimateSendMinutes(campaign.audienceCount * campaign.steps.length, { batchMin: Number(values.smtpBatchMinSize), batchMax: Number(values.smtpBatchMaxSize), intervalMin: Number(values.smtpBatchIntervalMinMinutes), intervalMax: Number(values.smtpBatchIntervalMaxMinutes), perMinute: Number(values.smtpMaxPerMinute), perHour: Number(values.smtpMaxPerHour), globalDaily: Number(values.smtpMaxPerDay), campaignDaily: campaign.dailyCap })} minutes, before quiet hours or retries.</p> : null}
            <details className="mt-4 border-t pt-4" open={search.campaign === campaign.id}><summary className="cursor-pointer text-sm font-semibold text-[var(--accent-strong)]">Review and controls</summary>
              <ol className="mt-3 space-y-2">{campaign.steps.map((step) => <li key={step.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-soft)] p-3 text-xs"><span><strong>Step {step.position + 1}</strong> · {step.template.name} · {step.delayMinutes ? `${step.delayMinutes} minutes after start` : "At start"}</span>{campaign.status === "DRAFT" && step.position > 0 ? <form action="/api/campaigns/remove-step" method="post"><input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="stepId" value={step.id} /><button className="font-semibold text-[var(--danger)]" type="submit">Remove</button></form> : null}</li>)}</ol>
              {campaign.status === "DRAFT" ? <><form action="/api/campaigns/add-step" method="post" className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="campaignId" value={campaign.id} /><select className="input min-w-48 flex-1" name="templateId">{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><input className="input w-44" name="delayMinutes" type="number" min={(campaign.steps.at(-1)?.delayMinutes ?? 0) + 1} max={525600} placeholder="Minutes after start" required /><button className={buttonClass(false)} type="submit">Add follow-up</button></form><form action="/api/campaigns/review" method="post" className="mt-3"><input type="hidden" name="campaignId" value={campaign.id} /><button className={buttonClass(true)} type="submit">Snapshot and review audience</button></form></> : null}
              {Array.isArray(campaign.reviewErrors) && campaign.reviewErrors.length ? <details className="mt-3 rounded-xl bg-[var(--danger-soft)] p-3" open><summary className="cursor-pointer text-xs font-semibold text-[var(--danger)]">Review errors ({campaign.reviewErrors.length})</summary><ul className="mt-2 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-xs text-[var(--danger)]">{campaign.reviewErrors.map((error, index) => <li key={index}>{String(error)}</li>)}</ul></details> : null}
              {campaign.status === "REVIEW" ? <><form action="/api/campaigns/schedule" method="post" className="mt-3 space-y-2"><input type="hidden" name="campaignId" value={campaign.id} /><label className="block text-xs font-semibold">Start in {campaign.timezone}<input className="input mt-2" name="scheduledLocal" type="datetime-local" required /></label><button className={buttonClass(true)} type="submit">Schedule campaign</button></form>{campaign.recipients[0] && campaign.steps[0] ? <Link className="mt-3 inline-block text-xs font-semibold text-[var(--accent-strong)] hover:underline" href={`/templates?template=${campaign.steps[0].templateId}&contactEmail=${encodeURIComponent(campaign.recipients[0].email)}&campaignName=${encodeURIComponent(campaign.name)}`}>Preview or test the first recipient</Link> : null}</> : null}
              <div className="mt-4 flex flex-wrap gap-2">{campaign.status === "SCHEDULED" || campaign.status === "RUNNING" ? <form action="/api/campaigns/pause" method="post"><input type="hidden" name="campaignId" value={campaign.id} /><button className={buttonClass(false)} type="submit">Pause</button></form> : null}{campaign.status === "PAUSED" ? <form action="/api/campaigns/resume" method="post"><input type="hidden" name="campaignId" value={campaign.id} /><button className={buttonClass(true)} type="submit">Resume</button></form> : null}{!(["COMPLETED", "CANCELED"] as string[]).includes(campaign.status) ? <details className="rounded-xl border p-2"><summary className="cursor-pointer text-xs font-semibold text-[var(--danger)]">Cancel campaign</summary><p className="mt-2 max-w-64 text-xs text-[var(--muted)]">Pending messages are canceled. SMTP-accepted or currently delivering messages cannot be recalled.</p><form action="/api/campaigns/cancel" method="post" className="mt-2"><input type="hidden" name="campaignId" value={campaign.id} /><button className="text-xs font-semibold text-[var(--danger)]" type="submit">Confirm cancellation</button></form></details> : null}</div>
            </details>
          </Panel>
        ))}
        {!campaigns.length ? <Panel className="xl:col-span-2"><p className="text-sm text-[var(--muted)]">No campaigns yet.</p></Panel> : null}
      </div>
      <Panel className="p-0">
        <div className="p-5 sm:p-6"><SectionTitle title="Outbound message ledger" description="This records SMTP acceptance, not guaranteed inbox delivery. UNKNOWN messages are never retried automatically." /></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-y bg-[var(--surface-soft)] text-xs text-[var(--muted)]"><tr><Th>Recipient</Th><Th>Campaign</Th><Th>Subject</Th><Th>Status</Th><Th>SMTP accepted</Th><Th>Message-ID</Th></tr></thead><tbody>{recentMessages.map((email) => <tr key={email.id} className="border-b last:border-0"><Td>{email.toEmail}</Td><Td>{email.campaign.name}</Td><Td>{email.subject}</Td><Td><Status value={email.status.toLowerCase().replaceAll("_", " ")} />{email.lastError ? <p className="mt-1 max-w-72 text-xs text-[var(--danger)]">{email.lastError}</p> : null}</Td><Td>{email.smtpAcceptedAt?.toLocaleString() ?? "—"}</Td><Td className="font-mono text-xs text-[var(--muted)]">{email.messageId}</Td></tr>)}{!recentMessages.length ? <tr><Td colSpan={6} className="py-10 text-center text-[var(--muted)]">No outbound attempts yet.</Td></tr> : null}</tbody></table></div>
      </Panel>
    </Page>
  );
}

async function TemplatesView({
  search,
}: {
  search: { template?: string; status?: string; contactEmail?: string; campaignName?: string; notice?: string; error?: string; missing?: string };
}) {
  const prisma = getPrisma();
  const status = search.status === "archived" ? "archived" : "active";
  const templates = await prisma.template.findMany({
    where: { archivedAt: status === "archived" ? { not: null } : null },
    include: { versions: { orderBy: { version: "desc" } } },
    orderBy: { updatedAt: "desc" },
  });
  const selected = search.template ? await prisma.template.findUnique({ where: { id: search.template } }) : templates[0];
  const contactEmail = search.contactEmail?.trim().toLowerCase() ?? "";
  const contact = contactEmail ? await prisma.contact.findUnique({ where: { email: contactEmail } }) : null;
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const values = settingsValues(settings?.values);
  const campaignName = search.campaignName?.trim() || "Preview campaign";
  let preview = selected && contact
    ? renderTemplate(selected, templateContext({ contact, campaignName, senderName: values.senderDisplayName, senderCompany: values.companyName }))
    : null;
  let footerError = "";
  if (preview && contact) {
    try {
      preview = appendBulkFooter(preview, {
        senderName: values.senderDisplayName,
        companyName: values.companyName,
        physicalAddress: values.physicalAddress,
        footerText: values.unsubscribeFooter,
        unsubscribeUrl: `${values.publicBaseUrl.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(contact.email))}`,
      });
    } catch {
      footerError = "Bulk sending is blocked until sender identity, physical address, public URL, and the server session secret are configured.";
    }
  }
  const message = search.error === "invalid"
    ? "The template change could not be completed. Use only the documented variables and check the field limits."
    : search.error === "smtp"
      ? "The test email could not be sent. Complete the SMTP, sender identity, physical address, and public URL settings first."
      : search.error === "missing"
        ? `Test send blocked because these values are missing: ${search.missing ?? "required template data"}.`
        : search.notice === "created"
          ? "Template created."
          : search.notice === "updated"
            ? "Template updated."
            : search.notice === "test-sent"
              ? "Test email sent."
              : null;

  return (
    <Page>
      <PageHeader
        title="Templates"
        description="Create clear, reusable messages with safe personalization."
        action={<Link className={buttonClass(false)} href={`/templates?status=${status === "active" ? "archived" : "active"}`}>{status === "active" ? "View archived" : "View active"}</Link>}
      />
      {message ? <p role={search.error ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${search.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{message}</p> : null}
      <Panel>
        <SectionTitle title="Documented variables" description="Variables are case-insensitive. A missing value blocks scheduling and test delivery." />
        <div className="mt-4 flex flex-wrap gap-2">{TEMPLATE_VARIABLES.map((variable) => <code key={variable} className="rounded-lg bg-[var(--surface-soft)] px-2.5 py-1.5 text-xs">{`{{${variable}}}`}</code>)}</div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Panel>
          <SectionTitle title="New template" description="Write plain text; the safe HTML version is generated automatically." />
          <TemplateForm action="/api/templates/create" />
        </Panel>
        <Panel>
          <SectionTitle title="Preview and test" description="Preview uses the exact renderer used for SMTP test delivery." />
          <form action="/templates" method="get" className="mt-5 grid gap-3 sm:grid-cols-2">
            <select className="input" name="template" defaultValue={selected?.id} required aria-label="Template to preview">{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
            <input className="input" name="contactEmail" type="email" defaultValue={contactEmail} placeholder="Existing contact email" required />
            <input className="input" name="campaignName" defaultValue={campaignName} maxLength={160} placeholder="Campaign name" required />
            <button className={buttonClass(false)} type="submit">Preview</button>
          </form>
          {contactEmail && !contact ? <p role="alert" className="mt-4 text-sm text-[var(--danger)]">No contact has that email address.</p> : null}
          {preview ? <div className="mt-5 space-y-4"><div className="rounded-xl bg-[var(--surface-soft)] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Subject</p><p className="mt-2 text-sm font-semibold">{preview.subject}</p></div>{preview.missing.length ? <p role="alert" className="rounded-xl bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">Missing for {contact?.email}: {preview.missing.join(", ")}</p> : null}{footerError ? <p role="alert" className="rounded-xl bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning)]">{footerError}</p> : null}<iframe className="h-80 w-full rounded-xl border bg-white" sandbox="" title="Safe email preview" srcDoc={preview.html} /><details><summary className="cursor-pointer text-xs font-semibold">Plain-text preview</summary><pre className="mt-2 whitespace-pre-wrap rounded-xl bg-[var(--surface-soft)] p-4 text-xs">{preview.text}</pre></details>{contact && !preview.missing.length && !footerError ? <form action="/api/templates/test-send" method="post" className="grid gap-3 border-t pt-4 sm:grid-cols-2"><input type="hidden" name="templateId" value={selected?.id} /><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="campaignName" value={campaignName} /><input className="input" name="recipient" type="email" defaultValue={values.testRecipientAddress} placeholder="Test recipient email" required /><button className={buttonClass(true)} type="submit"><PaperPlaneTilt size={17} />Send test</button></form> : null}</div> : <p className="mt-5 text-sm text-[var(--muted)]">Choose a saved template and enter an existing contact email to preview personalization.</p>}
        </Panel>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((template) => (
          <Panel key={template.id} className="flex min-h-56 flex-col">
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <FileText size={20} />
              </span>
              <Status value={template.archivedAt ? "Archived" : `Version ${template.currentVersion}`} />
            </div>
            <h2 className="mt-5 text-lg font-semibold">{template.name}</h2>
            <p className="mt-2 rounded-xl bg-[var(--surface-soft)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
              Subject: {template.subject}
            </p>
            <details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm font-semibold text-[var(--accent-strong)]">Edit and manage</summary><TemplateForm action="/api/templates/update" template={template} /><div className="mt-4 flex flex-wrap gap-2 border-t pt-4"><form action="/api/templates/duplicate" method="post"><input type="hidden" name="templateId" value={template.id} /><button className={buttonClass(false)} type="submit">Duplicate</button></form><form action={`/api/templates/${template.archivedAt ? "restore" : "archive"}`} method="post"><input type="hidden" name="templateId" value={template.id} /><button className={buttonClass(false)} type="submit">{template.archivedAt ? "Restore" : "Archive"}</button></form></div><details className="mt-4"><summary className="cursor-pointer text-xs font-semibold">Version history ({template.versions.length})</summary><ol className="mt-2 space-y-2">{template.versions.map((version) => <li key={version.id} className="rounded-xl bg-[var(--surface-soft)] p-3 text-xs"><strong>Version {version.version}</strong> · {version.createdAt.toLocaleString()}<p className="mt-1 text-[var(--muted)]">{version.subject}</p></li>)}</ol></details></details>
          </Panel>
        ))}
        {!templates.length ? <Panel className="md:col-span-2"><p className="text-sm text-[var(--muted)]">No {status} templates.</p></Panel> : null}
      </div>
    </Page>
  );
}

function TemplateForm({ action, template }: { action: string; template?: { id: string; name: string; subject: string; textBody: string } }) {
  return <form action={action} method="post" className="mt-5 space-y-3">{template ? <input type="hidden" name="templateId" value={template.id} /> : null}<ContactField label="Template name" name="name" maxLength={160} required defaultValue={template?.name} /><ContactField label="Subject" name="subject" maxLength={300} required defaultValue={template?.subject} /><label className="block text-sm font-medium">Plain-text body<textarea className="input mt-2 min-h-52 font-mono text-sm" name="textBody" maxLength={100000} required defaultValue={template?.textBody} /></label><button className={`${buttonClass(true)} w-full justify-center`} type="submit">{template ? "Save new version" : "Create template"}</button></form>;
}

async function InboxView({ search }: { search: { message?: string; query?: string; notice?: string; error?: string; detail?: string; count?: string } }) {
  const prisma = getPrisma();
  const query = search.query?.trim() ?? "";
  const where = query ? { OR: [
    { subject: { contains: query, mode: "insensitive" as const } },
    { fromEmail: { contains: query, mode: "insensitive" as const } },
    { fromName: { contains: query, mode: "insensitive" as const } },
    { textBody: { contains: query, mode: "insensitive" as const } },
  ] } : {};
  const messages = await prisma.inboundMessage.findMany({
    where,
    select: { id: true, fromName: true, fromEmail: true, subject: true, textBody: true, receivedAt: true, readAt: true, kind: true },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });
  const selectedId = search.message && messages.some((message) => message.id === search.message) ? search.message : messages[0]?.id;
  const [selected, contacts, campaigns, syncState] = await Promise.all([
    selectedId ? prisma.inboundMessage.findUnique({
      where: { id: selectedId },
      include: {
        contact: { select: { id: true, email: true, firstName: true, lastName: true, company: true, lastRepliedAt: true } },
        campaign: { select: { id: true, name: true } },
        outboundMessage: { select: { subject: true, textBody: true, createdAt: true } },
        replies: { orderBy: { createdAt: "asc" }, include: { sentBy: { select: { name: true } } } },
      },
    }) : null,
    prisma.contact.findMany({ where: { archivedAt: null }, select: { id: true, email: true, firstName: true, lastName: true }, orderBy: { email: "asc" }, take: 1000 }),
    prisma.campaign.findMany({ select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.imapSyncState.findFirst({ orderBy: { updatedAt: "desc" } }),
  ]);
  const notice = search.notice === "synced" ? `Inbox synchronized (${search.count ?? "0"} new).`
    : search.notice === "replied" ? "Reply accepted by SMTP."
    : search.notice === "associated" ? "Message association saved."
    : search.notice === "read" ? "Marked as read."
    : search.notice === "unread" ? "Marked as unread."
    : "";
  const error = search.error === "sync" ? search.detail || "Inbox synchronization failed."
    : search.error === "smtp" ? "Configure SMTP before replying."
    : search.error === "send" ? search.detail || "The reply could not be sent."
    : search.error ? "The inbox action could not be completed." : "";

  return (
    <Page>
      <PageHeader
        title="Inbox"
        description="Read replies in context and stop follow-ups at the right moment."
        action={
          <form action="/api/inbox/sync" method="post"><SecondaryButton type="submit"><DownloadSimple size={17} />Sync now</SecondaryButton></form>
        }
      />
      {notice ? <div className="rounded-xl border border-[var(--success)]/30 bg-[var(--success-soft)] px-4 py-3 text-sm">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div> : null}
      {syncState ? <p className="text-xs text-[var(--muted)]">Last sync: {syncState.lastSyncedAt?.toLocaleString() ?? "never"}{syncState.lastError ? ` · Error: ${syncState.lastError}` : ""}</p> : null}
      <Panel className="grid min-h-[650px] overflow-hidden p-0 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-b lg:border-b-0 lg:border-r">
          <div className="border-b p-4">
            <form action="/inbox" className="relative">
              <MagnifyingGlass
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]"
              />
              <input
                aria-label="Search inbox"
                className="input pl-10"
                name="q"
                defaultValue={query}
                placeholder="Search conversations"
              />
            </form>
          </div>
          {messages.map((message) => <Link key={message.id} href={`/inbox?message=${message.id}${query ? `&q=${encodeURIComponent(query)}` : ""}`} className={`block border-b p-4 hover:bg-[var(--surface-soft)] ${message.id === selectedId ? "bg-[var(--accent-soft)]" : ""}`}>
            <span className="flex items-center justify-between gap-2"><span className={`truncate text-sm ${message.readAt ? "font-medium" : "font-bold"}`}>{message.fromName || message.fromEmail || "Unknown sender"}</span><time className="shrink-0 text-xs text-[var(--subtle)]">{message.receivedAt.toLocaleString()}</time></span>
            <span className="mt-1 flex items-center gap-2"><Status value={message.kind.toLowerCase().replaceAll("_", " ")} /><span className="truncate text-xs font-medium">{message.subject}</span></span>
            <span className="mt-1 block truncate text-xs text-[var(--muted)]">{message.textBody || "No readable body"}</span>
          </Link>)}
          {!messages.length ? <p className="p-6 text-sm text-[var(--muted)]">No synchronized messages{query ? " match this search" : " yet"}.</p> : null}
        </div>
        {selected ? <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5 sm:p-6">
            <div>
              <p className="text-xs font-medium text-[var(--accent-strong)]">
                {selected.kind.toLowerCase().replaceAll("_", " ")}
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {selected.subject}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {selected.fromName || selected.fromEmail}{selected.contact?.company ? `, ${selected.contact.company}` : ""}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">{selected.campaign ? `Campaign: ${selected.campaign.name}` : "No campaign associated"} · {selected.reviewReason}</p>
            </div>
            <form action={`/api/inbox/${selected.readAt ? "unread" : "read"}`} method="post"><input type="hidden" name="messageId" value={selected.id} /><SecondaryButton type="submit">Mark {selected.readAt ? "unread" : "read"}</SecondaryButton></form>
          </div>
          <div className="flex-1 space-y-6 p-5 sm:p-7">
            {selected.outboundMessage ? <Message sender="You" time={selected.outboundMessage.createdAt.toLocaleString()}><p className="whitespace-pre-wrap">{selected.outboundMessage.textBody}</p></Message> : null}
            <Message sender={selected.fromName || selected.fromEmail || "Unknown sender"} time={selected.receivedAt.toLocaleString()} incoming><p className="whitespace-pre-wrap">{selected.textBody || "No readable text body."}</p>{Array.isArray(selected.attachments) && selected.attachments.length ? <p className="mt-3 text-xs text-[var(--muted)]">{selected.attachments.length} attachment{selected.attachments.length === 1 ? "" : "s"} recorded.</p> : null}{selected.parseError ? <p className="mt-3 text-xs text-[var(--danger)]">Parsing warning: {selected.parseError}</p> : null}</Message>
            {selected.replies.map((reply) => <Message key={reply.id} sender={reply.sentBy?.name || "You"} time={reply.createdAt.toLocaleString()}><p className="whitespace-pre-wrap">{reply.textBody}</p><p className="mt-3 text-xs text-[var(--muted)]">{reply.status.toLowerCase().replaceAll("_", " ")}{reply.lastError ? ` · ${reply.lastError}` : ""}</p></Message>)}
          </div>
          <div className="space-y-5 border-t p-4 sm:p-5">
            <form action="/api/inbox/associate" method="post" className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="messageId" value={selected.id} /><label className="text-xs font-medium">Contact<select className="input mt-1" name="contactId" defaultValue={selected.contactId ?? ""}><option value="">Unmatched</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email} — {contact.email}</option>)}</select></label><label className="text-xs font-medium">Campaign<select className="input mt-1" name="campaignId" defaultValue={selected.campaignId ?? ""}><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><SecondaryButton type="submit" className="sm:col-span-2 justify-center">Save association</SecondaryButton></form>
            <form action="/api/inbox/reply" method="post"><input type="hidden" name="messageId" value={selected.id} /><label htmlFor="reply" className="text-sm font-medium">Reply</label><textarea id="reply" name="body" rows={4} maxLength={100000} required className="input mt-2 resize-none" placeholder="Write a helpful reply" /><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-[var(--muted)]">{selected.contact?.lastRepliedAt ? "Follow-ups are stopped for this contact." : "A matched reply stops pending follow-ups."}</p><PrimaryButton type="submit"><PaperPlaneTilt size={17} />Send reply</PrimaryButton></div></form>
          </div>
        </div> : <div className="grid place-items-center p-8 text-sm text-[var(--muted)]">Select a synchronized message.</div>}
      </Panel>
    </Page>
  );
}

async function KnowledgeView({ search }: { search: { source?: string; notice?: string; error?: string } }) {
  const prisma = getPrisma();
  const [sources, contacts, selected] = await Promise.all([
    prisma.knowledgeSource.findMany({ select: { id: true, name: true, type: true, fileName: true, extractionStatus: true, extractionError: true, processedAt: true, archivedAt: true, _count: { select: { chunks: true } } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.contact.findMany({ where: { archivedAt: null }, select: { id: true, email: true, firstName: true, lastName: true }, orderBy: { email: "asc" }, take: 500 }),
    search.source ? prisma.knowledgeSource.findUnique({ where: { id: search.source }, select: { id: true, type: true, extractedText: true } }) : null,
  ]);
  const feedback = search.error === "size" ? "The source exceeds the 20 MB limit."
    : search.error === "type" ? "Upload a PDF, DOC, DOCX, or TXT file."
    : search.error === "extraction" ? "The source was saved, but readable text could not be extracted. Review the error and reprocess it."
    : search.error ? "The source could not be saved. Check the fields and try again."
    : search.notice === "created" ? "Knowledge source added and indexed."
    : search.notice === "reprocessed" ? "Knowledge source extracted and indexed again."
    : search.notice ? "Knowledge source updated." : "";
  return (
    <Page>
      <PageHeader
        title="Knowledge"
        description="Give the draft assistant approved facts, language, and proof."
      />
      {feedback ? <p role={search.error ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${search.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{feedback}</p> : null}
      <Panel>
        <SectionTitle title="Add an approved source" description="Paste text or upload one PDF, Word document, or plain-text file up to 20 MB." />
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <form action="/api/knowledge/create" method="post" className="space-y-3 rounded-xl border p-4">
            <h3 className="font-semibold">Pasted text</h3>
            <label className="block text-sm font-medium">Source name<input className="input mt-2" name="name" required maxLength={160} /></label>
            <label className="block text-sm font-medium">Approved content<textarea className="input mt-2 h-auto resize-y py-3" name="content" rows={7} required maxLength={20 * 1024 * 1024} /></label>
            <PrimaryButton type="submit"><Plus size={17} />Add and index</PrimaryButton>
          </form>
          <form action="/api/knowledge/create" method="post" encType="multipart/form-data" className="space-y-3 rounded-xl border p-4">
            <h3 className="font-semibold">Document upload</h3>
            <label className="block text-sm font-medium">Source name<input className="input mt-2" name="name" required maxLength={160} /></label>
            <label className="block text-sm font-medium">File<input className="input mt-2 py-2" name="file" type="file" required accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" /></label>
            <p className="text-xs text-[var(--muted)]">Maximum 20 MB. Images and scanned documents without embedded text are rejected.</p>
            <PrimaryButton type="submit"><Plus size={17} />Upload and index</PrimaryButton>
          </form>
        </div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Panel className="p-0">
          <div className="flex items-center justify-between p-5 sm:p-6">
            <SectionTitle
              title="Sources"
              description="Only active sources can support AI drafts."
            />
          </div>
          <div className="border-t">
            {sources.map((source) => (
              <details key={source.id} open={selected?.id === source.id} className="border-b last:border-0">
                <summary className="cursor-pointer list-none"><SourceRow icon={<FileText size={19} />} name={source.name} detail={`${source.type.replaceAll("_", " ").toLocaleLowerCase()}${source.fileName ? ` · ${source.fileName}` : ""}, ${source._count.chunks} chunks · ${source.processedAt ? `processed ${source.processedAt.toLocaleString()}` : source.extractionError || "not processed"}`} status={source.archivedAt ? "Archived" : source.extractionStatus === "READY" ? "Ready" : "Failed"} /></summary>
                <div className="space-y-3 bg-[var(--surface-soft)] p-4">
                  {source.extractionError ? <p className="text-sm text-[var(--danger)]">{source.extractionError}</p> : null}
                  {selected?.id === source.id ? (
                    <form action="/api/knowledge/update" method="post" className="space-y-3">
                      <input type="hidden" name="sourceId" value={source.id} />
                      <label className="block text-sm font-medium">Source name<input className="input mt-2" name="name" required maxLength={160} defaultValue={source.name} /></label>
                      {source.type === "PASTED_TEXT" ? <label className="block text-sm font-medium">Approved content<textarea className="input mt-2 h-auto resize-y py-3" name="content" rows={8} required defaultValue={selected.extractedText} maxLength={20 * 1024 * 1024} /></label> : null}
                      <SecondaryButton type="submit">Save source</SecondaryButton>
                    </form>
                  ) : <Link className="text-sm font-semibold text-[var(--accent-strong)]" href={`/knowledge?source=${source.id}`}>Edit source</Link>}
                  <div className="flex flex-wrap gap-2">
                    <form action="/api/knowledge/reprocess" method="post"><input type="hidden" name="sourceId" value={source.id} /><SecondaryButton type="submit">Reprocess</SecondaryButton></form>
                    <form action={`/api/knowledge/${source.archivedAt ? "restore" : "archive"}`} method="post"><input type="hidden" name="sourceId" value={source.id} /><SecondaryButton type="submit">{source.archivedAt ? "Restore" : "Archive"}</SecondaryButton></form>
                  </div>
                </div>
              </details>
            ))}
            {!sources.length ? <p className="p-6 text-sm text-[var(--muted)]">No knowledge sources yet.</p> : null}
          </div>
        </Panel>
        <Panel>
          <SectionTitle title="Gemini draft assistant" description="Generate, compare, edit, and explicitly approve grounded templates." />
          <div className="mt-5"><AiDraftAssistant contacts={contacts.map((contact) => ({ id: contact.id, label: `${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email} — ${contact.email}` }))} /></div>
        </Panel>
      </div>
    </Page>
  );
}

/* ------------------------------ shared pieces ------------------------------ */

function Page({ children }: { children: ReactNode }) {
  return <div className="space-y-5 sm:space-y-6">{children}</div>;
}
function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
function Panel({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`min-w-0 rounded-2xl border bg-[var(--surface)] p-5 shadow-[0_12px_34px_rgba(31,54,42,0.045)] sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}
function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
    </div>
  );
}
function buttonClass(primary: boolean) {
  return `inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-semibold transition-transform active:translate-y-px ${primary ? "border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]" : "bg-[var(--surface-raised)] text-[var(--foreground)] hover:bg-[var(--surface-soft)]"}`;
}
function PrimaryButton({
  children,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`${buttonClass(true)} ${className}`}>
      {children}
    </button>
  );
}
function SecondaryButton({
  children,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`${buttonClass(false)} ${className}`}>
      {children}
    </button>
  );
}
function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(true)}>
      {children}
    </Link>
  );
}
function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-strong)] hover:underline"
    >
      {children}
      <ArrowRight size={15} />
    </Link>
  );
}
function MiniStat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Panel>
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-[var(--accent-strong)]">{note}</p>
    </Panel>
  );
}
function Th({ children }: { children: ReactNode }) {
  return <th className="px-5 py-3 font-medium sm:px-6">{children}</th>;
}
function Td({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-5 py-4 sm:px-6 ${className}`} {...rest}>
      {children}
    </td>
  );
}
function CampaignRow({
  name,
  status,
  audience,
  sent,
  replies,
}: {
  name: string;
  status: string;
  audience: string;
  sent: string;
  replies: string;
}) {
  return (
    <tr className="border-b last:border-0">
      <Td>
        <span className="font-medium">{name}</span>
      </Td>
      <Td>
        <Status value={status} />
      </Td>
      <Td>{audience}</Td>
      <Td>{sent}</Td>
      <Td>{replies}</Td>
    </tr>
  );
}
function Status({ value }: { value: string }) {
  const warning = ["Review", "Paused", "Processing", "Follow-up"].includes(
    value,
  );
  const danger = value === "Suppressed";
  const neutral = ["New", "Completed", "Closing", "Introduction"].includes(
    value,
  );
  return (
    <span
      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${danger ? "bg-[var(--danger-soft)] text-[var(--danger)]" : warning ? "bg-[var(--warning-soft)] text-[var(--warning)]" : neutral ? "bg-[var(--surface-soft)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}
    >
      {value}
    </span>
  );
}
function ReplyRow({
  initials,
  name,
  company,
  time,
}: {
  initials: string;
  name: string;
  company: string;
  time: string;
}) {
  return (
    <Link
      href="/inbox"
      className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-[var(--surface-soft)]"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-soft)] text-xs font-semibold">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-[var(--muted)]">
          {company}
        </span>
      </span>
      <span className="text-xs text-[var(--subtle)]">{time}</span>
    </Link>
  );
}
function Avatar({ name }: { name: string }) {
  return (
    <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)]">
      {name
        .split(" ")
        .map((part) => part[0])
        .join("")}
    </span>
  );
}
function CampaignFact({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="flex gap-2 text-[var(--muted)]">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="text-xs leading-5">{value}</span>
    </div>
  );
}
function SafetyBanner({ paused, reason }: { paused: boolean; reason: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <ShieldCheck
          size={20}
          className="mt-0.5 shrink-0 text-[var(--warning)]"
        />
        <div>
          <p className="text-sm font-semibold">Global sending is {paused ? "paused" : "allowed within configured limits"}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {paused ? `No email will be sent: ${reason}` : "The worker still enforces campaign pause, cadence, rate, daily, quiet-hour, reply, and suppression checks."}
          </p>
        </div>
      </div>
      <Link
        href="/settings"
        className="text-sm font-semibold text-[var(--warning)] hover:underline"
      >
        Review safety settings
      </Link>
    </div>
  );
}
function Message({
  sender,
  time,
  incoming = false,
  children,
}: {
  sender: string;
  time: string;
  incoming?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      className={`max-w-2xl rounded-2xl border p-4 text-sm leading-6 ${incoming ? "bg-[var(--accent-soft)]" : "bg-[var(--surface-raised)]"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
        <span className="font-semibold">{sender}</span>
        <time className="text-xs text-[var(--muted)]">{time}</time>
      </div>
      {children}
    </article>
  );
}
function SourceRow({
  icon,
  name,
  detail,
  status,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
  status: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b px-5 py-4 last:border-0 sm:px-6">
      <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="mt-1 truncate text-xs text-[var(--muted)]">{detail}</p>
      </div>
      <Status value={status} />
    </div>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        <Info size={14} className="text-[var(--subtle)]" aria-label={hint} />
      </span>
      <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
        {hint}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}
