"use client";

import { useState, type ChangeEvent } from "react";
import { guessCsvField, parseCsv } from "@/lib/csv";

const choices = [
  ["", "Skip column"],
  ["email", "Email (required)"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["company", "Company"],
  ["title", "Job title"],
  ["tags", "Tags"],
] as const;

export function CsvImport() {
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError("");
    setRows([]);
    if (!file) return;
    if (file.size > 5_000_000) {
      setError("CSV files must be 5 MB or smaller.");
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2 || parsed.length - 1 > 20_000) throw new Error("CSV must contain 1–20,000 data rows.");
      setRows(parsed.slice(0, 6));
      setMapping(parsed[0].map(guessCsvField));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The CSV could not be read.");
    }
  }

  return (
    <form action="/api/contacts/import" method="post" encType="multipart/form-data" className="mt-5 space-y-4">
      <label className="block text-sm font-medium">
        CSV file
        <input className="input mt-2" name="file" type="file" accept=".csv,text/csv" onChange={inspect} required />
      </label>
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      {rows.length ? (
        <>
          <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-[var(--surface-soft)]">
                <tr>{rows[0].map((header, index) => <th key={index} className="p-3 font-semibold">{header || `Column ${index + 1}`}</th>)}</tr>
                <tr>{rows[0].map((header, index) => (
                  <th key={index} className="p-2">
                    <select
                      aria-label={`Map ${header || `column ${index + 1}`}`}
                      className="input text-xs"
                      value={mapping[index] ?? ""}
                      onChange={(event) => setMapping((current) => current.map((value, position) => position === index ? event.target.value : value))}
                    >
                      {choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      <option value={`custom:${header.trim().slice(0, 80)}`}>Custom: {header || `Column ${index + 1}`}</option>
                    </select>
                  </th>
                ))}</tr>
              </thead>
              <tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex} className="border-t">{rows[0].map((_, column) => <td key={column} className="max-w-48 truncate p-3">{row[column] || "—"}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--muted)]">Previewing the first {rows.length - 1} rows. Existing and repeated email addresses are skipped; valid rows still import when other rows fail.</p>
          <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={mapping.filter((field) => field === "email").length !== 1}>
            Import contacts
          </button>
        </>
      ) : null}
    </form>
  );
}
