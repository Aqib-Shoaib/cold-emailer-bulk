import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getRequestSession, isSameOrigin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { draftWarnings, generateGeminiDraft } from "@/lib/gemini";
import { retrieveKnowledge } from "@/lib/knowledge";
import { getPrisma } from "@/lib/prisma";
import { settingsValues, SETTINGS_ROW_ID } from "@/lib/settings";
import { GEMINI_MODELS } from "@/lib/settings-schema";
import { parseTemplateInput } from "@/lib/templates";
import { recordServiceStatus } from "@/lib/operations";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!isSameOrigin(request)) return error("Forbidden", 403);
  const session = await getRequestSession(request);
  if (!session) return error("Sign in again.", 401);
  const action = (await params).action;
  if (action !== "generate" && action !== "approve") return error("Not found", 404);

  const input = await request.json() as Record<string, unknown>;
  const prisma = getPrisma();
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
  const values = settingsValues(settings?.values);

  if (action === "approve") {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const textBody = typeof input.body === "string" ? input.body.trim() : "";
    const recipient = { firstName: "set", lastName: "set", email: "set@example.com", company: "set", title: "set" };
    const forbidden = values.aiForbiddenClaims.split("\n").map((value) => value.trim()).filter(Boolean);
    if (draftWarnings(subject, textBody, forbidden, recipient).length) return error("Remove prohibited claims or phrases before approval.");
    const form = new FormData();
    form.set("name", name);
    form.set("subject", subject);
    form.set("textBody", textBody);
    const template = parseTemplateInput(form);
    if (!template) return error("The edited draft is incomplete or invalid.");
    const id = randomUUID();
    await prisma.$transaction([
      prisma.template.create({ data: { id, ...template } }),
      prisma.templateVersion.create({ data: { templateId: id, version: 1, subject: template.subject, textBody: template.textBody, htmlBody: template.htmlBody, createdByUserId: session.user.id } }),
      prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "ai_draft.approved", targetType: "Template", targetId: id } }),
    ]);
    return NextResponse.json({ templateId: id });
  }

  const goal = typeof input.goal === "string" ? input.goal.trim() : "";
  const contactId = typeof input.contactId === "string" ? input.contactId : "";
  if (!goal || goal.length > 2_000 || !contactId) return error("Choose a contact and enter a drafting goal.");
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.archivedAt) return error("Choose an active contact.");
  if (!settings?.aiApiKeyEnc) return error("Save a Gemini API key in Settings first.");
  const model = values.aiModel;
  if (!(GEMINI_MODELS as readonly string[]).includes(model)) return error("Choose a supported Gemini model in Settings first.");
  const knowledge = await retrieveKnowledge(`${goal} ${contact.company} ${contact.title}`, Number(values.aiKnowledgeResultLimit), Number(values.aiContextBudget));
  try {
    const apiKey = decryptSecret(process.env.SETTINGS_ENCRYPTION_KEY ?? "", settings.aiApiKeyEnc);
    if (!apiKey) throw new Error("The saved Gemini API key could not be read.");
    const draft = await generateGeminiDraft({
      model,
      apiKey,
      timeoutMs: Number(values.aiTimeoutSeconds) * 1_000,
      retries: Number(values.aiRetryLimit),
      temperature: Number(values.aiTemperaturePercent) / 100,
      maxOutputTokens: Number(values.aiMaxOutputLength),
      tone: typeof input.tone === "string" && input.tone.trim() ? input.tone.trim() : values.aiDefaultTone,
      language: values.aiLanguage,
      goal,
      signature: values.aiSignature,
      forbidden: values.aiForbiddenClaims.split("\n").map((value) => value.trim()).filter(Boolean),
      recipient: contact,
      knowledge,
    });
    const cited = new Set(draft.citationIds);
    await recordServiceStatus("ai", "OK").catch(() => undefined);
    return NextResponse.json({ ...draft, model, sources: knowledge.filter((chunk) => cited.has(chunk.id)).map(({ id, sourceName, content }) => ({ id, sourceName, excerpt: content.slice(0, 240) })) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Gemini could not generate a draft.";
    await recordServiceStatus("ai", "ERROR", message).catch(() => undefined);
    return error(message, 502);
  }
}

export const dynamic = "force-dynamic";
