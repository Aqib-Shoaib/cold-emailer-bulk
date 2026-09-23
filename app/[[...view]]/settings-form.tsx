"use client";

import { Info } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import type { PublicSettings } from "@/lib/settings";
import type { SettingFieldDef, SettingSectionDef } from "@/lib/settings-schema";

export interface SettingsFeedback {
  kind: "none" | "saved" | "validation" | "forbidden" | "encryption" | "secret" | "smtp-ok" | "smtp-failed" | "imap-ok" | "imap-failed" | "test";
  fields: string[];
  detail: string;
}

const inputClass =
  "h-11 w-full rounded-xl border bg-[var(--surface-raised)] px-3.5 text-sm text-[var(--foreground)] placeholder:text-[var(--subtle)]";

export function SettingsForm({
  sections,
  settings,
  feedback,
}: {
  sections: readonly SettingSectionDef[];
  settings: PublicSettings;
  feedback: SettingsFeedback;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function submit(form: HTMLFormElement, action: string) {
    setPending(action);
    try {
      const body = new FormData(form);
      body.delete("__unused__");
      const response = await fetch(`/api/settings/${action}`, { method: "POST", body });
      if (response.redirected) {
        const url = new URL(response.url);
        const query = url.search.startsWith("?") ? url.search.slice(1) : "";
        router.replace(`/settings${query ? `?${query}` : ""}`);
      } else {
        router.replace("/settings");
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  const sectionHasError = (section: SettingSectionDef) =>
    feedback.fields.some((field) => section.fields.some((entry) => entry.key === field));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSections = normalizedQuery
    ? sections.filter((section) =>
        [section.title, section.description, ...section.fields.flatMap((field) => [field.label, field.hint])]
          .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
      )
    : sections;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="sr-only">Search settings</span>
        <input
          className={inputClass}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings by section or field"
        />
      </label>
      {visibleSections.map((section, index) => (
        <details
          key={section.id}
          open={normalizedQuery.length > 0 || index < 2 || sectionHasError(section)}
          className="group rounded-2xl border bg-[var(--surface)] shadow-[0_12px_34px_rgba(31,54,42,0.045)]"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 sm:px-6">
            <div>
              <h2 className="font-semibold tracking-tight">{section.title}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{section.description}</p>
            </div>
            {sectionHasError(section) ? (
              <span className="rounded-lg bg-[var(--danger-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)]">Check this section</span>
            ) : null}
            <span className="text-sm font-medium text-[var(--accent-strong)] group-open:hidden">Open</span>
            <span className="hidden text-sm font-medium text-[var(--accent-strong)] group-open:inline">Close</span>
          </summary>
          <form
            className="border-t"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(event.currentTarget, "save");
            }}
          >
            <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
              {section.fields.map((field) => (
                <SettingInput
                  key={field.key}
                  field={field}
                  settings={settings}
                  hasError={feedback.fields.includes(field.key)}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-4 sm:px-6">
              {section.id === "smtp" || section.id === "imap" ? (
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={(event) => {
                    const form = event.currentTarget.form;
                    if (form) void submit(form, `test-${section.id}`);
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border bg-[var(--surface-raised)] px-3.5 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-soft)] disabled:opacity-60"
                >
                  {pending === `test-${section.id}` ? "Testing…" : "Test connection"}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={pending !== null}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                {pending === "save" ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </details>
      ))}
      {visibleSections.length === 0 ? (
        <p role="status" className="rounded-2xl border bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
          No settings match “{query}”.
        </p>
      ) : null}
      {pending ? <p className="sr-only" role="status">Working…</p> : null}
    </div>
  );
}

function SettingInput({
  field,
  settings,
  hasError,
}: {
  field: SettingFieldDef;
  settings: PublicSettings;
  hasError: boolean;
}) {
  const hintId = `hint-${field.key}`;
  const invalid = hasError ? { "aria-invalid": true, "aria-describedby": hintId } : {};

  if (field.secretField) {
    const configured = settings.secrets[field.secretField];
    return (
      <div className="block">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {field.label}
          <Info size={14} className="text-[var(--subtle)]" aria-label={field.hint} />
        </span>
        <span id={hintId} className="mt-1 block text-xs leading-5 text-[var(--muted)]">
          {configured ? "Configured. Enter a new value to replace it; it is never shown again." : field.hint}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <input
            aria-label={field.label}
            className={inputClass}
            name={field.key}
            type="password"
            autoComplete="new-password"
            placeholder={configured ? "••••••••" : "Not configured"}
            {...invalid}
          />
          {configured ? (
            <span className="whitespace-nowrap rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">Saved</span>
          ) : null}
        </span>
        {configured ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--danger)]">
            <input name={`${field.key}__remove`} type="checkbox" />
            Remove the saved value when this section is saved
          </label>
        ) : null}
      </div>
    );
  }

  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {field.label}
        <Info size={14} className="text-[var(--subtle)]" aria-label={field.hint} />
      </span>
      <span id={hintId} className="mt-1 block text-xs leading-5 text-[var(--muted)]">{field.hint}</span>
      <span className="mt-2 block">{inputFor(field, settings, invalid, inputClass)}</span>
    </label>
  );
}

function inputFor(
  field: SettingFieldDef,
  settings: PublicSettings,
  invalid: Record<string, unknown>,
  inputClass: string,
): ReactNode {
  const value = settings.values[field.key] ?? field.default;

  if (field.type === "select") {
    return (
      <select className={inputClass} name={field.key} defaultValue={value} {...invalid}>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (field.type === "textarea") {
    return <textarea className="h-auto resize-y py-3" rows={3} name={field.key} defaultValue={value} maxLength={field.maxLength} {...invalid} />;
  }

  return (
    <input
      className={inputClass}
      name={field.key}
      type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
      defaultValue={value}
      min={field.type === "number" ? field.min : undefined}
      max={field.type === "number" ? field.max : undefined}
      maxLength={field.maxLength}
      {...invalid}
    />
  );
}
