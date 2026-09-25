import assert from "node:assert/strict";
import test from "node:test";

import { classifyInbound, extractBounceRecipient, normalizeMessageId, replySubject, safeHtml } from "./inbound.ts";
import { imapSearchPlan } from "./imap.ts";

test("classifies only strong permanent-delivery evidence as a hard bounce", () => {
  const hard = classifyInbound({
    fromEmail: "mailer-daemon@example.test",
    subject: "Delivery failed",
    text: "Final-Recipient: rfc822; person@example.test\nAction: failed\nStatus: 5.1.1",
    headers: { "content-type": "multipart/report; report-type=delivery-status" },
    hasOutboundReference: false,
  });
  assert.equal(hard.kind, "HARD_BOUNCE");
  assert.equal(hard.bounceEmail, "person@example.test");

  const uncertain = classifyInbound({
    fromEmail: "mailer-daemon@example.test",
    subject: "Delivery delayed",
    text: "Final-Recipient: rfc822; person@example.test\nStatus: 4.2.0",
    headers: {},
    hasOutboundReference: false,
  });
  assert.equal(uncertain.kind, "REVIEW");
});

test("recognizes automatic and referenced replies", () => {
  assert.equal(classifyInbound({ fromEmail: "a@example.test", subject: "Out of office", text: "", headers: {}, hasOutboundReference: true }).kind, "AUTO_REPLY");
  assert.equal(classifyInbound({ fromEmail: "a@example.test", subject: "Re: Hello", text: "Interested", headers: { "x-autoreply": "" }, hasOutboundReference: true }).kind, "REPLY");
});

test("normalizes identifiers and stores only inert HTML", () => {
  assert.equal(normalizeMessageId("ABC@example.test"), "<abc@example.test>");
  assert.equal(safeHtml("<script>x</script>\nHello"), "&lt;script&gt;x&lt;/script&gt;<br>Hello");
  assert.equal(replySubject("Hello"), "Re: Hello");
  assert.equal(extractBounceRecipient({ text: "", headers: { "x-failed-recipients": "Person@Example.test" } }), "person@example.test");
});

test("uses the UID cursor when valid and a bounded lookback after cursor loss", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  assert.deepEqual(imapSearchPlan({ uidValidity: "10", lastUid: 25 }, "10", 30, 14, now), { uid: "26:*" });
  assert.equal(imapSearchPlan({ uidValidity: "10", lastUid: 25 }, "10", 26, 14, now), null);
  assert.deepEqual(imapSearchPlan({ uidValidity: "10", lastUid: 25 }, "11", 30, 14, now), { since: new Date("2026-09-11T12:00:00Z") });
});
