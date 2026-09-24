import Link from "next/link";

export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const query = await searchParams;
  const sent = query.notice === "sent";
  const invalid = query.error === "invalid";

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border bg-[var(--surface-raised)] p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-white">CE</span>
          <div><p className="font-semibold">Cold Emailer</p><p className="text-xs text-[var(--muted)]">Password recovery</p></div>
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Request a six-digit code, then enter it below with your new password.</p>
        {sent ? <p role="status" className="mt-5 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-strong)]">If an active account matches that address, a code has been sent. It expires in 10 minutes.</p> : null}
        {invalid ? <p role="alert" className="mt-5 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">The code or account details are invalid, expired, or have been attempted too many times.</p> : null}

        <form action="/api/auth/recovery/request" method="post" className="mt-6 space-y-4">
          <label className="block text-sm font-medium" htmlFor="request-email">Email address<input className="input mt-2" id="request-email" name="email" type="email" autoComplete="email" maxLength={320} required autoFocus /></label>
          <button className="flex h-11 w-full items-center justify-center rounded-xl border border-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]" type="submit">Send reset code</button>
        </form>

        <div className="my-7 border-t" />
        <form action="/api/auth/recovery/reset" method="post" className="space-y-4">
          <label className="block text-sm font-medium" htmlFor="reset-email">Email address<input className="input mt-2" id="reset-email" name="email" type="email" autoComplete="email" maxLength={320} required /></label>
          <label className="block text-sm font-medium" htmlFor="code">Six-digit code<input className="input mt-2" id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
          <label className="block text-sm font-medium" htmlFor="new-password">New password<input className="input mt-2" id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /></label>
          <label className="block text-sm font-medium" htmlFor="confirmation">Confirm new password<input className="input mt-2" id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /></label>
          <button className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:brightness-95" type="submit">Reset password</button>
        </form>
        <p className="mt-6 text-center text-xs"><Link href="/login" className="font-semibold text-[var(--accent-strong)] hover:underline">Back to sign in</Link></p>
      </section>
    </main>
  );
}
