import {
  ArrowRight,
  Books,
  CalendarBlank,
  DownloadSimple,
  Envelope,
  Export,
  FileCsv,
  FileText,
  Funnel,
  Info,
  MagnifyingGlass,
  PaperPlaneTilt,
  Pause,
  Plus,
  ShieldCheck,
  Sparkle,
  UploadSimple,
  UserPlus,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { SETTINGS_ROW_ID, toPublicSettings } from "@/lib/settings";
import { SETTING_SECTIONS } from "@/lib/settings-schema";
import { SettingsForm, type SettingsFeedback } from "./settings-form";

const validViews = new Set(["dashboard", "contacts", "campaigns", "templates", "inbox", "knowledge", "users", "settings"]);

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
      return <SettingsView search={{ notice: single("notice"), error: single("error"), detail: single("detail"), fields: single("fields") }} />;
    case "users":
      return <UsersView feedback={{ notice: single("notice"), error: single("error") }} />;
    default:
      return <PreviewViews view={view} />;
  }
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
  if (error === "forbidden") return { kind: "forbidden", fields: [], detail: "" };
  if (error === "encryption") return { kind: "encryption", fields: [], detail: "" };
  if (error === "secret") return { kind: "secret", fields: [], detail: "" };
  if (error === "validation") {
    return { kind: "validation", fields: (fields ?? "").split(",").filter(Boolean), detail: "" };
  }
  if (error === "test") return { kind: "test", fields: [], detail: detail ?? "" };
  if (error === "smtp-failed" || error === "imap-failed") {
    return { kind: error, fields: [], detail: detail ?? "" };
  }
  if (notice === "smtp-ok") return { kind: "smtp-ok", fields: [], detail: "" };
  if (notice === "imap-ok") return { kind: "imap-ok", fields: [], detail: "" };
  return { kind: "none", fields: [], detail: "" };
}

