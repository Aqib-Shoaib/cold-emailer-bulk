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
export const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
] as const;

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
      field({ key: "recipientConsentBasis", label: "Recipient source / consent basis", hint: "Record why these recipients may be contacted. Required before a campaign can be scheduled.", type: "textarea", default: "", maxLength: 2000 }),
      field({ key: "unsubscribeFooter", label: "Default unsubscribe footer", hint: "Added to every bulk email with a working unsubscribe link.", type: "textarea", default: "You can unsubscribe at any time.", maxLength: 1000 }),
      field({ key: "timezone", label: "Application timezone", hint: "IANA name controlling schedules, quiet hours, and reporting.", type: "timezone", default: "Asia/Karachi", maxLength: 64 }),
      field({ key: "dateTimeFormat", label: "Date and time format", hint: "Display format used throughout the application. Leave empty to use the locale default.", type: "text", default: "", maxLength: 80 }),
      field({ key: "locale", label: "Locale", hint: "BCP 47 locale used for dates and numbers, such as en-PK.", type: "text", default: "en-PK", maxLength: 35 }),
      field({ key: "appearance", label: "Appearance", hint: "Default application color preference.", type: "select", options: ["System", "Light", "Dark"], default: "System" }),
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
      field({ key: "smtpReplyTo", label: "SMTP reply-to", hint: "Overrides the application reply-to for sent mail when provided.", type: "email", default: "", maxLength: 320 }),
      field({ key: "smtpHeloName", label: "HELO name", hint: "Hostname announced to the SMTP server. Leave empty to use the SMTP host.", type: "text", default: "", maxLength: 255 }),
      numberField("smtpConnectionTimeoutSeconds", "Connection timeout", "Stops slow connection attempts.", 5, 120, 20),
      numberField("smtpMaxPerMinute", "Messages per minute", "Provider-safe short-term limit.", 1, 600, 10),
      numberField("smtpMaxPerHour", "Messages per hour", "Provider-safe hourly limit.", 1, 20000, 120),
      numberField("smtpMaxPerDay", "Messages per day", "Global daily cap across every campaign.", 1, 100000, 2500),
      numberField("smtpBatchMinSize", "Minimum batch size", "Smallest randomized send cycle.", 1, 1000, 40),
      numberField("smtpBatchMaxSize", "Maximum batch size", "Largest randomized send cycle.", 1, 1000, 50),
      numberField("smtpBatchIntervalMinMinutes", "Minimum batch interval", "Shortest randomized wait between send cycles, in minutes.", 1, 1440, 3),
      numberField("smtpBatchIntervalMaxMinutes", "Maximum batch interval", "Longest randomized wait between send cycles, in minutes.", 1, 1440, 7),
      numberField("smtpRetryCount", "Retry count", "Retries before a send is marked failed.", 0, 20, 3),
      numberField("smtpRetryBackoffSeconds", "Retry backoff", "Initial delay between retries, in seconds.", 1, 86400, 60),
      field({ key: "smtpQuietDays", label: "Quiet days", hint: "Comma-separated weekdays when campaigns must not send. Leave empty for none.", type: "text", default: "", maxLength: 100 }),
      field({ key: "smtpQuietHours", label: "Quiet hours", hint: "Local no-send window in HH:MM-HH:MM form. Leave empty for none.", type: "text", default: "", maxLength: 20 }),
      field({ key: "smtpTimezone", label: "Sending timezone", hint: "IANA timezone used for quiet days and hours.", type: "timezone", default: "Asia/Karachi", maxLength: 64 }),
    ],
  },
  {
    id: "imap",
    title: "IMAP receiving",
    description: "Syncs replies, bounces, and automated responses. The password is encrypted after saving and never shown again.",
    fields: [
      field({ key: "imapHost", label: "IMAP host", hint: "Hostname supplied by your email provider.", type: "text", default: "", maxLength: 255 }),
      numberField("imapPort", "IMAP port", "Usually 993 for secure IMAP.", 1, 65535, 993),
      field({ key: "imapTlsMode", label: "TLS mode", hint: "Secure connection mode required by the provider.", type: "select", options: ["TLS", "STARTTLS", "NONE"], default: "TLS" }),
      field({ key: "imapUsername", label: "IMAP username", hint: "Mailbox or provider username.", type: "text", default: "", maxLength: 320 }),
      field({ key: "imapPassword", label: "IMAP password", hint: "Stored encrypted. Enter a new value to replace it; leave empty to keep the current one.", type: "text", default: "", maxLength: 500, secretField: "imap_password_enc" }),
      field({ key: "imapFolder", label: "Mailbox folder", hint: "Folder checked for new messages.", type: "text", default: "INBOX", maxLength: 100 }),
      numberField("imapPollIntervalSeconds", "Poll interval", "Seconds between inbox checks.", 30, 86400, 300),
      numberField("imapLookbackDays", "Look-back window", "Days rechecked when the saved mailbox cursor is unavailable.", 1, 365, 14),
      field({ key: "imapProcessedBehavior", label: "Processed messages", hint: "What happens after a message has been synchronized.", type: "select", options: ["Leave in place", "Mark as read", "Archive"], default: "Leave in place" }),
      field({ key: "imapArchiveFolder", label: "Archive folder", hint: "Destination folder when processed messages are archived.", type: "text", default: "", maxLength: 100 }),
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
      numberField("minimumStartDelayMinutes", "Minimum start delay", "Required review window before sending begins, in minutes.", 0, 10080, 15),
      numberField("defaultDailyCap", "Default daily cap", "Per-campaign limit before the mailbox limit.", 1, 100000, 250),
      numberField("duplicateSendWindowDays", "Duplicate-send window", "Days before the same contact can be queued again.", 0, 365, 30),
      numberField("bounceRateThresholdPercent", "Bounce threshold", "Campaigns above this bounce rate pause automatically.", 0, 100, 5),
      enabledField("stopOnReply", "Stop on reply", "Cancel remaining follow-ups after a contact replies.", "Enabled"),
      enabledField("stopOnUnsubscribe", "Stop on unsubscribe", "Cancel all future contact immediately.", "Enabled"),
      enabledField("requireReviewBeforeSend", "Review before send", "Require explicit approval before a campaign can be queued.", "Enabled"),
      field({ key: "testRecipientAddress", label: "Test recipient", hint: "Default address that receives campaign test messages.", type: "email", default: "", maxLength: 320 }),
    ],
  },
  {
    id: "ai",
    title: "AI drafting",
    description: "Google Gemini generates drafts from approved knowledge. API keys are encrypted and never shown again.",
    fields: [
      field({ key: "aiApiKey", label: "API key", hint: "Stored encrypted. Enter a new value to replace it; leave empty to keep the current one.", type: "text", default: "", maxLength: 1000, secretField: "ai_api_key_enc" }),
      field({ key: "aiModel", label: "Model", hint: "Supported Gemini text model. Gemini 3.8 Flash is the recommended default.", type: "select", options: GEMINI_MODELS, default: "gemini-3.8-flash" }),
      numberField("aiTemperaturePercent", "Creativity", "Sampling temperature as a percentage.", 0, 200, 40),
      numberField("aiMaxOutputLength", "Maximum output length", "Maximum generated tokens per draft.", 100, 32000, 2000),
      numberField("aiTimeoutSeconds", "Timeout", "Seconds before a generation attempt is stopped.", 5, 600, 60),
      numberField("aiRetryLimit", "Retry limit", "Retries after a temporary provider failure.", 0, 10, 2),
      field({ key: "aiDefaultTone", label: "Default tone", hint: "Tone requested for new drafts.", type: "text", default: "Professional", maxLength: 120 }),
      field({ key: "aiLanguage", label: "Language", hint: "Default language requested for new drafts.", type: "text", default: "English", maxLength: 80 }),
      field({ key: "aiSignature", label: "Signature", hint: "Default signature appended to generated drafts.", type: "textarea", default: "", maxLength: 2000 }),
      field({ key: "aiForbiddenClaims", label: "Forbidden claims and phrases", hint: "One prohibited claim or phrase per line.", type: "textarea", default: "", maxLength: 5000 }),
      numberField("aiKnowledgeResultLimit", "Knowledge result limit", "Maximum relevant knowledge chunks supplied to a draft.", 1, 50, 8),
      numberField("aiContextBudget", "Context budget", "Maximum knowledge tokens supplied to a draft.", 100, 100000, 8000),
      enabledField("aiRequireHumanApproval", "Human approval", "Require a person to approve AI output before queueing.", "Enabled"),
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
      field({ key: "contactDeletionBehavior", label: "Contact deletion", hint: "How contact identity is handled while preserving historical aggregates.", type: "select", options: ["Anonymize history", "Keep historical identity"], default: "Anonymize history" }),
      field({ key: "privacyNotice", label: "Cookie and privacy notice", hint: "Notice shown when enabled tracking requires disclosure in the deployment region.", type: "textarea", default: "", maxLength: 3000 }),
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
      numberField("jobRetentionDays", "Job retention", "Completed and failed jobs are removed after this period.", 7, 3650, 90),
      numberField("auditRetentionDays", "Audit retention", "Audit events are retained for this many days.", 30, 3650, 730),
      field({ key: "logVerbosity", label: "Log verbosity", hint: "Application log detail. Logs never include credentials or full email bodies.", type: "select", options: ["Errors", "Normal", "Verbose"], default: "Normal" }),
    ],
  },
];

export const SETTING_FIELDS: readonly SettingFieldDef[] = SETTING_SECTIONS.flatMap((section) => section.fields);

export const SECRET_SETTING_FIELDS = SETTING_FIELDS.filter((f) => f.secretField);

export const SETTINGS_SECTION_IDS = SETTING_SECTIONS.map((s) => s.id);

/** The global kill switch field lives inside the safety section. */
export const SENDING_PAUSED_FIELD = "sendingPaused";
export const SENDING_PAUSED_REASON_FIELD = "sendingPausedReason";
