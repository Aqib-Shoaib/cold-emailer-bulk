export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-label="Loading workspace">
      <div className="space-y-3">
        <div className="h-8 w-44 rounded-xl bg-[var(--surface-soft)]" />
        <div className="h-4 w-80 max-w-full rounded-lg bg-[var(--surface-soft)]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-32 rounded-2xl border bg-[var(--surface)]" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <div className="h-80 rounded-2xl border bg-[var(--surface)]" />
        <div className="h-80 rounded-2xl border bg-[var(--surface)]" />
      </div>
    </div>
  );
}
