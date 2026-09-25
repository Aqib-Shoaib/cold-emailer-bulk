import type { SecretField } from "./crypto.ts";
import { encryptSecret, isSecretConfigured, SECRET_FIELDS } from "./crypto.ts";
import { SECRET_SETTING_FIELDS, SETTING_FIELDS, SENDING_PAUSED_FIELD, SENDING_PAUSED_REASON_FIELD } from "./settings-schema.ts";

export const SETTINGS_ROW_ID = "singleton";
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * A field-level error, keyed by setting key. Route handlers surface these as
 * redirect parameters; the UI highlights the failed section.
 */
export interface SettingsError {
  field: string;
  message: string;
}

const PAUSED_VALUE = "Paused";
const PAUSED_TRUE = "Sending allowed";

function secretFieldFor(key: string): SecretField | undefined {
  return SECRET_SETTING_FIELDS.find((f) => f.key === key)?.secretField;
}

function isBlank(value: string) {
  return value.trim().length === 0;
}

function validateField(field: (typeof SETTING_FIELDS)[number], raw: string): string | null {
  const value = raw.trim();

  if (field.type === "number") {
    if (!/^-?\d+$/.test(value)) return "Enter a whole number";
    const parsed = Number(value);
    if (parsed < (field.min ?? -Infinity) || parsed > (field.max ?? Infinity)) {
      return `Must be between ${field.min} and ${field.max}`;
    }
    return null;
  }

  if (field.type === "select") {
    return field.options?.includes(value) ? null : "Choose a valid option";
  }

  if (field.type === "timezone") {
    if (isBlank(value)) return null;
    try {
      new Intl.DateTimeFormat("en-u-ca-gregory", { timeZone: value });
    } catch {
      return "Enter a valid IANA timezone, such as Asia/Karachi";
    }
    return null;
  }

  if (isBlank(value)) {
    // Blank non-secret fields keep defaults where a default exists; validation
    // of required-ness is handled per field below.
    return null;
  }

  if (field.key === "locale") {
    try {
      new Intl.Locale(value);
    } catch {
      return "Enter a valid BCP 47 locale, such as en-PK";
    }
  }

  if (field.key === "smtpQuietDays") {
    const weekdays = new Set(["mon", "monday", "tue", "tuesday", "wed", "wednesday", "thu", "thursday", "fri", "friday", "sat", "saturday", "sun", "sunday"]);
    if (value.split(",").some((day) => !weekdays.has(day.trim().toLowerCase()))) {
      return "Use comma-separated weekdays, such as Friday, Saturday";
    }
  }

  if (field.key === "smtpQuietHours") {
    const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 23 || Number(match[4]) > 59) {
      return "Use HH:MM-HH:MM with valid 24-hour times";
    }
  }

  if (field.type === "email" && !EMAIL_PATTERN.test(value)) return "Enter a valid email address";
  if (field.type === "url") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Enter an http(s) URL";
    } catch {
      return "Enter a valid URL";
    }
  }

  const max = field.maxLength ?? 500;
  if (value.length > max) return `Must be ${max} characters or fewer`;

  return null;
}

export type SettingsInput = Record<string, string>;

export type SettingsValues = Record<string, string>;

/** Browser-safe settings shape: secrets are booleans, never values. */
export interface PublicSettings {
  values: SettingsValues;
  secrets: Record<SecretField, boolean>;
  sendingPaused: boolean;
  sendingPausedReason: string;
  updatedAt: string | null;
}

/**
 * Validates raw form input against the registry. Returns every error, so the
 * UI can report all problems in one pass.
 */
export function validateSettingsInput(input: SettingsInput, options: { publicAppUrl?: string } = {}): SettingsError[] {
  const errors: SettingsError[] = [];

  for (const field of SETTING_FIELDS) {
    const raw = input[field.key] ?? "";
    const message = validateField(field, raw);
    if (message) errors.push({ field: field.key, message });
  }

  const publicBaseUrl = input.publicBaseUrl?.trim();
  if (publicBaseUrl && options.publicAppUrl) {
    try {
      if (new URL(publicBaseUrl).origin !== new URL(options.publicAppUrl).origin) {
        errors.push({ field: "publicBaseUrl", message: "Must use the deployed application origin" });
      }
    } catch {
      // The field-level URL validator reports malformed values.
    }
  }

  for (const [minimum, maximum] of [
    ["smtpBatchMinSize", "smtpBatchMaxSize"],
    ["smtpBatchIntervalMinMinutes", "smtpBatchIntervalMaxMinutes"],
  ] as const) {
    const min = Number(input[minimum]);
    const max = Number(input[maximum]);
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      errors.push({ field: maximum, message: "Must be greater than or equal to the minimum" });
    }
  }

  if (!errors.length) {
    const pausedRaw = (input[SENDING_PAUSED_FIELD] ?? "").trim();
    const reasonRaw = (input[SENDING_PAUSED_REASON_FIELD] ?? "").trim();
    const paused = pausedRaw ? pausedRaw === PAUSED_VALUE : true;
    if (paused && reasonRaw.length === 0) {
      errors.push({
        field: SENDING_PAUSED_REASON_FIELD,
        message: "A reason is required while the global kill switch is on",
      });
    }
  }

  return errors;
}

