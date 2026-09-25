import assert from "node:assert/strict";
import test from "node:test";

import { parseContactInput } from "./contacts.ts";

test("normalizes contact email and deduplicates tags case-insensitively", () => {
  const form = new FormData();
  form.set("email", " Person@Example.COM ");
  form.set("firstName", " Farah ");
  form.set("tags", "Logistics, priority, LOGISTICS");

  assert.deepEqual(parseContactInput(form), {
    email: "person@example.com",
    firstName: "Farah",
    lastName: "",
    company: "",
    title: "",
    tags: ["logistics", "priority"],
    customFields: {},
  });
});

test("rejects malformed email and oversized contact fields", () => {
  const malformed = new FormData();
  malformed.set("email", "not-an-email");
  assert.equal(parseContactInput(malformed), null);

  const oversized = new FormData();
  oversized.set("email", "person@example.com");
  oversized.set("company", "x".repeat(161));
  assert.equal(parseContactInput(oversized), null);

  oversized.set("company", "Header\nInjection");
  assert.equal(parseContactInput(oversized), null);
});

test("accepts scalar custom fields and rejects nested values", () => {
  const form = new FormData();
  form.set("email", "person@example.com");
  form.set("customFields", JSON.stringify({ region: "EMEA", score: 4, active: true }));
  assert.deepEqual(parseContactInput(form)?.customFields, { region: "EMEA", score: 4, active: true });

  form.set("customFields", JSON.stringify({ nested: { unsafe: true } }));
  assert.equal(parseContactInput(form), null);
});
