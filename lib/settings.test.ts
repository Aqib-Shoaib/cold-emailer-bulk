import assert from "node:assert/strict";
import test from "node:test";

import { decryptSecret, encryptSecret } from "./crypto.ts";
import { SETTING_FIELDS, SETTING_SECTIONS, SENDING_PAUSED_FIELD, SENDING_PAUSED_REASON_FIELD } from "./settings-schema.ts";
import { computeSettingsUpdate, sendingReadinessErrors, settingsDefaults, toPublicSettings, validateSettingsInput } from "./settings.ts";

const KEY = "unit-test-encryption-key";

function input(overrides: Record<string, string> = {}) {
  return { ...settingsDefaults(), ...overrides };
}

test("registry keys are unique and typed fields declare options", () => {
  const keys = SETTING_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "setting keys must not repeat");

  for (const field of SETTING_FIELDS) {
    if (field.type === "select") {
      assert.ok(field.options && field.options.length >= 2, `${field.key} needs options`);
      assert.ok(field.options.includes(field.default), `${field.key} default must be an option`);
    }
    if (field.type === "number") {
      assert.ok(typeof field.min === "number" && typeof field.max === "number", `${field.key} needs bounds`);
    }
  }

  const sectionIds = SETTING_SECTIONS.map((s) => s.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length);
});

test("registry defaults pass validation and compute cleanly", () => {
  const defaults = input();
  assert.deepEqual(validateSettingsInput(defaults), []);

  const update = computeSettingsUpdate(defaults, { encryptionKey: KEY });
  assert.equal(update.sendingPaused, true);
  assert.ok(update.sendingPausedReason.length > 0);
  assert.deepEqual(update.secrets, {}, "no secret should be stored by default");
  assert.equal(update.values.companyName, "Cold Emailer");
});

test("invalid ports, emails, URLs, timezones, and options are rejected with field errors", () => {
  const errors = validateSettingsInput(
    input({
      smtpPort: "not-a-number",
      smtpFromAddress: "not-an-email",
      publicBaseUrl: "not a url",
      smtpTlsMode: "SOMETHING_ELSE",
      smtpMaxPerDay: "999999",
      timezone: "Not/AZone",
    }),
  );

  const fields = errors.map((e) => e.field);
  assert.ok(fields.includes("smtpPort"));
  assert.ok(fields.includes("smtpFromAddress"));
  assert.ok(fields.includes("publicBaseUrl"));
  assert.ok(fields.includes("smtpTlsMode"));
  assert.ok(fields.includes("smtpMaxPerDay"));
  assert.ok(fields.includes("timezone"));
  assert.ok(errors.every((e) => e.message.length > 0));
});

test("valid IANA timezones are accepted", () => {
  assert.deepEqual(validateSettingsInput(input({ timezone: "Europe/Berlin" })), []);
  assert.deepEqual(validateSettingsInput(input({ timezone: "UTC" })), []);
});

test("only currently configured Gemini models are accepted", () => {
  assert.deepEqual(validateSettingsInput(input({ aiModel: "gemini-3.8-flash" })), []);
  assert.ok(validateSettingsInput(input({ aiModel: "gemini-2.0-flash" })).some((error) => error.field === "aiModel"));
});

test("retired stored model IDs fall back to the current default", () => {
  const publicSettings = toPublicSettings(
    { values: { aiModel: "gemini-2.0-flash" }, sendingPaused: true, sendingPausedReason: "Setup", updatedAt: new Date() },
    {},
    KEY,
  );
  assert.equal(publicSettings.values.aiModel, "gemini-3.8-flash");
});

test("paused kill switch requires a non-empty reason", () => {
  const paused = validateSettingsInput(input({ sendingPaused: "Paused", sendingPausedReason: "  " }));
  assert.ok(paused.some((e) => e.field === SENDING_PAUSED_REASON_FIELD));

  const allowed = validateSettingsInput(input({ sendingPaused: "Sending allowed", sendingPausedReason: "" }));
  assert.deepEqual(allowed, []);
});

test("computeSettingsUpdate encrypts secrets and keeps blanks on the stored value", () => {
  const update = computeSettingsUpdate(
    input({ smtpHost: "mail.example.com", smtpPassword: "fresh-secret", imapPassword: "" }),
    { encryptionKey: KEY },
  );

  assert.ok(update.secrets.smtp_password_enc);
  assert.notEqual(update.secrets.smtp_password_enc, "fresh-secret");
  assert.equal(decryptSecret(KEY, update.secrets.smtp_password_enc ?? ""), "fresh-secret");
  assert.equal(update.secrets.imap_password_enc, undefined, "blank secret keeps the stored value");
  assert.equal(update.values.smtpHost, "mail.example.com");
  assert.ok(!JSON.stringify(update.values).includes("fresh-secret"), "secrets must never land in values");
});

