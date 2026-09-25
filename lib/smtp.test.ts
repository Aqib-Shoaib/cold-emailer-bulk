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

test("formats a multipart alternative message when safe HTML is provided", () => {
  const message = formatSmtpMessage({
    from: "sender@example.com",
    to: "admin@example.com",
    subject: "Preview",
    text: "Hello Alice",
    html: "<p>Hello Alice</p>",
    messageId: "<message-id@example.com>",
  });
  assert.match(message, /Content-Type: multipart\/alternative/);
  assert.match(message, /Content-Type: text\/plain/);
  assert.match(message, /Content-Type: text\/html/);
  assert.match(message, /<p>Hello Alice<\/p>/);
  assert.match(message, /Message-ID: <message-id@example\.com>/);
});

test("formats reply threading headers safely", () => {
  const message = formatSmtpMessage({
    from: "sender@example.com",
    to: "person@example.com",
    replyTo: "replies@example.com",
    subject: "Re: Hello",
    text: "Thanks",
    messageId: "<reply@example.com>",
    inReplyTo: "<original@example.com>",
    references: ["<first@example.com>", "<original@example.com>"],
    listUnsubscribe: "https://app.example.com/api/unsubscribe?token=opaque",
  });
  assert.match(message, /Reply-To: <replies@example\.com>/);
  assert.match(message, /In-Reply-To: <original@example\.com>/);
  assert.match(message, /References: <first@example\.com> <original@example\.com>/);
  assert.match(message, /List-Unsubscribe: <https:\/\/app\.example\.com\/api\/unsubscribe\?token=opaque>/);
  assert.match(message, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.throws(() => formatSmtpMessage({ from: "sender@example.com", to: "person@example.com", subject: "x", text: "x", references: ["<ok@example.com>\r\nBcc: evil@example.com"] }));
});
