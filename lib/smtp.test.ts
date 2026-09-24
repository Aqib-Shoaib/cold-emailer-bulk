import assert from "node:assert/strict";
import test from "node:test";

import { formatSmtpMessage } from "./smtp.ts";

test("formats safe SMTP headers and dot-stuffs the message body", () => {
  const message = formatSmtpMessage({
    from: "sender@example.com",
    to: "admin@example.com",
    subject: "Reset code",
    text: "Code: 123456\n.second line",
  });

  assert.match(message, /From: <sender@example\.com>/);
  assert.match(message, /To: <admin@example\.com>/);
  assert.match(message, /\r\n\.\.second line\r\n\.$/);
  assert.throws(() => formatSmtpMessage({ from: "sender@example.com\r\nBcc: evil@example.com", to: "admin@example.com", subject: "Reset", text: "x" }));
  assert.throws(() => formatSmtpMessage({ from: "not-an-address", to: "admin@example.com", subject: "Reset", text: "x" }));
});
