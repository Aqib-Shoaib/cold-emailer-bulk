import { AppShell } from "@/components/app-shell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { SETTINGS_ROW_ID } from "@/lib/settings";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  let sendingPaused = true;
  let sendingPausedReason = "Initial setup";
  try {
    const settings = await getPrisma().appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
    if (settings) {
      sendingPaused = settings.sendingPaused;
      sendingPausedReason = settings.sendingPausedReason;
    }
  } catch {
    // A broken settings read must not lock admins out; defaults keep sending blocked.
  }

  return (
    <AppShell user={{ name: user.name, role: user.role }} sending={{ paused: sendingPaused, reason: sendingPausedReason }}>
      {children}
    </AppShell>
  );
}
