'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  CalendarDays,
  ClipboardList,
  FileCheck2,
  FileClock,
  Gavel,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  MessageSquareText,
  Moon,
  ScrollText,
  Stethoscope,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** null means everybody signed in; otherwise the permission it needs. */
  permission: string | null;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

export const ICONS = {
  LayoutDashboard,
  FileCheck2,
  Building2,
  Stethoscope,
  Gavel,
  FileClock,
  MessageSquareText,
  ScrollText,
  CalendarDays,
  ClipboardList,
  Activity,
  UserRound,
};

/**
 * The shell every console shares.
 *
 * `sections` is passed in rather than fixed here, because the operations
 * console, the facility console and the practitioner app are three different
 * jobs with the same furniture — and one nav list covering all three would
 * be a list where most entries are hidden most of the time.
 */
export function ConsoleShell({
  title,
  sections,
  children,
}: {
  title: string;
  sections: NavSection[];
  children: ReactNode;
}) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);

  const visible = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.permission === null || session.permissions.includes(item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0);

  async function signOut() {
    await api.post('/api/v1/auth/logout').catch(() => undefined);
    // Otherwise the next person to sign in on this browser sees the previous
    // one's queues for a moment, served from cache.
    queryClient.clear();
    router.push('/login');
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
  }

  const initials = session.user.fullName
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  const nav = (
    <nav className="space-y-6">
      {visible.map((section) => (
        <div key={section.heading}>
          <p className="mb-2 px-3 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {section.heading}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-card lg:flex">
        <div className="p-5">
          <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Medilink
          </p>
          <p className="mt-0.5 font-semibold tracking-tight">{title}</p>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3">{nav}</div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold tracking-tight">{title}</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu />
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun /> : <Moon />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials}
                  </span>
                  <span className="hidden sm:inline">{session.user.fullName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{session.user.fullName}</p>
                  <p className="text-xs text-muted-foreground">{session.user.phone}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {session.permissions.length} permissions
                  {session.stepUpFresh ? ' · step-up fresh' : ''}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
