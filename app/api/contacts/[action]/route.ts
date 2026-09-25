import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getRequestSession, isSameOrigin, requestOrigin } from "@/lib/auth";
import { parseContactInput, parseContactValues, type ContactInput } from "@/lib/contacts";
import { csvCell, parseCsv } from "@/lib/csv";
import { getPrisma } from "@/lib/prisma";

const PAGE_SIZE = 500;
const MAX_IMPORT_BYTES = 5_000_000;
const MAX_IMPORT_ROWS = 20_000;
const CSV_FIELDS = new Set(["", "email", "firstName", "lastName", "company", "title", "tags"]);

function back(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/contacts?${query}`, requestOrigin(request)), 303);
}

function contactWhere(url: URL): Prisma.ContactWhereInput {
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = url.searchParams.get("status") === "archived" ? "archived" : "active";
  const listId = url.searchParams.get("list") ?? "";
  return {
    archivedAt: status === "archived" ? { not: null } : null,
    ...(listId ? { memberships: { some: { listId } } } : {}),
    ...(query ? {
      OR: ["email", "firstName", "lastName", "company", "title"].map((field) => ({
        [field]: { contains: query, mode: "insensitive" as const },
      })),
    } : {}),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);
  if ((await params).action !== "export") return new NextResponse("Not found", { status: 404 });

  const prisma = getPrisma();
  const where = contactWhere(request.nextUrl);
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("email,first_name,last_name,company,title,tags,custom_fields,suppression_reason\r\n"));
      try {
        for (;;) {
          const contacts = await prisma.contact.findMany({
            where,
            orderBy: { id: "asc" },
            take: PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (!contacts.length) break;
          const suppressions = new Map((await prisma.suppression.findMany({
            where: { email: { in: contacts.map(({ email }) => email) } },
          })).map(({ email, reason }) => [email, reason]));
          const body = contacts.map((contact) => [
            contact.email,
            contact.firstName,
            contact.lastName,
            contact.company,
            contact.title,
            contact.tags.join("; "),
            JSON.stringify(contact.customFields),
            suppressions.get(contact.email) ?? "",
          ].map(csvCell).join(",")).join("\r\n");
          controller.enqueue(encoder.encode(`${body}\r\n`));
          cursor = contacts.at(-1)?.id;
          if (contacts.length < PAGE_SIZE) break;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return NextResponse.redirect(new URL("/login", requestOrigin(request)), 303);

  const action = (await params).action;
  const form = await request.formData();
  const prisma = getPrisma();

  try {
    if (action === "create") {
      const data = parseContactInput(form);
      if (!data) return back(request, "error=invalid");
      const id = randomUUID();
      await prisma.$transaction([
        prisma.contact.create({ data: { id, ...data } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "contact.created", targetType: "Contact", targetId: id } }),
      ]);
      return back(request, "notice=created");
    }

    if (action === "import") return importContacts(request, form, session.user.id);

    if (action === "create-list") {
      const name = String(form.get("name") ?? "").trim();
      const description = String(form.get("description") ?? "").trim();
      if (!name || name.length > 160 || description.length > 500) return back(request, "error=invalid");
      const id = randomUUID();
      await prisma.$transaction([
        prisma.contactList.create({ data: { id, name, description } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "contact_list.created", targetType: "ContactList", targetId: id } }),
      ]);
      return back(request, "notice=list-created");
    }

    if (action === "delete-list") {
      const listId = String(form.get("listId") ?? "");
      const removed = await prisma.contactList.deleteMany({ where: { id: listId } });
      if (!removed.count) return back(request, "error=invalid");
      await prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "contact_list.deleted", targetType: "ContactList", targetId: listId } });
      return back(request, "notice=updated");
    }

    const contactId = String(form.get("contactId") ?? "");
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return back(request, "error=invalid");

    if (action === "update") {
      const data = parseContactInput(form);
      if (!data) return back(request, "error=invalid");
      await prisma.$transaction([
        prisma.contact.update({ where: { id: contact.id }, data }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "contact.updated", targetType: "Contact", targetId: contact.id } }),
      ]);
    } else if (action === "add-list" || action === "remove-list") {
      const listId = String(form.get("listId") ?? "");
      const list = await prisma.contactList.findUnique({ where: { id: listId }, select: { id: true } });
      if (!list) return back(request, "error=invalid");
      if (action === "add-list") {
        await prisma.contactListMember.upsert({ where: { listId_contactId: { listId, contactId } }, create: { listId, contactId }, update: {} });
      } else {
        await prisma.contactListMember.deleteMany({ where: { listId, contactId } });
      }
      await prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: `contact_list.${action === "add-list" ? "member_added" : "member_removed"}`, targetType: "Contact", targetId: contact.id } });
    } else if (action === "archive" || action === "restore") {
      await prisma.$transaction([
        prisma.contact.update({ where: { id: contact.id }, data: { archivedAt: action === "archive" ? new Date() : null } }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: `contact.${action}d`, targetType: "Contact", targetId: contact.id } }),
      ]);
    } else if (action === "suppress") {
      await prisma.$transaction([
        prisma.suppression.upsert({ where: { email: contact.email }, create: { email: contact.email, reason: "MANUAL" }, update: {} }),
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "contact.suppressed", targetType: "Contact", targetId: contact.id } }),
      ]);
    } else if (action === "unsuppress") {
      await prisma.$transaction(async (tx) => {
        const removed = await tx.suppression.deleteMany({ where: { email: contact.email, reason: "MANUAL" } });
        if (!removed.count) throw new Error("Only manual suppressions can be removed here");
        await tx.auditEvent.create({ data: { actorUserId: session.user.id, action: "contact.unsuppressed", targetType: "Contact", targetId: contact.id } });
      });
    } else if (action === "delete") {
      await prisma.$transaction([
        prisma.auditEvent.create({ data: { actorUserId: session.user.id, action: "contact.deleted", targetType: "Contact", targetId: contact.id } }),
        prisma.contact.delete({ where: { id: contact.id } }),
      ]);
    } else return back(request, "error=invalid");

    return back(request, "notice=updated");
  } catch {
    return back(request, "error=invalid");
  }
}

async function importContacts(request: NextRequest, form: FormData, userId: string) {
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv") || file.size > MAX_IMPORT_BYTES) return back(request, "error=invalid");

  const rows = parseCsv(await file.text());
  if (rows.length < 2 || rows.length - 1 > MAX_IMPORT_ROWS) return back(request, "error=invalid");
  const mapping = JSON.parse(String(form.get("mapping") ?? "[]"));
  if (!Array.isArray(mapping) || mapping.length !== rows[0].length || mapping.filter((field) => field === "email").length !== 1 ||
    mapping.some((field, index) => typeof field !== "string" || (!CSV_FIELDS.has(field) && field !== `custom:${rows[0][index].trim().slice(0, 80)}`))) {
    return back(request, "error=invalid");
  }

  const errors: string[] = [];
  const contacts: ContactInput[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  rows.slice(1).forEach((row, index) => {
    const values: Record<string, unknown> = { customFields: {} };
    mapping.forEach((field, column) => {
      if (!field) return;
      const value = row[column] ?? "";
      if (field.startsWith("custom:")) (values.customFields as Record<string, string>)[field.slice(7)] = value;
      else values[field] = field === "tags" ? value.replaceAll(";", ",") : value;
    });
    const contact = parseContactValues(values);
    if (!contact) errors.push(`Row ${index + 2}: invalid or oversized contact data.`);
    else if (seen.has(contact.email)) duplicates += 1;
    else {
      seen.add(contact.email);
      contacts.push(contact);
    }
  });

  const prisma = getPrisma();
  const imported = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (let offset = 0; offset < contacts.length; offset += 1_000) {
      count += (await tx.contact.createMany({ data: contacts.slice(offset, offset + 1_000), skipDuplicates: true })).count;
    }
    duplicates += contacts.length - count;
    await tx.contactImport.create({ data: {
      fileName: file.name.slice(0, 255),
      totalRows: rows.length - 1,
      importedCount: count,
      duplicateCount: duplicates,
      invalidCount: errors.length,
      errors,
      createdByUserId: userId,
    } });
    await tx.auditEvent.create({ data: { actorUserId: userId, action: "contacts.imported", targetType: "ContactImport" } });
    return count;
  }, { timeout: 30_000 });
  return back(request, `notice=imported&imported=${imported}&duplicates=${duplicates}&invalid=${errors.length}`);
}

export const dynamic = "force-dynamic";
