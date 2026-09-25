import assert from "node:assert/strict";
import test from "node:test";

import { chunkKnowledge, knowledgeFileType, MAX_KNOWLEDGE_FILE_BYTES, prepareKnowledge } from "./knowledge.ts";

test("chunks attributable knowledge without losing text", () => {
  const first = "Routing automation reduces manual triage. ".repeat(20).trim();
  const second = "Unrelated office address details.";
  const chunks = chunkKnowledge(`${first}\n\n${second}`, 300);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 300));
  assert.ok(chunks.some((chunk) => chunk.includes("office address")));
});

test("accepts only the approved upload extensions", () => {
  assert.equal(knowledgeFileType("proof.PDF"), "PDF");
  assert.equal(knowledgeFileType("brief.docx"), "WORD");
  assert.equal(knowledgeFileType("legacy.doc"), "WORD");
  assert.equal(knowledgeFileType("notes.txt"), "TEXT_FILE");
  assert.equal(knowledgeFileType("contacts.csv"), null);
});

test("enforces the approved 20 MB source limit", async () => {
  assert.equal(MAX_KNOWLEDGE_FILE_BYTES, 20 * 1024 * 1024);
  await assert.rejects(() => prepareKnowledge("TEXT_FILE", Buffer.alloc(MAX_KNOWLEDGE_FILE_BYTES + 1)), /20 MB/);
  assert.equal((await prepareKnowledge("PASTED_TEXT", Buffer.from("Useful company proof."))).chunks.length, 1);
});
