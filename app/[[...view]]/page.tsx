import {
  ArrowRight,
  Books,
  CalendarBlank,
  Check,
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
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

const validViews = new Set([
  "dashboard",
  "contacts",
  "campaigns",
  "templates",
  "inbox",
  "knowledge",
  "users",
  "settings",
]);

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ view?: string[] }>;
}) {
  const segments = (await params).view;
  const view = segments?.[0] ?? "dashboard";

  if (segments && (segments.length !== 1 || !validViews.has(view))) notFound();

  return {
    dashboard: <DashboardView />,
    contacts: <ContactsView />,
    campaigns: <CampaignsView />,
    templates: <TemplatesView />,
    inbox: <InboxView />,
    knowledge: <KnowledgeView />,
    users: <UsersView />,
    settings: <SettingsView />,
  }[view];
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

function UsersView() {
  return (
    <Page>
      <PageHeader title="Users" description="Admins share product access. Only the super admin can deactivate or delete users." action={<PrimaryButton><UserPlus size={17} />Add admin</PrimaryButton>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Panel className="p-0"><div className="p-5 sm:p-6"><SectionTitle title="Workspace users" description="Two active users can access this workspace." /></div><div className="border-t"><UserRow initials="SA" name="Super Admin" email="admin@company.com" role="Super admin" active /><UserRow initials="AN" name="Areeba Noor" email="areeba@company.com" role="Admin" active /></div></Panel>
        <Panel><SectionTitle title="Add an admin" description="Set an initial password and share it with the user yourself." /><div className="mt-5 space-y-4"><Field label="Full name" hint="Shown in activity and account menus"><input className="input" placeholder="Enter full name" /></Field><Field label="Email address" hint="Used to sign in"><input className="input" type="email" placeholder="name@company.com" /></Field><Field label="Initial password" hint="Use at least 12 characters"><input className="input" type="password" placeholder="Enter a secure password" /></Field><PrimaryButton className="w-full justify-center">Create admin</PrimaryButton></div></Panel>
      </div>
    </Page>
  );
}

const settingsGroups = [
  {
    title: "Identity and application",
    description: "Set the sender identity, regional defaults, and public links.",
    fields: [
      ["Company name", "Used in sender details and footers", "text", "Cold Emailer"],
      ["Sender display name", "Default name recipients see", "text", "Outreach Team"],
      ["Default reply-to", "Where direct replies should be sent", "email", "replies@company.com"],
      ["Physical mailing address", "Required in compliant campaign footers", "text", ""],
      ["Default unsubscribe footer", "Added to every bulk email", "text", "You can unsubscribe at any time."],
      ["Application timezone", "Controls schedules and quiet hours", "select", "Asia/Karachi"],
      ["Date and time format", "Display preference for the workspace", "select", "DD MMM YYYY, 12-hour"],
      ["Locale", "Language used by the interface", "select", "English"],
      ["Appearance", "Follow system or choose a fixed theme", "select", "System"],
      ["Public base URL", "Used for unsubscribe and tracking links", "url", ""],
    ],
  },
  {
    title: "SMTP sending",
    description: "Connect the mailbox that sends approved campaigns.",
    fields: [
      ["SMTP host", "Hostname supplied by your email provider", "text", ""], ["SMTP port", "Usually 465 or 587", "number", "587"], ["TLS mode", "Encryption required by the provider", "select", "STARTTLS"], ["SMTP username", "Mailbox or provider username", "text", ""], ["SMTP password", "Encrypted after saving and never shown again", "password", ""], ["From address", "Default sending address", "email", ""], ["Reply-to address", "Optional override for campaign replies", "email", ""], ["HELO name", "Only change if your provider requires it", "text", ""], ["Connection timeout", "Stop slow connection attempts", "number", "20 seconds"], ["Messages per minute", "Provider-safe short-term limit", "number", "10"], ["Messages per hour", "Provider-safe hourly limit", "number", "120"], ["Messages per day", "Hard daily safety limit", "number", "500"], ["Batch size", "Messages claimed together by the worker", "number", "10"], ["Delay jitter", "Adds natural variation between sends", "number", "15 seconds"], ["Retry count", "Attempts after a temporary failure", "number", "3"], ["Retry backoff", "Delay grows after each failure", "select", "Exponential"], ["Quiet days", "Days when sending remains paused", "text", "Saturday, Sunday"], ["Quiet hours", "No sending outside this window", "text", "09:00 to 17:00"], ["Sending timezone", "Timezone applied to campaign delivery", "select", "Asia/Karachi"],
    ],
  },
  {
    title: "IMAP receiving",
    description: "Sync replies, bounces, and automated responses.",
    fields: [
      ["IMAP host", "Hostname supplied by your email provider", "text", ""], ["IMAP port", "Usually 993 for secure IMAP", "number", "993"], ["TLS mode", "Secure connection mode", "select", "TLS"], ["IMAP username", "Mailbox or provider username", "text", ""], ["IMAP password", "Encrypted after saving and never shown again", "password", ""], ["Mailbox folder", "Folder checked for new messages", "text", "INBOX"], ["Poll interval", "How often the worker checks for mail", "select", "Every 2 minutes"], ["Look-back window", "Recovery range if the sync cursor is lost", "select", "14 days"], ["Processed mail", "What happens after a message is stored", "select", "Leave in place"], ["Archive folder", "Optional destination for processed mail", "text", ""],
    ],
  },
  {
    title: "Safety and campaign defaults",
    description: "Set hard limits that every campaign must obey.",
    fields: [
      ["Global sending", "Immediate kill switch for every campaign", "select", "Paused"], ["Kill-switch reason", "Explain why sending is disabled", "text", "UI preview mode"], ["New campaigns", "Default state after campaign creation", "select", "Paused"], ["Maximum audience", "Largest allowed campaign audience", "number", "1,000"], ["Start delay", "Minimum time between approval and first send", "select", "15 minutes"], ["Default daily cap", "Campaign limit before mailbox limit", "number", "250"], ["Concurrent campaigns", "Maximum campaigns sending together", "number", "2"], ["Duplicate-send window", "Prevent repeated outreach to one address", "select", "30 days"], ["Bounce threshold", "Pause a campaign above this rate", "number", "5%"], ["Stop on reply", "Cancel remaining follow-ups after a reply", "select", "Enabled"], ["Stop on unsubscribe", "Cancel all future contact immediately", "select", "Enabled"], ["Review before send", "Human approval is required", "select", "Required"], ["Test recipient", "Default address for campaign tests", "email", ""],
    ],
  },
  {
    title: "AI drafting",
    description: "Choose the provider and guardrails used for assisted drafts.",
    fields: [
      ["AI provider", "Select before enabling draft generation", "select", "Not configured"], ["API endpoint", "Optional provider-compatible endpoint", "url", ""], ["API key", "Encrypted after saving and never shown again", "password", ""], ["Model", "Model used for drafting and grounding", "text", ""], ["Creativity", "Lower values produce more consistent copy", "number", "0.4"], ["Maximum output", "Maximum generated length", "number", "600 tokens"], ["Request timeout", "Stop requests that take too long", "number", "45 seconds"], ["Retry limit", "Retries after temporary provider failure", "number", "2"], ["Default tone", "Writing style for new drafts", "select", "Clear and professional"], ["Default language", "Language for generated copy", "select", "English"], ["Default signature", "Inserted into approved drafts", "text", ""], ["Forbidden claims", "Comma-separated claims AI must not make", "text", ""], ["Forbidden phrases", "Words or phrases that require review", "text", ""], ["Knowledge result limit", "Maximum source chunks per draft", "number", "6"], ["Context budget", "Maximum knowledge sent to the provider", "number", "8,000 tokens"], ["Human approval", "Block AI content from automatic queueing", "select", "Required"],
    ],
  },
  {
    title: "Tracking and privacy",
    description: "Control optional tracking and data retention.",
    fields: [
      ["Open tracking", "Opens can be inaccurate due to privacy tools", "select", "Disabled"], ["Click tracking", "Route links through signed redirects", "select", "Disabled"], ["Raw event retention", "Remove detailed events after this period", "select", "180 days"], ["Message body retention", "Remove inbound content after this period", "select", "365 days"], ["Contact deletion", "Choose deletion or anonymized history", "select", "Anonymize history"], ["Privacy notice", "Shown where tracking consent requires it", "text", ""],
    ],
  },
  {
    title: "Notifications and maintenance",
    description: "Choose operational alerts and cleanup periods.",
    fields: [
      ["Notification email", "Receives system and campaign alerts", "email", ""], ["Connection failures", "Alert when SMTP or IMAP stops working", "select", "Enabled"], ["Repeated send failures", "Alert after retry exhaustion", "select", "Enabled"], ["High bounce rate", "Alert before automatic campaign pause", "select", "Enabled"], ["Campaign completion", "Send a campaign summary", "select", "Enabled"], ["Worker inactivity", "Alert when scheduled work stops", "select", "Enabled"], ["Alert cooldown", "Avoid repeated alerts for one incident", "select", "30 minutes"], ["Job retention", "Keep completed background jobs", "select", "30 days"], ["Audit retention", "Keep security and settings history", "select", "365 days"], ["Log verbosity", "Production logging detail", "select", "Standard"],
    ],
  },
] as const;

function SettingsView() {
  return (
    <Page>
      <PageHeader title="Settings" description="Configure delivery, safety, AI, privacy, and system behavior." action={<PrimaryButton><Check size={17} />Save changes</PrimaryButton>} />
      <SafetyBanner />
      <div className="space-y-4">
        {settingsGroups.map((group, index) => (
          <details key={group.title} open={index < 2} className="group rounded-2xl border bg-[var(--surface)] shadow-[0_12px_34px_rgba(31,54,42,0.045)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 sm:px-6"><div><h2 className="font-semibold tracking-tight">{group.title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{group.description}</p></div><span className="text-sm font-medium text-[var(--accent-strong)] group-open:hidden">Open</span><span className="hidden text-sm font-medium text-[var(--accent-strong)] group-open:inline">Close</span></summary>
            <div className="grid gap-5 border-t p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
              {group.fields.map(([label, hint, type, value]) => (
                <SettingField key={label} label={label} hint={hint} type={type} value={value} />
              ))}
              {(group.title === "SMTP sending" || group.title === "IMAP receiving") && <div className="flex items-end"><SecondaryButton className="w-full justify-center">Test connection</SecondaryButton></div>}
            </div>
          </details>
        ))}
      </div>
    </Page>
  );
}

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
function Td({ children, className = "" }: { children: ReactNode; className?: string }) { return <td className={`px-5 py-4 sm:px-6 ${className}`}>{children}</td>; }
function CampaignRow({ name, status, audience, sent, replies }: { name: string; status: string; audience: string; sent: string; replies: string }) { return <tr className="border-b last:border-0"><Td><span className="font-medium">{name}</span></Td><Td><Status value={status} /></Td><Td>{audience}</Td><Td>{sent}</Td><Td>{replies}</Td></tr>; }
function Status({ value }: { value: string }) { const warning = ["Review", "Paused", "Processing", "Follow-up"].includes(value); const danger = value === "Suppressed"; const neutral = ["New", "Completed", "Closing", "Introduction"].includes(value); return <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${danger ? "bg-[var(--danger-soft)] text-[var(--danger)]" : warning ? "bg-[var(--warning-soft)] text-[var(--warning)]" : neutral ? "bg-[var(--surface-soft)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}>{value}</span>; }
function ReplyRow({ initials, name, company, time }: { initials: string; name: string; company: string; time: string }) { return <Link href="/inbox" className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-[var(--surface-soft)]"><span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-soft)] text-xs font-semibold">{initials}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs text-[var(--muted)]">{company}</span></span><span className="text-xs text-[var(--subtle)]">{time}</span></Link>; }
function AttentionItem({ icon, title, body, href }: { icon: ReactNode; title: string; body: string; href: string }) { return <Link href={href} className="flex gap-3 rounded-xl border bg-[var(--surface-raised)] p-3.5 hover:border-[var(--accent)]"><span className="mt-0.5 text-[var(--warning)]">{icon}</span><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{body}</span></span></Link>; }
function Avatar({ name }: { name: string }) { return <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)]">{name.split(" ").map((part) => part[0]).join("")}</span>; }
function emailFor(name: string) { return `${name.toLowerCase().replace(" ", ".")}@example.com`; }
function CampaignFact({ icon, value }: { icon: ReactNode; value: string }) { return <div className="flex gap-2 text-[var(--muted)]"><span className="mt-0.5 shrink-0">{icon}</span><span className="text-xs leading-5">{value}</span></div>; }
function SafetyBanner() { return <div className="flex flex-col gap-3 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-[var(--warning)]" /><div><p className="text-sm font-semibold">Global sending is paused</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Campaigns can be prepared and reviewed, but no email will be sent in preview mode.</p></div></div><Link href="/settings" className="text-sm font-semibold text-[var(--warning)] hover:underline">Review safety settings</Link></div>; }
function Conversation({ initials, name, subject, preview, time, active = false }: { initials: string; name: string; subject: string; preview: string; time: string; active?: boolean }) { return <button type="button" className={`flex w-full gap-3 border-b p-4 text-left last:border-0 ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-soft)]"}`}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-raised)] text-xs font-semibold">{initials}</span><span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{name}</span><span className="text-xs text-[var(--subtle)]">{time}</span></span><span className="mt-1 block truncate text-xs font-medium">{subject}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{preview}</span></span></button>; }
function Message({ sender, time, incoming = false, children }: { sender: string; time: string; incoming?: boolean; children: ReactNode }) { return <article className={`max-w-2xl rounded-2xl border p-4 text-sm leading-6 ${incoming ? "bg-[var(--accent-soft)]" : "bg-[var(--surface-raised)]"}`}><div className="mb-3 flex items-center justify-between gap-3 border-b pb-3"><span className="font-semibold">{sender}</span><time className="text-xs text-[var(--muted)]">{time}</time></div>{children}</article>; }
function SourceRow({ icon, name, detail, status }: { icon: ReactNode; name: string; detail: string; status: string }) { return <div className="flex items-center gap-3 border-b px-5 py-4 last:border-0 sm:px-6"><span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]">{icon}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{name}</p><p className="mt-1 truncate text-xs text-[var(--muted)]">{detail}</p></div><Status value={status} /></div>; }
function GroundedSource({ name, relevance }: { name: string; relevance: string }) { return <div className="rounded-xl bg-[var(--surface-raised)] p-3"><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-[var(--muted)]">{relevance}</p></div>; }
function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action: string }) { return <Panel className="flex flex-col items-center py-10 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-[var(--surface-soft)] text-[var(--muted)]">{icon}</span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{body}</p><SecondaryButton className="mt-5">{action}</SecondaryButton></Panel>; }
function UserRow({ initials, name, email, role, active }: { initials: string; name: string; email: string; role: string; active: boolean }) { return <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0 sm:px-6"><span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)]">{initials}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="mt-1 truncate text-xs text-[var(--muted)]">{email}</p></div><Status value={role} /><span className="text-xs text-[var(--accent-strong)]">{active ? "Active" : "Inactive"}</span></div>; }
function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) { return <label className="block"><span className="flex items-center gap-1.5 text-sm font-medium">{label}<Info size={14} className="text-[var(--subtle)]" aria-label={hint} /></span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{hint}</span><span className="mt-2 block">{children}</span></label>; }
function SettingField({ label, hint, type, value }: { label: string; hint: string; type: string; value: string }) { return <Field label={label} hint={hint}>{type === "select" ? <select className="input" defaultValue={value}><option>{value}</option><option>Configure later</option></select> : <input className="input" type={type === "password" ? "password" : type === "number" ? "text" : type} defaultValue={value} placeholder={type === "password" ? "Not configured" : "Enter a value"} />}</Field>; }
