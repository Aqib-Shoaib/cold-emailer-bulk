"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

export default function ErrorView({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div className="max-w-md rounded-2xl border bg-[var(--surface)] p-7 text-center shadow-[0_12px_34px_rgba(31,54,42,0.045)]">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
          <WarningCircle aria-hidden size={26} />
        </span>
        <h1 className="mt-4 text-xl font-semibold">This page could not load</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Your work is safe. Try loading this workspace view again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white active:translate-y-px"
        >
          <ArrowClockwise aria-hidden size={17} />
          Try again
        </button>
      </div>
    </div>
  );
}