async function SettingsView({ search }: { search: { notice?: string; error?: string; detail?: string; fields?: string } }) {
  const cookieStore = await cookies();
  const currentUser = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!currentUser) return null;

  const prisma = getPrisma();
  const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
  const settings = toPublicSettings(
    row ?? { values: {}, sendingPaused: true, sendingPausedReason: "Initial setup", updatedAt: new Date() },
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
    encryption: "The server encryption key is missing; settings changes are disabled.",
    secret: "No password is configured yet for that connection. Save one first, then test.",
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
        <p role={feedback.kind === "saved" || feedback.kind.endsWith("ok") ? "status" : "alert"} className={`rounded-xl px-4 py-3 text-sm ${feedback.kind === "saved" || feedback.kind.endsWith("ok") ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
          {validationMessage ?? feedbackMessages[feedback.kind]}
        </p>
      ) : null}
      <SettingsForm sections={SETTING_SECTIONS} settings={settings} feedback={feedback} />
    </Page>
  );
}

/* ------------------------------ users ------------------------------ */

async function UsersView({ feedback }: { feedback: { notice?: string; error?: string } }) {
  const cookieStore = await cookies();
  const currentUser = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!currentUser) return null;

  const users = await getPrisma().user.findMany({ orderBy: { createdAt: "asc" } });
  const activeCount = users.filter((user) => user.active).length;
  const message = feedbackMessage(feedback);

  return (
    <Page>
      <PageHeader title="Users" description="Admins share product access. Only the super admin can deactivate or delete users." />
      {message ? <p role={feedback.error ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${feedback.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{message}</p> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Panel className="p-0"><div className="p-5 sm:p-6"><SectionTitle title="Workspace users" description={`${activeCount} active ${activeCount === 1 ? "user can" : "users can"} access this workspace.`} /></div><div className="border-t">{users.map((user) => <UserRow key={user.id} id={user.id} name={user.name} email={user.email} role={user.role} active={user.active} canManage={currentUser.role === "SUPER_ADMIN" && user.role === "ADMIN"} />)}</div></Panel>
        <div className="space-y-5">
          {currentUser.role === "SUPER_ADMIN" ? <Panel><SectionTitle title="Add an admin" description="Set an initial password and share it with the user yourself." /><form action="/api/users/create" method="post" className="mt-5 space-y-4"><Field label="Full name" hint="Shown in activity and account menus"><input className="input" name="name" minLength={2} maxLength={120} autoComplete="name" placeholder="Enter full name" required /></Field><Field label="Email address" hint="Used to sign in"><input className="input" name="email" type="email" maxLength={320} autoComplete="email" placeholder="name@company.com" required /></Field><Field label="Initial password" hint="Use 12 to 200 characters"><input className="input" name="password" type="password" minLength={12} maxLength={200} autoComplete="new-password" placeholder="Enter a secure password" required /></Field><button type="submit" className={`${buttonClass(true)} w-full justify-center`}><UserPlus size={17} />Create admin</button></form></Panel> : null}
          <Panel><SectionTitle title="Your security" description="Change your password or sign out other browser sessions." /><form action="/api/account/change-password" method="post" className="mt-5 space-y-4"><Field label="Current password" hint="Confirms this sensitive change"><input className="input" name="currentPassword" type="password" autoComplete="current-password" required /></Field><Field label="New password" hint="Use 12 to 200 characters"><input className="input" name="newPassword" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /></Field><Field label="Confirm new password" hint="Enter the same new password again"><input className="input" name="confirmation" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /></Field><button type="submit" className={`${buttonClass(true)} w-full justify-center`}>Change password</button></form><details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm font-semibold">Sign out other sessions</summary><p className="mt-2 text-xs leading-5 text-[var(--muted)]">This immediately signs your account out everywhere except this browser.</p><form action="/api/account/revoke-sessions" method="post"><button type="submit" className={`${buttonClass(false)} mt-3`}>Confirm sign out</button></form></details></Panel>
        </div>
      </div>
    </Page>
  );
}

function feedbackMessage({ notice, error }: { notice?: string; error?: string }) {
  if (error === "forbidden") return "Only the super admin can manage users.";
  if (error === "security") return "The security change could not be completed. Check the passwords and try again.";
  if (error === "invalid") return "The user change could not be completed. Check the details and try again.";
  if (notice === "created") return "Admin created successfully.";
  if (notice === "updated") return "Admin access updated.";
  if (notice === "deleted") return "Admin deleted permanently.";
  if (notice === "security-updated") return "Security settings updated.";
  return null;
}

function UserRow({ id, name, email, role, active, canManage }: { id: string; name: string; email: string; role: "SUPER_ADMIN" | "ADMIN"; active: boolean; canManage: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0 sm:px-6">
      <Avatar name={name} />
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="mt-1 truncate text-xs text-[var(--muted)]">{email}</p></div>
      <Status value={role === "SUPER_ADMIN" ? "Super admin" : "Admin"} />
      <span className={`text-xs ${active ? "text-[var(--accent-strong)]" : "text-[var(--danger)]"}`}>{active ? "Active" : "Inactive"}</span>
      {canManage ? (
        active ? (
          <details className="w-full rounded-xl bg-[var(--surface-soft)] p-3 sm:w-auto">
            <summary className="cursor-pointer text-xs font-semibold">Manage</summary>
            <p className="mt-2 text-xs text-[var(--muted)]">Deactivation signs this user out immediately. Deletion is permanent.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action="/api/users/deactivate" method="post"><input type="hidden" name="userId" value={id} /><button type="submit" className={buttonClass(false)}>Deactivate</button></form>
              <form action="/api/users/delete" method="post"><input type="hidden" name="userId" value={id} /><button type="submit" className="inline-flex min-h-10 items-center rounded-xl border border-[var(--danger)] px-3.5 py-2 text-sm font-semibold text-[var(--danger)]">Delete permanently</button></form>
            </div>
          </details>
        ) : (
          <form action="/api/users/activate" method="post"><input type="hidden" name="userId" value={id} /><button type="submit" className={buttonClass(false)}>Reactivate</button></form>
        )
      ) : null}
    </div>
  );
}

/* ------------------------------ preview views ------------------------------ */

function PreviewViews({ view }: { view: string }) {
  switch (view) {
    case "contacts": return <ContactsView />;
    case "campaigns": return <CampaignsView />;
    case "templates": return <TemplatesView />;
    case "inbox": return <InboxView />;
    case "knowledge": return <KnowledgeView />;
    default: return <DashboardView />;
  }
}

function DashboardView() {
  const metrics = [
    { label: "Emails sent", value: "2,847", note: "+12.4% this month" },
    { label: "Reply rate", value: "8.7%", note: "248 replies" },
    { label: "Positive replies", value: "74", note: "29.8% of replies" },
    { label: "Active campaigns", value: "3", note: "1 paused for review" },
  ];

  return (
    <Page>
      <PageHeader
        title="Good morning"
        description="Here is what needs your attention across outreach and replies."
        action={<PrimaryLink href="/campaigns"><Plus size={17} />New campaign</PrimaryLink>}
      />

      <Panel className="overflow-hidden p-0">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric, index) => (
            <div
              key={metric.label}
              className={`px-5 py-5 sm:px-6 ${index ? "border-t sm:border-l sm:border-t-0" : ""} ${index === 2 ? "sm:border-l-0 sm:border-t xl:border-l xl:border-t-0" : ""}`}
            >
              <p className="text-sm text-[var(--muted)]">{metric.label}</p>
              <p className="mt-2 font-mono text-3xl font-semibold tracking-tight">{metric.value}</p>
              <p className="mt-1.5 text-xs text-[var(--accent-strong)]">{metric.note}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <Panel>
          <SectionTitle title="Campaign performance" description="Last 14 days, shown with preview data." />
          <div className="mt-7 grid h-56 grid-cols-14 items-end gap-2" aria-label="Email activity bar chart">
            {[38, 51, 42, 67, 59, 74, 48, 81, 62, 88, 71, 93, 76, 84].map((height, index) => (
              <div key={index} className="group flex h-full items-end">
                <div
                  className="w-full rounded-t-md bg-[var(--accent)] opacity-75 transition-opacity group-hover:opacity-100"
                  style={{ height: `${height}%` }}
                  title={`${height + 34} emails on day ${index + 1}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between text-xs text-[var(--subtle)]">
            <span>Sep 10</span><span>Sep 16</span><span>Sep 23</span>
          </div>
        </Panel>

        <Panel>
          <SectionTitle title="Needs attention" description="Resolve these before sending resumes." />
          <div className="mt-5 space-y-3">
            <AttentionItem icon={<WarningCircle size={19} />} title="SMTP not connected" body="Add sending credentials in Settings." href="/settings" />
            <AttentionItem icon={<Envelope size={19} />} title="4 unread replies" body="Two are marked as positive." href="/inbox" />
            <AttentionItem icon={<Pause size={19} />} title="Sending is paused" body="Preview mode blocks every outgoing email." href="/settings" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Panel className="p-0">
          <div className="flex items-center justify-between px-5 py-5 sm:px-6">
            <SectionTitle title="Recent campaigns" description="Latest audience and response activity." />
            <TextLink href="/campaigns">View all</TextLink>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-y bg-[var(--surface-soft)]/60 text-xs text-[var(--muted)]">
                <tr><Th>Campaign</Th><Th>Status</Th><Th>Audience</Th><Th>Sent</Th><Th>Replies</Th></tr>
              </thead>
              <tbody>
                <CampaignRow name="Logistics leaders Q3" status="Active" audience="482" sent="319" replies="31" />
                <CampaignRow name="Clinic partnerships" status="Review" audience="164" sent="0" replies="0" />
                <CampaignRow name="Founder follow-up" status="Paused" audience="93" sent="67" replies="9" />
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <SectionTitle title="Recent replies" description="Conversations with the latest activity." />
          <div className="mt-5 space-y-1">
            <ReplyRow initials="FN" name="Farah Nadeem" company="Northstar Logistics" time="12m" />
            <ReplyRow initials="OR" name="Omar Rahman" company="Crescent Clinics" time="1h" />
            <ReplyRow initials="LH" name="Lina Haddad" company="Morrow Research" time="3h" />
          </div>
        </Panel>
      </div>
    </Page>
  );
}

