import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  if (await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value)) redirect("/");
  const invalid = (await searchParams).error === "invalid";

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border bg-[var(--surface-raised)] p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-white">CE</span>
          <div><p className="font-semibold">Cold Emailer</p><p className="text-xs text-[var(--muted)]">Campaign workspace</p></div>
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Use the account created for you by the workspace owner.</p>
        {invalid ? <p role="alert" className="mt-5 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">The email or password is incorrect, the account is inactive, or too many attempts were made.</p> : null}
        <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
          <label className="block text-sm font-medium" htmlFor="email">Email address<input className="input mt-2" id="email" name="email" type="email" autoComplete="email" required autoFocus /></label>
          <label className="block text-sm font-medium" htmlFor="password">Password<input className="input mt-2" id="password" name="password" type="password" autoComplete="current-password" required /></label>
          <button className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:brightness-95 active:translate-y-px" type="submit">Sign in</button>
        </form>
        <p className="mt-5 text-center text-xs text-[var(--muted)]">Forgot your password? Email OTP recovery is being connected with workspace SMTP settings.</p>
      </section>
    </main>
  );
}
