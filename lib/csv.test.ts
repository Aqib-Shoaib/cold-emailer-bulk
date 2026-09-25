import assert from "node:assert/strict";
import test from "node:test";

import { csvCell, guessCsvField, parseCsv } from "./csv.ts";

test("parses quoted CSV values, escaped quotes, and CRLF", () => {
  assert.deepEqual(parseCsv('email,company\r\n"a@example.com","Acme, Inc."\r\n"b@example.com","A ""quote"""'), [
    ["email", "company"],
    ["a@example.com", "Acme, Inc."],
    ["b@example.com", 'A "quote"'],
  ]);
  assert.equal(csvCell('Acme, "Inc"'), '"Acme, ""Inc"""');
  assert.throws(() => parseCsv('"unfinished'));
});

test("maps common headers and keeps unknown columns as custom fields", () => {
  assert.equal(guessCsvField("Email Address"), "email");
  assert.equal(guessCsvField("Lead score"), "custom:Lead score");
  assert.equal(guessCsvField(" "), "");
});

test("CSV export neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"https://evil.test\")"), "\"'=HYPERLINK(\"\"https://evil.test\"\")\"");
  assert.equal(csvCell("  +1+1"), "'  +1+1");
  assert.equal(csvCell("ordinary"), "ordinary");
});
