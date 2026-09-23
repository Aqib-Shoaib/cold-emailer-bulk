"use client";

import {
  AddressBook,
  Bell,
  Books,
  FileText,
  GearSix,
  House,
  List,
  MagnifyingGlass,
  PaperPlaneTilt,
  PauseCircle,
  PlayCircle,
  Tray,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const navigation = [
  { href: "/", label: "Dashboard", icon: House },
  { href: "/contacts", label: "Contacts", icon: AddressBook },
  { href: "/campaigns", label: "Campaigns", icon: PaperPlaneTilt },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/inbox", label: "Inbox", icon: Tray, count: 4 },
  { href: "/knowledge", label: "Knowledge", icon: Books },
  { href: "/users", label: "Users", icon: UsersThree },
  { href: "/settings", label: "Settings", icon: GearSix },
];

export function AppShell({
  children,
  user,
  sending,
}: {
  children: ReactNode;
  user: { name: string; role: "SUPER_ADMIN" | "ADMIN" };
  sending: { paused: boolean; reason: string };
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-[var(--canvas)] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-[100dvh] flex-col bg-[var(--sidebar)] px-4 py-5 text-[var(--sidebar-foreground)] lg:flex">
        <Brand />
        <nav aria-label="Primary navigation" className="mt-8 space-y-1">
          {navigation.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname === item.href}
            />
          ))}
        </nav>
        <div className={`mt-auto rounded-2xl border p-4 ${sending.paused ? "border-[var(--warning)]/40 bg-[var(--warning-soft)]" : "border-white/10 bg-white/[0.045]"}`}>
          <div className={`flex items-center gap-2 text-sm font-medium ${sending.paused ? "text-[var(--warning)]" : ""}`}>
            {sending.paused ? <PauseCircle aria-hidden size={18} weight="fill" /> : <PlayCircle aria-hidden size={18} weight="fill" />}
            {sending.paused ? "Sending paused" : "Sending allowed"}
          </div>
          <p className={`mt-2 text-xs leading-5 ${sending.paused ? "text-[var(--foreground)]" : "text-[var(--sidebar-muted)]"}`}>
            {sending.paused ? `The global kill switch is on: ${sending.reason}` : "Campaigns may send within the configured safety limits."}
          </p>
          <Link href="/settings" className="mt-2 inline-block text-xs font-semibold text-[var(--warning)] hover:underline">Review safety settings</Link>
        </div>
        <div className="mt-4 flex items-center gap-3 px-2 py-2">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] text-sm font-semibold text-white">
            {initials(user.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-[var(--sidebar-muted)]">
              {user.role === "SUPER_ADMIN" ? "Workspace owner" : "Administrator"}
            </span>
          </span>
          <form action="/api/auth/logout" method="post" className="ml-auto">
            <button type="submit" className="rounded-lg px-2 py-1 text-xs text-[var(--sidebar-muted)] hover:bg-white/10 hover:text-white" title="Sign out">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-[color:var(--surface)/0.92] px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-soft)] lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            <List aria-hidden size={22} />
          </button>
          <div className="relative hidden max-w-md flex-1 sm:block">
            <MagnifyingGlass
              aria-hidden
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]"
            />
            <input
              aria-label="Search workspace"
              placeholder="Search contacts, campaigns, or messages"
              className="h-10 w-full rounded-xl border bg-[var(--surface-raised)] pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--subtle)]"
            />
          </div>
          <span className="ml-auto hidden rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent-strong)] sm:inline">
            Preview data
          </span>
          <button
            type="button"
            className="relative grid size-10 place-items-center rounded-xl border bg-[var(--surface-raised)] text-[var(--muted)] hover:text-[var(--foreground)] active:translate-y-px"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell aria-hidden size={19} />
            <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[var(--danger)]" />
          </button>
        </header>

        <main className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-black/45"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative flex h-full w-[min(86vw,320px)] flex-col bg-[var(--sidebar)] p-4 text-[var(--sidebar-foreground)] shadow-2xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                className="grid size-10 place-items-center rounded-xl hover:bg-white/10"
                aria-label="Close navigation"
                onClick={() => setMenuOpen(false)}
              >
                <X aria-hidden size={21} />
              </button>
            </div>
            <nav aria-label="Mobile navigation" className="mt-7 space-y-1">
              {navigation.map((item) => (
                <NavItem
                  key={item.href}
                  {...item}
                  active={pathname === item.href}
                  onClick={() => setMenuOpen(false)}
                />
              ))}
            </nav>
            <div className="mt-auto flex items-center gap-3 border-t border-white/10 px-2 pt-4">
              <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] text-sm font-semibold text-white">{initials(user.name)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user.name}</span><span className="block truncate text-xs text-[var(--sidebar-muted)]">{user.role === "SUPER_ADMIN" ? "Workspace owner" : "Administrator"}</span></span>
              <form action="/api/auth/logout" method="post"><button type="submit" className="rounded-lg px-2 py-1 text-xs text-[var(--sidebar-muted)] hover:bg-white/10 hover:text-white">Sign out</button></form>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 rounded-xl px-2 py-1">
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-white">
        CE
      </span>
      <span>
        <span className="block text-sm font-semibold tracking-tight">Cold Emailer</span>
        <span className="block text-[11px] text-[var(--sidebar-muted)]">Campaign workspace</span>
      </span>
    </Link>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  count,
  active,
  onClick,
}: (typeof navigation)[number] & { active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors active:translate-y-px ${
        active
          ? "bg-white/10 font-medium text-white"
          : "text-[var(--sidebar-muted)] hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <Icon aria-hidden size={19} weight={active ? "fill" : "regular"} />
      <span>{label}</span>
      {count ? (
        <span className="ml-auto min-w-6 rounded-lg bg-white/10 px-1.5 py-0.5 text-center text-xs text-white">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
