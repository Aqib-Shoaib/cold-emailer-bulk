const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export type InboundKind = "REPLY" | "HARD_BOUNCE" | "AUTO_REPLY" | "UNMATCHED" | "REVIEW";

export interface InboundClassificationInput {
  fromEmail: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  hasOutboundReference: boolean;
}

export function normalizeMessageId(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("<") ? trimmed : `<${trimmed.replace(/[<>]/g, "")}>`;
}

export function safeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replace(/\r\n|\r|\n/g, "<br>");
}

export function extractBounceRecipient(input: Pick<InboundClassificationInput, "text" | "headers">) {
  const candidates = [
    input.headers["x-failed-recipients"],
    /(?:Final|Original)-Recipient:\s*rfc822;\s*([^\s;]+)/i.exec(input.text)?.[1],
  ];
  for (const candidate of candidates) {
    const match = candidate?.match(EMAIL)?.[0]?.toLowerCase();
    if (match) return match;
  }
  return "";
}

export function classifyInbound(input: InboundClassificationInput): { kind: InboundKind; bounceEmail: string; reason: string } {
  const from = input.fromEmail.toLowerCase();
  const subject = input.subject.toLowerCase();
  const autoSubmitted = input.headers["auto-submitted"]?.toLowerCase() ?? "";
  const precedence = input.headers.precedence?.toLowerCase() ?? "";
  const bounceEmail = extractBounceRecipient(input);
  const deliveryReport = /multipart\/report|message\/delivery-status/i.test(input.headers["content-type"] ?? "");
  const bounceSender = /(?:mailer-daemon|postmaster)@/.test(from);
  const permanentFailure = /(?:action:\s*failed|status:\s*5\.\d\.\d|permanent failure|delivery (?:has )?failed|undeliverable)/i.test(`${input.text}\n${input.subject}`);

  if (bounceEmail && (deliveryReport || bounceSender) && permanentFailure) {
    return { kind: "HARD_BOUNCE", bounceEmail, reason: "Recognized permanent delivery failure." };
  }

  if (
    (autoSubmitted && autoSubmitted !== "no") ||
    /(?:auto[- ]?reply|auto[- ]?response|out of (?:the )?office|vacation reply)/i.test(subject) ||
    Boolean(input.headers["x-autoreply"]) ||
    ["bulk", "junk", "list"].includes(precedence)
  ) {
    return { kind: "AUTO_REPLY", bounceEmail: "", reason: "Automatic response; follow-ups remain unchanged." };
  }

  if (input.hasOutboundReference) return { kind: "REPLY", bounceEmail: "", reason: "Matched to an outbound Message-ID." };
  if (bounceEmail || bounceSender || permanentFailure) {
    return { kind: "REVIEW", bounceEmail, reason: "Possible bounce needs review before suppression." };
  }
  return { kind: "UNMATCHED", bounceEmail: "", reason: "No outbound Message-ID match; associate it manually." };
}

export function replySubject(subject: string) {
  const value = subject.trim().slice(0, 500);
  return /^re:/i.test(value) ? value : `Re: ${value || "Your message"}`;
}
