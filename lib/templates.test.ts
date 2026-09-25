import assert from "node:assert/strict";
import test from "node:test";

import { appendBulkFooter, contactsMissingVariables, parseTemplateInput, renderTemplate, templateContext } from "./templates.ts";

const source = {
  subject: "Hello {{ contact.first_name }} at {{contact.company}}",
  textBody: "A note from {{sender.name}} about {{campaign.name}}.",
  htmlBody: "<p>A note from {{sender.name}} about {{campaign.name}}.</p>",
};

test("renders supported variables identically while escaping HTML output", () => {
  const context = templateContext({
    contact: { firstName: "<Alice>", lastName: "", email: "alice@example.com", company: "A & B", title: "CEO" },
    campaignName: "Launch",
    senderName: "Sam",
    senderCompany: "Sender Co",
  });
  const rendered = renderTemplate(source, context);
  assert.equal(rendered.subject, "Hello <Alice> at A & B");
  assert.match(rendered.html, /Sam/);
  assert.doesNotMatch(rendered.html, /<Alice>/);
  assert.deepEqual(rendered.missing, []);
});

test("reports affected contacts and blocks unsupported or unsafe template input", () => {
  assert.deepEqual(contactsMissingVariables(source, [
    { firstName: "Alice", lastName: "", email: "alice@example.com", company: "", title: "" },
  ], { campaignName: "Launch", senderName: "Sam", senderCompany: "Sender Co" }), [
    { email: "alice@example.com", missing: ["contact.company"] },
  ]);

  const form = new FormData();
  form.set("name", "Unsafe");
  form.set("subject", "Hello {{unknown.value}}");
  form.set("textBody", "<script>alert(1)</script>");
  assert.equal(parseTemplateInput(form), null);
  form.set("subject", "Hello");
  const parsed = parseTemplateInput(form);
  assert.ok(parsed);
  assert.doesNotMatch(parsed.htmlBody, /<script>/);
  assert.match(parsed.htmlBody, /&lt;script&gt;/);
});

test("bulk footer requires identity, address, and an unsubscribe URL", () => {
  const rendered = { subject: "Hi", text: "Body", html: "<p>Body</p>", missing: [] };
  assert.throws(() => appendBulkFooter(rendered, { senderName: "Sam", companyName: "Sender", physicalAddress: "", footerText: "Opt out", unsubscribeUrl: "https://example.com/unsubscribe" }));
  const email = appendBulkFooter(rendered, { senderName: "Sam", companyName: "Sender", physicalAddress: "1 Main St", footerText: "Opt out", unsubscribeUrl: "https://example.com/unsubscribe?t=1&x=2" });
  assert.match(email.text, /Sam, Sender/);
  assert.match(email.html, /Unsubscribe/);
  assert.match(email.html, /t=1&amp;x=2/);
});