/** Defaults for every registered field, keyed by setting key. */
export function settingsDefaults(): SettingsValues {
  const values: SettingsValues = {};
  for (const field of SETTING_FIELDS) values[field.key] = field.default;
  return values;
}

/**
 * Computes the Prisma update for AppSettings from validated input.
 * Secret fields are encrypted with the runtime key; blank secret inputs keep
 * the stored value. Pure computation keeps the transaction testable.
 */
export function computeSettingsUpdate(
  input: SettingsInput,
  options: { encryptionKey: string; removeSecrets?: ReadonlySet<SecretField> },
): {
  values: SettingsValues;
  sendingPaused: boolean;
  sendingPausedReason: string;
  secrets: Partial<Record<SecretField, string | null>>;
} {
  const values = settingsDefaults();

  for (const field of SETTING_FIELDS) {
    if (field.secretField) continue;
    const raw = (input[field.key] ?? "").trim();
    if (raw.length > 0) values[field.key] = raw;
  }

  const pausedRaw = (input[SENDING_PAUSED_FIELD] ?? "").trim();
  const sendingPaused = pausedRaw ? pausedRaw === PAUSED_VALUE : values[SENDING_PAUSED_FIELD] === PAUSED_VALUE;
  values[SENDING_PAUSED_FIELD] = sendingPaused ? PAUSED_VALUE : PAUSED_TRUE;

  const reasonRaw = (input[SENDING_PAUSED_REASON_FIELD] ?? "").trim();
  const sendingPausedReason = sendingPaused
    ? reasonRaw || "No reason provided"
    : reasonRaw || values[SENDING_PAUSED_REASON_FIELD] || "No reason provided";

  values[SENDING_PAUSED_REASON_FIELD] = sendingPausedReason;

  const secrets: Partial<Record<SecretField, string | null>> = {};
  for (const field of SETTING_FIELDS) {
    const secretField = secretFieldFor(field.key);
    if (!secretField) continue;
    if (options.removeSecrets?.has(secretField)) {
      secrets[secretField] = null;
      continue;
    }
    const raw = (input[field.key] ?? "").trim();
    if (raw.length > 0) secrets[secretField] = encryptSecret(options.encryptionKey, raw);
  }

  return { values, sendingPaused, sendingPausedReason, secrets };
}

/**
 * The public shape returned to browsers. Secret values never leave the server.
 */
export function toPublicSettings(
  stored: {
    values: unknown;
    sendingPaused: boolean;
    sendingPausedReason: string;
    updatedAt: Date;
  },
  secrets: Partial<Record<SecretField, string | null>>,
  encryptionKey: string,
): PublicSettings {
  const values = settingsValues(stored.values);
  const configured = {} as Record<SecretField, boolean>;
  for (const field of SECRET_FIELDS) {
    configured[field] = isSecretConfigured(encryptionKey, secrets[field]);
  }

  return {
    values,
    secrets: configured,
    sendingPaused: stored.sendingPaused,
    sendingPausedReason: stored.sendingPausedReason,
    updatedAt: stored.updatedAt.toISOString(),
  };
}

export function settingsValues(stored: unknown): SettingsValues {
  const values = { ...settingsDefaults(), ...asRecord(stored) };
  for (const field of SETTING_FIELDS) {
    if (field.type === "select" && !field.options?.includes(values[field.key])) values[field.key] = field.default;
  }
  return values;
}

export function sendingReadinessErrors(values: SettingsValues, smtpPasswordConfigured: boolean) {
  const required = [
    ["senderDisplayName", "sender name"], ["companyName", "company name"], ["physicalAddress", "physical address"],
    ["recipientConsentBasis", "recipient source / consent basis"], ["publicBaseUrl", "public base URL"],
    ["smtpHost", "SMTP host"], ["smtpUsername", "SMTP username"], ["smtpFromAddress", "SMTP from address"],
  ] as const;
  const errors: string[] = required.filter(([key]) => !values[key]?.trim()).map(([, label]) => label);
  if (!smtpPasswordConfigured) errors.push("SMTP password");
  if ((values.openTrackingEnabled === "Enabled" || values.clickTrackingEnabled === "Enabled") && !values.privacyNotice.trim()) errors.push("privacy notice for enabled tracking");
  return errors;
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}
