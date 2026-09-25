export const TEMPLATE_VARIABLES = [
  "contact.first_name",
  "contact.last_name",
  "contact.email",
  "contact.company",
  "contact.title",
  "campaign.name",
  "sender.name",
  "sender.company",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateContext = Record<TemplateVariable, string>;

export interface TemplateSource {
  subject: string;
  textBody: string;
  htmlBody: string;
}

const TOKEN = /{{\s*([a-z][a-z0-9_.]*)\s*}}/gi;
const supported = new Set<string>(TEMPLATE_VARIABLES);

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function textToSafeHtml(text: string) {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`)
    .join("");
}

export function unsupportedVariables(...values: string[]) {
  const invalid = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(/{{([\s\S]*?)}}/g)) {
      const variable = match[1].trim();
      if (!supported.has(variable)) invalid.add(variable || "empty variable");
    }
    if (value.replaceAll(/{{[\s\S]*?}}/g, "").includes("{{") || value.replaceAll(/{{[\s\S]*?}}/g, "").includes("}}")) {
      invalid.add("malformed variable");
    }
  }
  return [...invalid];
}

export function parseTemplateInput(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const textBody = String(form.get("textBody") ?? "").trim();
  if (!name || name.length > 160 || !subject || subject.length > 300 || /[\r\n]/.test(subject) || !textBody || textBody.length > 100_000) return null;
  if (unsupportedVariables(subject, textBody).length) return null;
  return { name, subject, textBody, htmlBody: textToSafeHtml(textBody) };
}

function renderValue(value: string, context: TemplateContext, html: boolean, missing: Set<TemplateVariable>) {
  return value.replace(TOKEN, (_token, raw: string) => {
    const variable = raw.toLowerCase() as TemplateVariable;
    const replacement = context[variable]?.trim() ?? "";
    if (!replacement) missing.add(variable);
    return html ? escapeHtml(replacement) : replacement;
  });
}

export function renderTemplate(source: TemplateSource, context: TemplateContext) {
  const missing = new Set<TemplateVariable>();
  return {
    subject: renderValue(source.subject, context, false, missing),
    text: renderValue(source.textBody, context, false, missing),
    html: renderValue(source.htmlBody, context, true, missing),
    missing: [...missing].sort(),
  };
}

export interface BulkFooter {
  senderName: string;
  companyName: string;
  physicalAddress: string;
  footerText: string;
  unsubscribeUrl: string;
}

export function appendBulkFooter(rendered: ReturnType<typeof renderTemplate>, footer: BulkFooter) {
  if (!footer.senderName.trim() || !footer.companyName.trim() || !footer.physicalAddress.trim() || !/^https?:\/\//.test(footer.unsubscribeUrl)) {
    throw new Error("Sender identity, physical address, and unsubscribe URL are required.");
  }
  const identity = `${footer.senderName.trim()}, ${footer.companyName.trim()}`;
  const textFooter = `\n\n---\n${identity}\n${footer.physicalAddress.trim()}\n${footer.footerText.trim()}\nUnsubscribe: ${footer.unsubscribeUrl}`;
  const htmlFooter = `<hr><p>${escapeHtml(identity)}<br>${escapeHtml(footer.physicalAddress.trim())}<br>${escapeHtml(footer.footerText.trim())}<br><a href="${escapeHtml(footer.unsubscribeUrl)}">Unsubscribe</a></p>`;
  return { ...rendered, text: rendered.text + textFooter, html: rendered.html + htmlFooter };
}

export function templateContext(input: {
  contact: { firstName: string; lastName: string; email: string; company: string; title: string };
  campaignName: string;
  senderName: string;
  senderCompany: string;
}): TemplateContext {
  return {
    "contact.first_name": input.contact.firstName,
    "contact.last_name": input.contact.lastName,
    "contact.email": input.contact.email,
    "contact.company": input.contact.company,
    "contact.title": input.contact.title,
    "campaign.name": input.campaignName,
    "sender.name": input.senderName,
    "sender.company": input.senderCompany,
  };
}

export function contactsMissingVariables(
  source: TemplateSource,
  contacts: Array<{ firstName: string; lastName: string; email: string; company: string; title: string }>,
  common: { campaignName: string; senderName: string; senderCompany: string },
) {
  return contacts.flatMap((contact) => {
    const missing = renderTemplate(source, templateContext({ contact, ...common })).missing;
    return missing.length ? [{ email: contact.email, missing }] : [];
  });
}
