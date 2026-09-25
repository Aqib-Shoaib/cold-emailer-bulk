import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { knowledgeFileType, MAX_KNOWLEDGE_FILE_BYTES, prepareKnowledge } from "@/lib/knowledge";
import { getPrisma } from "@/lib/prisma";

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/knowledge?${query}`, requestOrigin(request)), 303);
}

async function replaceChunks(tx: Prisma.TransactionClient, sourceId: string, chunks: string[]) {
  await tx.knowledgeChunk.deleteMany({ where: { sourceId } });
  for (let start = 0; start < chunks.length; start += 1_000) {
    await tx.knowledgeChunk.createMany({ data: chunks.slice(start, start + 1_000).map((content, offset) => ({ sourceId, ordinal: start + offset, content })) });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);
  const action = (await params).action;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_KNOWLEDGE_FILE_BYTES + 1_000_000) return back(request, "error=size");
  const form = await request.formData();
  const prisma = getPrisma();

  if (action === "create") {
    const name = String(form.get("name") ?? "").trim();
    const pasted = String(form.get("content") ?? "");
    const file = form.get("file");
    if (!name || name.length > 160) return back(request, "error=invalid");
    let type: "PASTED_TEXT" | "PDF" | "WORD" | "TEXT_FILE";
    let fileName = "";
    let mimeType = "text/plain";
    let content: Buffer;
    if (file instanceof File && file.size > 0) {
      const detected = knowledgeFileType(file.name);
      if (!detected) return back(request, "error=type");
      if (file.size > MAX_KNOWLEDGE_FILE_BYTES) return back(request, "error=size");
      type = detected;
      fileName = basename(file.name).slice(0, 255);
      mimeType = file.type.slice(0, 120);
      content = Buffer.from(await file.arrayBuffer());
    } else {
      type = "PASTED_TEXT";
      content = Buffer.from(pasted, "utf8");
      if (content.length > MAX_KNOWLEDGE_FILE_BYTES) return back(request, "error=size");
    }
    const id = randomUUID();
    try {
      const prepared = await prepareKnowledge(type, content);
      // ponytail: originals up to 20 MB stay in PostgreSQL; use object storage only if backup size becomes material.
      await prisma.$transaction(async (tx) => {
        await tx.knowledgeSource.create({ data: { id, name, type, fileName, mimeType, originalContent: Uint8Array.from(content), extractedText: prepared.extractedText, processedAt: new Date(), createdByUserId: session.user.id } });
        await replaceChunks(tx, id, prepared.chunks);
        await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "knowledge.created", targetType: "KnowledgeSource", targetId: id } });
      });
      return back(request, `notice=created&source=${id}`);
    } catch (error) {
      await prisma.$transaction([
        prisma.knowledgeSource.create({ data: { id, name, type, fileName, mimeType, originalContent: Uint8Array.from(content), extractedText: "", extractionStatus: "FAILED", extractionError: (error instanceof Error ? error.message : "Extraction failed.").slice(0, 500), createdByUserId: session.user.id } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "knowledge.extraction_failed", targetType: "KnowledgeSource", targetId: id } }),
      ]);
      return back(request, `error=extraction&source=${id}`);
    }
  }

  const sourceId = String(form.get("sourceId") ?? "");
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) return back(request, "error=invalid");

  if (action === "archive" || action === "restore") {
    await prisma.$transaction([
      prisma.knowledgeSource.update({ where: { id: source.id }, data: { archivedAt: action === "archive" ? new Date() : null } }),
      prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: `knowledge.${action}d`, targetType: "KnowledgeSource", targetId: source.id } }),
    ]);
    return back(request, "notice=updated");
  }

  if (action === "update") {
    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > 160) return back(request, `error=invalid&source=${source.id}`);
    const pasted = String(form.get("content") ?? "");
    if (source.type !== "PASTED_TEXT" || !pasted.trim()) {
      await prisma.$transaction([
        prisma.knowledgeSource.update({ where: { id: source.id }, data: { name } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "knowledge.updated", targetType: "KnowledgeSource", targetId: source.id } }),
      ]);
    } else {
      const content = Buffer.from(pasted, "utf8");
      if (content.length > MAX_KNOWLEDGE_FILE_BYTES) return back(request, `error=size&source=${source.id}`);
      try {
        const prepared = await prepareKnowledge("PASTED_TEXT", content);
        await prisma.$transaction(async (tx) => {
          await tx.knowledgeSource.update({ where: { id: source.id }, data: { name, originalContent: Uint8Array.from(content), extractedText: prepared.extractedText, extractionStatus: "READY", extractionError: "", processedAt: new Date() } });
          await replaceChunks(tx, source.id, prepared.chunks);
          await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "knowledge.updated", targetType: "KnowledgeSource", targetId: source.id } });
        });
      } catch {
        return back(request, `error=extraction&source=${source.id}`);
      }
    }
    return back(request, `notice=updated&source=${source.id}`);
  }

  if (action === "reprocess") {
    if (!source.originalContent) return back(request, `error=missing-original&source=${source.id}`);
    try {
      const prepared = await prepareKnowledge(source.type, Buffer.from(source.originalContent));
      await prisma.$transaction(async (tx) => {
        await tx.knowledgeSource.update({ where: { id: source.id }, data: { extractedText: prepared.extractedText, extractionStatus: "READY", extractionError: "", processedAt: new Date() } });
        await replaceChunks(tx, source.id, prepared.chunks);
        await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "knowledge.reprocessed", targetType: "KnowledgeSource", targetId: source.id } });
      });
      return back(request, `notice=reprocessed&source=${source.id}`);
    } catch (error) {
      await prisma.knowledgeSource.update({ where: { id: source.id }, data: { extractionStatus: "FAILED", extractionError: (error instanceof Error ? error.message : "Extraction failed.").slice(0, 500), processedAt: new Date() } });
      return back(request, `error=extraction&source=${source.id}`);
    }
  }

  return back(request, "error=invalid");
}

export const dynamic = "force-dynamic";