function ContactsView() {
  const contacts = [
    ["Farah Nadeem", "Northstar Logistics", "Head of Operations", "Qualified", "2 days ago"],
    ["Omar Rahman", "Crescent Clinics", "Managing Director", "Replied", "Today"],
    ["Lina Haddad", "Morrow Research", "Partnerships Lead", "Contacted", "4 days ago"],
    ["Bilal Qureshi", "Meridian Foods", "Commercial Director", "New", "Never"],
    ["Sana Mirza", "Harborline Studio", "Founder", "Suppressed", "12 days ago"],
  ];

  return (
    <Page>
      <PageHeader title="Contacts" description="Keep prospect data organized, clean, and safe to contact." action={<PrimaryButton><UserPlus size={17} />Add contact</PrimaryButton>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr]">
        <MiniStat label="Total contacts" value="1,284" note="Across 8 lists" />
        <MiniStat label="Contactable" value="1,176" note="91.6% of database" />
        <Panel className="flex items-center justify-between gap-4 bg-[var(--accent-soft)]">
          <div><p className="text-sm font-medium">Import a CSV</p><p className="mt-1 text-xs text-[var(--muted)]">Preview mapping and row errors before import.</p></div>
          <SecondaryButton><UploadSimple size={17} />Import</SecondaryButton>
        </Panel>
      </div>
      <Panel className="p-0">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="relative flex-1">
            <MagnifyingGlass aria-hidden size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]" />
            <input aria-label="Search contacts" placeholder="Search name, company, or email" className="input pl-10" />
          </div>
          <SecondaryButton><Funnel size={17} />Filters</SecondaryButton>
          <SecondaryButton><Export size={17} />Export</SecondaryButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-y bg-[var(--surface-soft)]/60 text-xs text-[var(--muted)]">
              <tr><Th>Contact</Th><Th>Company</Th><Th>Role</Th><Th>Status</Th><Th>Last activity</Th></tr>
            </thead>
            <tbody>
              {contacts.map(([name, company, role, status, activity]) => (
                <tr key={name} className="border-b last:border-0 hover:bg-[var(--surface-soft)]/45">
                  <Td><div className="flex items-center gap-3"><Avatar name={name} /><div><p className="font-medium">{name}</p><p className="text-xs text-[var(--muted)]">{emailFor(name)}</p></div></div></Td>
                  <Td>{company}</Td><Td className="text-[var(--muted)]">{role}</Td><Td><Status value={status} /></Td><Td className="text-[var(--muted)]">{activity}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-5 py-4 text-xs text-[var(--muted)]"><span>Showing 5 of 1,284 contacts</span><span>Page 1 of 257</span></div>
      </Panel>
    </Page>
  );
}

function CampaignsView() {
  const campaigns = [
    { name: "Logistics leaders Q3", status: "Active", audience: "482 recipients", schedule: "Weekdays, 9:00 AM", sent: "319 sent", replies: "31 replies" },
    { name: "Clinic partnerships", status: "Review", audience: "164 recipients", schedule: "Starts Sep 26", sent: "Not started", replies: "Needs approval" },
    { name: "Founder follow-up", status: "Paused", audience: "93 recipients", schedule: "Paused Sep 21", sent: "67 sent", replies: "9 replies" },
    { name: "Research directors", status: "Completed", audience: "218 recipients", schedule: "Completed Sep 18", sent: "211 sent", replies: "17 replies" },
  ];

  return (
    <Page>
      <PageHeader title="Campaigns" description="Plan outreach, review every audience, and control sending from one place." action={<PrimaryButton><Plus size={17} />New campaign</PrimaryButton>} />
      <SafetyBanner />
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Campaign filters">
        {['All 12', 'Active 3', 'Needs review 2', 'Paused 1', 'Completed 6'].map((filter, index) => <button key={filter} className={index ? "filter" : "filter filter-active"}>{filter}</button>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {campaigns.map((campaign) => (
          <Panel key={campaign.name} className="group hover:border-[var(--accent)]">
            <div className="flex items-start justify-between gap-4"><div><Status value={campaign.status} /><h2 className="mt-3 text-lg font-semibold tracking-tight">{campaign.name}</h2><p className="mt-1 text-sm text-[var(--muted)]">{campaign.audience}</p></div><button aria-label={`Open ${campaign.name}`} className="grid size-9 place-items-center rounded-xl hover:bg-[var(--surface-soft)]"><ArrowRight size={18} /></button></div>
            <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-4 text-sm"><CampaignFact icon={<CalendarBlank size={16} />} value={campaign.schedule} /><CampaignFact icon={<PaperPlaneTilt size={16} />} value={campaign.sent} /><CampaignFact icon={<Envelope size={16} />} value={campaign.replies} /></div>
          </Panel>
        ))}
      </div>
    </Page>
  );
}

function TemplatesView() {
  const templates = [
    { name: "Operations introduction", subject: "A quick idea for {{company}}", tag: "Most used", uses: "Used in 6 campaigns" },
    { name: "Value-led follow-up", subject: "Following up on {{pain_point}}", tag: "Follow-up", uses: "Used in 4 campaigns" },
    { name: "Partnership opener", subject: "Partnership idea for {{company}}", tag: "Introduction", uses: "Used in 3 campaigns" },
    { name: "Short final note", subject: "Should I close the loop?", tag: "Closing", uses: "Used in 2 campaigns" },
  ];
  return (
    <Page>
      <PageHeader title="Templates" description="Create clear, reusable messages with safe personalization." action={<PrimaryButton><Plus size={17} />New template</PrimaryButton>} />
      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((template) => (
          <Panel key={template.name} className="flex min-h-56 flex-col">
            <div className="flex items-start justify-between gap-4"><span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><FileText size={20} /></span><Status value={template.tag} /></div>
            <h2 className="mt-5 text-lg font-semibold">{template.name}</h2><p className="mt-2 rounded-xl bg-[var(--surface-soft)] px-3 py-2 font-mono text-xs text-[var(--muted)]">Subject: {template.subject}</p>
            <div className="mt-auto flex items-center justify-between pt-5 text-xs text-[var(--muted)]"><span>{template.uses}</span><button className="font-semibold text-[var(--accent-strong)]">Open template</button></div>
          </Panel>
        ))}
      </div>
    </Page>
  );
}

function InboxView() {
  return (
    <Page>
      <PageHeader title="Inbox" description="Read replies in context and stop follow-ups at the right moment." action={<SecondaryButton><DownloadSimple size={17} />Sync now</SecondaryButton>} />
      <Panel className="grid min-h-[650px] overflow-hidden p-0 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-b lg:border-b-0 lg:border-r">
          <div className="border-b p-4"><div className="relative"><MagnifyingGlass size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]" /><input aria-label="Search inbox" className="input pl-10" placeholder="Search conversations" /></div></div>
          <Conversation active initials="FN" name="Farah Nadeem" subject="Re: Workflow for your operations team" preview="This is relevant. Could you share a few times next week?" time="12m" />
          <Conversation initials="OR" name="Omar Rahman" subject="Re: Clinic partnership idea" preview="Please send the short overview to my assistant." time="1h" />
          <Conversation initials="LH" name="Lina Haddad" subject="Re: Research collaboration" preview="We are reviewing this internally and will get back to you." time="3h" />
          <Conversation initials="BQ" name="Bilal Qureshi" subject="Automatic reply" preview="I am away from the office until Monday." time="5h" />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5 sm:p-6"><div><p className="text-xs font-medium text-[var(--accent-strong)]">Positive reply</p><h2 className="mt-1 text-lg font-semibold">Workflow for your operations team</h2><p className="mt-1 text-sm text-[var(--muted)]">Farah Nadeem, Northstar Logistics</p></div><SecondaryButton>View contact</SecondaryButton></div>
          <div className="flex-1 space-y-6 p-5 sm:p-7">
            <Message sender="You" time="Sep 22, 10:14 AM"><p>Hi Farah, I noticed Northstar is expanding its regional operations team. We help teams reduce manual lead routing without replacing their current CRM.</p><p className="mt-3">Would a short workflow review be useful?</p></Message>
            <Message sender="Farah Nadeem" time="Today, 9:42 AM" incoming><p>Hi, this is relevant. Could you share a few times next week and a short example of the workflow?</p></Message>
          </div>
          <div className="border-t p-4 sm:p-5"><label htmlFor="reply" className="text-sm font-medium">Reply</label><textarea id="reply" rows={4} className="input mt-2 resize-none" placeholder="Write a helpful reply" /><div className="mt-3 flex items-center justify-between"><p className="text-xs text-[var(--muted)]">Follow-ups are stopped for this contact.</p><PrimaryButton><PaperPlaneTilt size={17} />Send reply</PrimaryButton></div></div>
        </div>
      </Panel>
    </Page>
  );
}

function KnowledgeView() {
  return (
    <Page>
      <PageHeader title="Knowledge" description="Give the draft assistant approved facts, language, and proof." action={<PrimaryButton><Plus size={17} />Add source</PrimaryButton>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Panel className="p-0"><div className="flex items-center justify-between p-5 sm:p-6"><SectionTitle title="Sources" description="Only active sources can support AI drafts." /><SecondaryButton><UploadSimple size={17} />Upload</SecondaryButton></div><div className="border-t"><SourceRow icon={<FileText size={19} />} name="Service overview" detail="Pasted text, 18 relevant chunks" status="Ready" /><SourceRow icon={<FileCsv size={19} />} name="Customer outcomes" detail="CSV, 42 proof points" status="Ready" /><SourceRow icon={<Books size={19} />} name="Messaging guidelines" detail="Document, updated 3 days ago" status="Processing" /></div></Panel>
        <Panel className="bg-[var(--accent-soft)]"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-white"><Sparkle size={20} weight="fill" /></span><div><h2 className="font-semibold">Grounding check</h2><p className="text-xs text-[var(--muted)]">Preview result</p></div></div><p className="mt-6 text-sm leading-6">The assistant found three approved sources for “reduce manual lead routing” and excluded unrelated pricing notes.</p><div className="mt-5 space-y-2"><GroundedSource name="Service overview" relevance="High relevance" /><GroundedSource name="Customer outcomes" relevance="2 supporting facts" /><GroundedSource name="Messaging guidelines" relevance="Tone guidance" /></div><SecondaryButton className="mt-5 w-full justify-center">Test another topic</SecondaryButton></Panel>
      </div>
      <EmptyState icon={<Books size={28} />} title="Source history will appear here" body="Reprocessing results and extraction errors will be recorded once the backend is connected." action="Review source guidance" />
    </Page>
  );
}

/* ------------------------------ shared pieces ------------------------------ */

function Page({ children }: { children: ReactNode }) { return <div className="space-y-5 sm:space-y-6">{children}</div>; }
function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">{description}</p></div>{action}</div>; }
function Panel({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`rounded-2xl border bg-[var(--surface)] p-5 shadow-[0_12px_34px_rgba(31,54,42,0.045)] sm:p-6 ${className}`}>{children}</section>; }
function SectionTitle({ title, description }: { title: string; description: string }) { return <div><h2 className="font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{description}</p></div>; }
function buttonClass(primary: boolean) { return `inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-semibold transition-transform active:translate-y-px ${primary ? "border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]" : "bg-[var(--surface-raised)] text-[var(--foreground)] hover:bg-[var(--surface-soft)]"}`; }
function PrimaryButton({ children, className = "" }: { children: ReactNode; className?: string }) { return <button type="button" className={`${buttonClass(true)} ${className}`}>{children}</button>; }
function SecondaryButton({ children, className = "" }: { children: ReactNode; className?: string }) { return <button type="button" className={`${buttonClass(false)} ${className}`}>{children}</button>; }
function PrimaryLink({ href, children }: { href: string; children: ReactNode }) { return <Link href={href} className={buttonClass(true)}>{children}</Link>; }
function TextLink({ href, children }: { href: string; children: ReactNode }) { return <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-strong)] hover:underline">{children}<ArrowRight size={15} /></Link>; }
function MiniStat({ label, value, note }: { label: string; value: string; note: string }) { return <Panel><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-2 font-mono text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-[var(--accent-strong)]">{note}</p></Panel>; }
function Th({ children }: { children: ReactNode }) { return <th className="px-5 py-3 font-medium sm:px-6">{children}</th>; }
function Td({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.TdHTMLAttributes<HTMLTableCellElement>) { return <td className={`px-5 py-4 sm:px-6 ${className}`} {...rest}>{children}</td>; }
function CampaignRow({ name, status, audience, sent, replies }: { name: string; status: string; audience: string; sent: string; replies: string }) { return <tr className="border-b last:border-0"><Td><span className="font-medium">{name}</span></Td><Td><Status value={status} /></Td><Td>{audience}</Td><Td>{sent}</Td><Td>{replies}</Td></tr>; }
function Status({ value }: { value: string }) { const warning = ["Review", "Paused", "Processing", "Follow-up"].includes(value); const danger = value === "Suppressed"; const neutral = ["New", "Completed", "Closing", "Introduction"].includes(value); return <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${danger ? "bg-[var(--danger-soft)] text-[var(--danger)]" : warning ? "bg-[var(--warning-soft)] text-[var(--warning)]" : neutral ? "bg-[var(--surface-soft)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{value}</span>; }
function ReplyRow({ initials, name, company, time }: { initials: string; name: string; company: string; time: string }) { return <Link href="/inbox" className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-[var(--surface-soft)]"><span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-soft)] text-xs font-semibold">{initials}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs text-[var(--muted)]">{company}</span></span><span className="text-xs text-[var(--subtle)]">{time}</span></Link>; }
function AttentionItem({ icon, title, body, href }: { icon: ReactNode; title: string; body: string; href: string }) { return <Link href={href} className="flex gap-3 rounded-xl border bg-[var(--surface-raised)] p-3.5 hover:border-[var(--accent)]"><span className="mt-0.5 text-[var(--warning)]">{icon}</span><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{body}</span></span></Link>; }
function Avatar({ name }: { name: string }) { return <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)]">{name.split(" ").map((part) => part[0]).join("")}</span>; }
function emailFor(name: string) { return `${name.toLowerCase().replace(" ", ".")}@example.com`; }
function CampaignFact({ icon, value }: { icon: ReactNode; value: string }) { return <div className="flex gap-2 text-[var(--muted)]"><span className="mt-0.5 shrink-0">{icon}</span><span className="text-xs leading-5">{value}</span></div>; }
function SafetyBanner() { return <div className="flex flex-col gap-3 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-[var(--warning)]" /><div><p className="text-sm font-semibold">Global sending is paused</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Campaigns can be prepared and reviewed, but no email will be sent.</p></div></div><Link href="/settings" className="text-sm font-semibold text-[var(--warning)] hover:underline">Review safety settings</Link></div>; }
function Conversation({ initials, name, subject, preview, time, active = false }: { initials: string; name: string; subject: string; preview: string; time: string; active?: boolean }) { return <button type="button" className={`flex w-full gap-3 border-b p-4 text-left last:border-0 ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-soft)]"}`}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-raised)] text-xs font-semibold">{initials}</span><span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{name}</span><span className="text-xs text-[var(--subtle)]">{time}</span></span><span className="mt-1 block truncate text-xs font-medium">{subject}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{preview}</span></span></button>; }
function Message({ sender, time, incoming = false, children }: { sender: string; time: string; incoming?: boolean; children: ReactNode }) { return <article className={`max-w-2xl rounded-2xl border p-4 text-sm leading-6 ${incoming ? "bg-[var(--accent-soft)]" : "bg-[var(--surface-raised)]"}`}><div className="mb-3 flex items-center justify-between gap-3 border-b pb-3"><span className="font-semibold">{sender}</span><time className="text-xs text-[var(--muted)]">{time}</time></div>{children}</article>; }
function SourceRow({ icon, name, detail, status }: { icon: ReactNode; name: string; detail: string; status: string }) { return <div className="flex items-center gap-3 border-b px-5 py-4 last:border-0 sm:px-6"><span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]">{icon}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{name}</p><p className="mt-1 truncate text-xs text-[var(--muted)]">{detail}</p></div><Status value={status} /></div>; }
function GroundedSource({ name, relevance }: { name: string; relevance: string }) { return <div className="rounded-xl bg-[var(--surface-raised)] p-3"><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-[var(--muted)]">{relevance}</p></div>; }
function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action: string }) { return <Panel className="flex flex-col items-center py-10 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-[var(--surface-soft)] text-[var(--muted)]">{icon}</span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{body}</p><SecondaryButton className="mt-5">{action}</SecondaryButton></Panel>; }
function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) { return <label className="block"><span className="flex items-center gap-1.5 text-sm font-medium">{label}<Info size={14} className="text-[var(--subtle)]" aria-label={hint} /></span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{hint}</span><span className="mt-2 block">{children}</span></label>; }
