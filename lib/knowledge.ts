import { createRequire } from "node:module";
import { PDFParse } from "pdf-parse";

import { getPrisma } from "./prisma.ts";

const require = createRequire(import.meta.url);
const WordExtractor = require("word-extractor") as new () => {
  extract(source: Buffer): Promise<{ getBody(): string }>;
};

export type KnowledgeFileType = "PDF" | "WORD" | "TEXT_FILE";
export const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024;

export function chunkKnowledge(text: string, maximum = 1_200) {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > maximum) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < paragraph.length; start += maximum - 150) chunks.push(paragraph.slice(start, start + maximum).trim());
    } else if (!current) current = paragraph;
    else if (current.length + paragraph.length + 2 <= maximum) current += `\n\n${paragraph}`;
    else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function extractKnowledgeFile(type: KnowledgeFileType, content: Buffer) {
  if (type === "TEXT_FILE") return new TextDecoder("utf-8", { fatal: true }).decode(content);
  if (type === "WORD") return (await new WordExtractor().extract(content)).getBody();
  const parser = new PDFParse({ data: content });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function prepareKnowledge(type: KnowledgeFileType | "PASTED_TEXT", content: Buffer) {
  if (!content.length || content.length > MAX_KNOWLEDGE_FILE_BYTES) throw new Error("Knowledge sources must be between 1 byte and 20 MB.");
  const extractedText = (type === "PASTED_TEXT"
    ? new TextDecoder("utf-8", { fatal: true }).decode(content)
    : await extractKnowledgeFile(type, content))
    .replaceAll("\0", "")
    .trim();
  if (!extractedText) throw new Error("No readable text was found in this source.");
  const chunks = chunkKnowledge(extractedText);
  if (!chunks.length) throw new Error("No searchable text was found in this source.");
  return { extractedText, chunks };
}

export function knowledgeFileType(fileName: string) {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "pdf") return "PDF" as const;
  if (extension === "doc" || extension === "docx") return "WORD" as const;
  if (extension === "txt") return "TEXT_FILE" as const;
  return null;
}

export async function retrieveKnowledge(query: string, resultLimit: number, contextBudget: number) {
  if (!query.trim()) return [];
  const rows = await getPrisma().$queryRaw<Array<{ id: string; sourceId: string; sourceName: string; content: string; score: number }>>`
    SELECT chunk."id", chunk."source_id" AS "sourceId", source."name" AS "sourceName", chunk."content",
      ts_rank_cd(to_tsvector('english', chunk."content"), websearch_to_tsquery('english', ${query}))::float AS "score"
    FROM "knowledge_chunks" chunk
    JOIN "knowledge_sources" source ON source."id" = chunk."source_id"
    WHERE source."archived_at" IS NULL
      AND source."extraction_status" = 'READY'
      AND to_tsvector('english', chunk."content") @@ websearch_to_tsquery('english', ${query})
    ORDER BY "score" DESC, chunk."ordinal"
    LIMIT ${resultLimit}
  `;
  let used = 0;
  return rows.filter((row) => {
    const tokens = Math.ceil(row.content.length / 4);
    if (used + tokens > contextBudget) return false;
    used += tokens;
    return true;
  });
}
