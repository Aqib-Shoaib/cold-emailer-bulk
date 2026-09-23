import type { SecretField } from "./crypto.ts";

export type SettingFieldType = "text" | "email" | "url" | "number" | "select" | "textarea" | "timezone";

export interface SettingFieldDef {
  key: string;
  label: string;
  hint: string;
  type: SettingFieldType;
  default: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  /** Password-style inputs are encrypted secrets, never stored in values. */
  secretField?: SecretField;
}

export interface SettingSectionDef {
  id: string;
  title: string;
  description: string;
  fields: readonly SettingFieldDef[];
}

const enabled = ["Enabled", "Disabled"] as const;
const pausedChoice = ["Paused", "Sending allowed"] as const;

function field(def: SettingFieldDef): SettingFieldDef {
  return def;
}

function numberField(key: string, label: string, hint: string, min: number, max: number, def: number): SettingFieldDef {
  return field({ key, label, hint, type: "number", min, max, default: String(def) });
}

function enabledField(key: string, label: string, hint: string, def: "Enabled" | "Disabled" = "Enabled"): SettingFieldDef {
  return field({ key, label, hint, type: "select", options: enabled, default: def });
}

export const SETTING_SECTIONS: readonly SettingSectionDef[] = [
  {
    id: "identity",
    title: "Identity and application",
    description: "Sender identity, regional defaults, and public links used across every campaign.",
    fields: [
      field({ key: "companyName", label: "Company name", hint: "Used in sender details and footers.", type: "text", default: "Cold Emailer", maxLength: 120 }),
      field({ key: "senderDisplayName", label: "Sender display name", hint: "Default name recipients see.", type: "text", default: "Outreach Team", maxLength: 120 }),
      field({ key: "defaultReplyTo", label: "Default reply-to", hint: "Where direct replies are sent. Leave empty to use the SMTP account.", type: "email", default: "", maxLength: 320 }),
      field({ key: "physicalAddress", label: "Physical mailing address", hint: "Required in compliant campaign footers.", type: "textarea", default: "", maxLength: 500 }),
      field({ key: "unsubscribeFooter", label: "Default unsubscribe footer", hint: "Added to every bulk email with a working unsubscribe link.", type: "textarea", default: "You can unsubscribe at any time.", maxLength: 1000 }),
      field({ key: "timezone", label: "Application timezone", hint: "IANA name controlling schedules, quiet hours, and reporting.", type: "timezone", default: "Asia/Karachi", maxLength: 64 }),
      field({ key: "publicBaseUrl", label: "Public base URL", hint: "Used for unsubscribe and tracking links. Must match the deployed origin.", type: "url", default: "", maxLength: 500 }),
    ],
  },
  {
    id: "smtp",
    title: "SMTP sending",
    description: "The mailbox that sends approved campaigns. The password is encrypted after saving and never shown again.",
    fields: [
      field({ key: "smtpHost", label: "SMTP host", hint: "Hostname supplied by your email provider.", type: "text", default: "", maxLength: 255 }),
      numberField("smtpPort", "SMTP port", "Usually 465 or 587.", 1, 65535, 587),
      field({ key: "smtpTlsMode", label: "TLS mode", hint: "Encryption required by the provider.", type: "select", options: ["STARTTLS", "SSL", "NONE"], default: "STARTTLS" }),
      field({ key: "smtpUsername", label: "SMTP username", hint: "Mailbox or provider username.", type: "text", default: "", maxLength: 320 }),
      field({ key: "smtpPassword", label: "SMTP password", hint: "Stored encrypted. Enter a new value to replace it; leave empty to keep the current one.", type: "text", default: "", maxLength: 500, secretField: "smtp_password_enc" }),
      field({ key: "smtpFromAddress", label: "From address", hint: "Default sending address for campaigns.", type: "email", default: "", maxLength: 320 }),
      numberField("smtpConnectionTimeoutSeconds", "Connection timeout", "Stops slow connection attempts.", 5, 120, 20),
      numberField("smtpMaxPerMinute", "Messages per minute", "Provider-safe short-term limit.", 1, 600, 10),
      numberField("smtpMaxPerHour", "Messages per hour", "Provider-safe hourly limit.", 1, 20000, 120),
      numberField("smtpMaxPerDay", "Messages per day", "Hard daily safety limit.", 1, 100000, 500),
    ],
  },
  {
    id: "imap",
    title: "IMAP receiving",
    description: "Syncs replies, bounces, and automated responses. The password is encrypted after saving and never shown again.",
    fields: [
      field({ key: "imapHost", label: "IMAP host", hint: "Hostname supplied by your email provider.", type: "text", default: "", maxLength: 255 }),
      numberField("imapPort", "IMAP port", "Usually 993 for secure IMAP.", 1, 65535, 993),
      field({ key: "imapTlsMode", label: "TLS mode", hint: "Secure connection mode.", type: "select", options: ["TLS", "NONE"], default: "TLS" }),
      field({ key: "imapUsername", label: "IMAP username", hint: "Mailbox or provider username.", type: "text", default: "", maxLength: 320 }),
      field({ key: "imapPassword", label: "IMAP password", hint: "Stored encrypted. Enter a new value to replace it; leave empty to keep the current one.", type: "text", default: "", maxLength: 500, secretField: "imap_password_enc" }),
      field({ key: "imapFolder", label: "Mailbox folder", hint: "Folder checked for new messages.", type: "text", default: "INBOX", maxLength: 100 }),
    ],
  },
  {
    id: "safety",
    title: "Safety and campaign defaults",
    description: "Hard limits that every campaign must obey. The global kill switch stops all sending immediately.",
    fields: [
      field({ key: "sendingPaused", label: "Global sending", hint: "Immediate kill switch for every campaign and worker send.", type: "select", options: pausedChoice, default: "Paused" }),
      field({ key: "sendingPausedReason", label: "Kill-switch reason", hint: "Explain why sending is disabled. Shown to all admins.", type: "textarea", default: "Initial setup", maxLength: 300 }),
      field({ key: "defaultNewCampaignsPaused", label: "New campaigns", hint: "Default state after campaign creation.", type: "select", options: pausedChoice, default: "Paused" }),
      numberField("maxAudienceSize", "Maximum audience", "Largest allowed campaign audience.", 1, 100000, 1000),
      numberField("defaultDailyCap", "Default daily cap", "Per-campaign limit before the mailbox limit.", 1, 100000, 250),
      numberField("maxConcurrentCampaigns", "Concurrent campaigns", "Maximum campaigns sending together.", 1, 20, 2),
      numberField("duplicateSendWindowDays", "Duplicate-send window", "Days before the same contact can be queued again.", 0, 365, 30),
      numberField("bounceRateThresholdPercent", "Bounce threshold", "Campaigns above this bounce rate pause automatically.", 0, 100, 5),
      enabledField("stopOnReply", "Stop on reply", "Cancel remaining follow-ups after a contact replies.", "Enabled"),
      enabledField("stopOnUnsubscribe", "Stop on unsubscribe", "Cancel all future contact immediately.", "Enabled"),
    ],
  },
  {
    id: "tracking",
    title: "Tracking and retention",
    description: "Optional tracking and how long detailed data is kept. AI drafting fields arrive with the Phase 7 provider decision.",
    fields: [
      enabledField("openTrackingEnabled", "Open tracking", "Opens are inaccurate behind privacy tools and inflated by scanners.", "Disabled"),
      enabledField("clickTrackingEnabled", "Click tracking", "Routes links through signed redirects.", "Disabled"),
      numberField("rawEventRetentionDays", "Raw event retention", "Detailed tracking events are removed after this period.", 30, 3650, 180),
      numberField("messageBodyRetentionDays", "Message body retention", "Inbound message content is removed after this period.", 30, 3650, 365),
    ],
  },
  {
    id: "notifications",
    title: "Notifications and maintenance",
    description: "Operational alerts delivered by email when something needs attention.",
    fields: [
      field({ key: "notificationEmail", label: "Notification email", hint: "Receives system and campaign alerts.", type: "email", default: "", maxLength: 320 }),
      enabledField("alertConnectionFailures", "Connection failures", "Alert when SMTP or IMAP stops working."),
      enabledField("alertSendFailures", "Repeated send failures", "Alert after retry exhaustion."),
      enabledField("alertHighBounceRate", "High bounce rate", "Alert before automatic campaign pause."),
      enabledField("alertCampaignCompletion", "Campaign completion", "Send a campaign summary."),
      enabledField("alertWorkerInactivity", "Worker inactivity", "Alert when scheduled work stops."),
      numberField("alertCooldownMinutes", "Alert cooldown", "Avoid repeated alerts for one incident.", 5, 1440, 30),
    ],
  },
];

export const SETTING_FIELDS: readonly SettingFieldDef[] = SETTING_SECTIONS.flatMap((section) => section.fields);

export const SECRET_SETTING_FIELDS = SETTING_FIELDS.filter((f) => f.secretField);

export const SETTINGS_SECTION_IDS = SETTING_SECTIONS.map((s) => s.id);

/** The global kill switch field lives inside the safety section. */
export const SENDING_PAUSED_FIELD = "sendingPaused";
export const SENDING_PAUSED_REASON_FIELD = "sendingPausedReason";
