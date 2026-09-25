"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Draft {
  subject: string;
  body: string;
  model: string;
  warnings: string[];
  sources: Array<{ id: string; sourceName: string; excerpt: string }>;
}

export function AiDraftAssistant({ contacts }: { contacts: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [tone, setTone] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Draft[]>([]);
  const [pending, setPending] = useState<"generate" | "approve" | null>(null);
  const [error, setError] = useState("");

  async function generate() {
    setPending("generate");
    setError("");
    try {
      const response = await fetch("/api/ai/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal, contactId, tone }) });
      const result = await response.json() as Draft & { error?: string };
      if (!response.ok) throw new Error(result.error || "Gemini could not generate a draft.");
      if (draft) setHistory((items) => [draft, ...items].slice(0, 4));
      setDraft(result);
      setName((current) => current || `AI draft — ${goal}`.slice(0, 160));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gemini could not generate a draft.");
    } finally {
      setPending(null);
    }
  }

  async function approve() {
    if (!draft) return;
    setPending("approve");
    setError("");
    try {
      const response = await fetch("/api/ai/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, subject: draft.subject, body: draft.body }) });
      const result = await response.json() as { templateId?: string; error?: string };
      if (!response.ok || !result.templateId) throw new Error(result.error || "The draft could not be approved.");
      router.push(`/templates?notice=created&template=${result.templateId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The draft could not be approved.");
      setPending(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Recipient
          <select className="input mt-2" value={contactId} onChange={(event) => setContactId(event.target.value)}>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Tone
          <input className="input mt-2" value={tone} onChange={(event) => setTone(event.target.value)} placeholder="Use the default from Settings" maxLength={120} />
        </label>
      </div>
      <label className="block text-sm font-medium">Goal
        <textarea className="input mt-2 h-auto resize-y py-3" rows={4} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What should this email accomplish?" maxLength={2000} />
      </label>
      <button className="inline-flex min-h-10 items-center rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" type="button" disabled={pending !== null || !goal.trim() || !contactId} onClick={() => void generate()}>
        {pending === "generate" ? "Drafting…" : draft ? "Regenerate" : "Generate grounded draft"}
      </button>
      {error ? <p role="alert" className="rounded-xl bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{error} Your current inputs and draft were preserved.</p> : null}
      {draft ? (
        <div className="space-y-4 border-t pt-5">
          <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Editable draft</h3><span className="text-xs text-[var(--muted)]">{draft.model}</span></div>
          <label className="block text-sm font-medium">Template name<input className="input mt-2" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} /></label>
          <label className="block text-sm font-medium">Subject<input className="input mt-2" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} maxLength={300} /></label>
          <label className="block text-sm font-medium">Body<textarea className="input mt-2 h-auto resize-y py-3" rows={10} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} maxLength={100000} /></label>
          {draft.warnings.length ? <div className="rounded-xl bg-[var(--warning-soft)] p-3 text-sm"><p className="font-semibold">Review warnings</p><ul className="mt-2 list-disc pl-5">{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
          <div><p className="text-sm font-semibold">Supporting sources</p>{draft.sources.length ? <ul className="mt-2 space-y-2">{draft.sources.map((source) => <li key={source.id} className="rounded-xl border p-3 text-sm"><span className="font-medium">{source.sourceName}</span><p className="mt-1 text-xs text-[var(--muted)]">{source.excerpt}</p></li>)}</ul> : <p className="mt-1 text-sm text-[var(--muted)]">No approved source supported this draft.</p>}</div>
          <button className="inline-flex min-h-10 items-center rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" type="button" disabled={pending !== null || !name.trim()} onClick={() => void approve()}>{pending === "approve" ? "Approving…" : "Approve as template"}</button>
        </div>
      ) : null}
      {history.length ? <details><summary className="cursor-pointer text-sm font-medium">Compare {history.length} earlier draft{history.length === 1 ? "" : "s"}</summary><div className="mt-3 space-y-2">{history.map((item, index) => <button key={`${item.subject}-${index}`} className="block w-full rounded-xl border p-3 text-left text-sm" type="button" onClick={() => { if (draft) setHistory((items) => [draft, ...items.filter((_, itemIndex) => itemIndex !== index)].slice(0, 4)); setDraft(item); }}><span className="font-medium">{item.subject}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{item.body}</span></button>)}</div></details> : null}
    </div>
  );
}
