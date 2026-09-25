export function parseCsv(source: string) {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  if (row.length || field || !rows.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const text = /^[\t ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function guessCsvField(header: string) {
  if (!header.trim()) return "";
  const key = header.trim().toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return ({
    email: "email",
    emailaddress: "email",
    firstname: "firstName",
    lastname: "lastName",
    company: "company",
    companyname: "company",
    title: "title",
    jobtitle: "title",
    tags: "tags",
  } as Record<string, string>)[key] ?? `custom:${header.trim().slice(0, 80)}`;
}