test("computeSettingsUpdate removes only explicitly selected secrets", () => {
  const update = computeSettingsUpdate(input({ smtpPassword: "replacement", imapPassword: "keep" }), {
    encryptionKey: KEY,
    removeSecrets: new Set(["smtp_password_enc"]),
  });

  assert.equal(update.secrets.smtp_password_enc, null);
  assert.ok(update.secrets.imap_password_enc);
});

test("structured locale, quiet hours, quiet days, and deployed origin are validated", () => {
  const errors = validateSettingsInput(
    input({ locale: "not_a_locale", smtpQuietHours: "25:00-09:00", smtpQuietDays: "Friday, Funday", publicBaseUrl: "https://wrong.example" }),
    { publicAppUrl: "https://app.example" },
  );

  assert.deepEqual(new Set(errors.map((error) => error.field)), new Set(["locale", "smtpQuietHours", "smtpQuietDays", "publicBaseUrl"]));
});

test("send-cycle minimums cannot exceed their maximums", () => {
  const errors = validateSettingsInput(input({
    smtpBatchMinSize: "51",
    smtpBatchMaxSize: "50",
    smtpBatchIntervalMinMinutes: "8",
    smtpBatchIntervalMaxMinutes: "7",
  }));

  assert.deepEqual(
    new Set(errors.map((error) => error.field)),
    new Set(["smtpBatchMaxSize", "smtpBatchIntervalMaxMinutes"]),
  );
});

test("switching the kill switch off records the choice without a reason", () => {
  const update = computeSettingsUpdate(input({ sendingPaused: "Sending allowed" }), { encryptionKey: KEY });
  assert.equal(update.sendingPaused, false);
});

test("public settings expose booleans instead of secret values", () => {
  const storedSecret = encryptSecret(KEY, "stored-secret");
  const now = new Date("2026-09-24T10:00:00Z");
  const update = computeSettingsUpdate(input({ smtpPassword: "typed-secret" }), { encryptionKey: KEY });

  const publicSettings = toPublicSettings(
    { values: { smtpHost: "mail.example.com" }, sendingPaused: true, sendingPausedReason: "Initial setup", updatedAt: now },
    { smtp_password_enc: storedSecret, imap_password_enc: null, ai_api_key_enc: update.secrets.ai_api_key_enc ?? null },
    KEY,
  );

  assert.equal(publicSettings.values.smtpHost, "mail.example.com");
  assert.equal(publicSettings.values.companyName, "Cold Emailer", "defaults fill missing stored keys");
  assert.equal(publicSettings.secrets.smtp_password_enc, true);
  assert.equal(publicSettings.secrets.imap_password_enc, false);
  assert.equal(publicSettings.secrets.ai_api_key_enc, false);
  assert.equal(publicSettings.updatedAt, now.toISOString());
  assert.ok(!JSON.stringify(publicSettings).includes("stored-secret"));
});

test("paused reason survives a full compute and public round trip", () => {
  const update = computeSettingsUpdate(input({ sendingPaused: "Paused", sendingPausedReason: "Provider incident" }), { encryptionKey: KEY });
  const publicSettings = toPublicSettings(
    { values: update.values, sendingPaused: update.sendingPaused, sendingPausedReason: update.sendingPausedReason, updatedAt: new Date() },
    {},
    KEY,
  );

  assert.equal(publicSettings.sendingPaused, true);
  assert.equal(publicSettings.sendingPausedReason, "Provider incident");
  assert.equal(publicSettings.values[SENDING_PAUSED_FIELD], "Paused");
  assert.equal(publicSettings.values[SENDING_PAUSED_REASON_FIELD], "Provider incident");
});

test("sending readiness requires identity, consent, SMTP credentials, and tracking notice", () => {
  const values = settingsDefaults();
  assert(sendingReadinessErrors(values, false).includes("recipient source / consent basis"));
  Object.assign(values, { physicalAddress: "1 Main St", recipientConsentBasis: "Existing business contacts", publicBaseUrl: "https://mail.example", smtpHost: "smtp.example", smtpUsername: "user", smtpFromAddress: "sender@example.com" });
  assert.deepEqual(sendingReadinessErrors(values, true), []);
  values.openTrackingEnabled = "Enabled";
  assert.deepEqual(sendingReadinessErrors(values, true), ["privacy notice for enabled tracking"]);
});
