import { normalizeEmail } from "./auth.ts";
import { getPrisma } from "./prisma.ts";

const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export interface ContactInput {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  tags: string[];
  customFields: Record<string, string | number | boolean | null>;
}

export function parseContactInput(form: FormData): ContactInput | null {
  let customFields: unknown = {};
  try {
    customFields = JSON.parse(String(form.get("customFields") || "{}"));
  } catch {
    return null;
  }
  return parseContactValues({
    email: form.get("email"),
    firstName: form.get("firstName"),
    lastName: form.get("lastName"),
    company: form.get("company"),
    title: form.get("title"),
    tags: form.get("tags"),
    customFields,
  });
}

export function parseContactValues(values: Record<string, unknown>): ContactInput | null {
  const email = normalizeEmail(String(values.email ?? ""));
  const firstName = String(values.firstName ?? "").trim();
  const lastName = String(values.lastName ?? "").trim();
  const company = String(values.company ?? "").trim();
  const title = String(values.title ?? "").trim();
  const tags = [...new Set(
    (Array.isArray(values.tags) ? values.tags : String(values.tags ?? "").split(","))
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => tag.toLocaleLowerCase()),
  )];
  const customFields = values.customFields;
  const validCustomFields = customFields !== null && typeof customFields === "object" && !Array.isArray(customFields) &&
    Object.entries(customFields).length <= 50 &&
    Object.entries(customFields).every(([key, value]) => key.trim().length > 0 && key.length <= 80 &&
      (value === null || ["string", "number", "boolean"].includes(typeof value))) &&
    JSON.stringify(customFields).length <= 10_000;

  if (
    !EMAIL_PATTERN.test(email) || email.length > 320 ||
    firstName.length > 120 || lastName.length > 120 ||
    company.length > 160 || title.length > 160 ||
    [firstName, lastName, company, title].some((value) => /[\r\n]/.test(value)) ||
    tags.length > 30 || tags.some((tag) => tag.length > 40) || !validCustomFields
  ) return null;

  return { email, firstName, lastName, company, title, tags, customFields: customFields as ContactInput["customFields"] };
}

export async function countSelectableContacts() {
  const [result] = await getPrisma().$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS "count"
    FROM "contacts" AS contact
    WHERE contact."archived_at" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "suppressions" AS suppression
        WHERE suppression."email" = contact."email"
      )
  `;
  return result?.count ?? 0;
}
