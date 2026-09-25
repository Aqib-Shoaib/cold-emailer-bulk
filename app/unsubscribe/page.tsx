import { readUnsubscribeToken } from "@/lib/unsubscribe";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; notice?: string }>;
}) {
  const query = await searchParams;
  const email = query.token ? readUnsubscribeToken(query.token) : null;
  const complete = query.notice === "complete";

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border bg-[var(--surface-raised)] p-6 shadow-sm sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-white">CE</span>
        <h1 className="mt-7 text-2xl font-semibold tracking-tight">Email preferences</h1>
        {complete ? (
          <p role="status" className="mt-4 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-strong)]">This address has been unsubscribed. It will be excluded from future campaigns.</p>
        ) : email ? (
          <>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Stop all future campaign email to <strong className="text-[var(--foreground)]">{email}</strong>. This does not delete contact data.</p>
            <form action="/api/unsubscribe" method="post" className="mt-6">
              <input type="hidden" name="token" value={query.token} />
              <button className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--danger)] px-4 text-sm font-semibold text-white" type="submit">Confirm unsubscribe</button>
            </form>
          </>
        ) : (
          <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">This unsubscribe link is invalid. Contact the sender for help.</p>
        )}
      </section>
    </main>
  );
}
