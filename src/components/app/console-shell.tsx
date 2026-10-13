'use client';

import Link from 'next/link';
import { prefetch } from '@/lib/ui/api';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
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
  MessageSquarePlus,
  MessageSquareText,
  Moon,
  ScrollText,
  Stethoscope,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/app/avatar';
import { SuggestionDialog } from '@/components/app/suggestion-dialog';
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
  /**
   * The first request this page makes, started on hover.
   *
   * Optional, and a wrong one costs nothing: `api.prefetch` warms by URL, so
   * a page whose first call has changed simply fetches as it always did. See
   * the note in lib/ui/api.ts for why it is not a query key.
   */
  prefetch?: string;
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
  avatarSrc,
  children,
}: {
  title: string;
  sections: NavSection[];
  /** A photograph for the top-bar avatar, where the console has one to show. */
  avatarSrc?: string | null;
  children: ReactNode;
}) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

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

  /**
   * The theme is remembered, and it belongs to the console rather than to the
   * whole site.
   *
   * It used to be component state only, so every reload threw the choice away.
   * Restoring it from storage is half the fix; removing the class on unmount
   * is the other half — the public pages are light by design, and a `dark`
   * left on `<html>` followed somebody out of the console and rendered the
   * landing page as white on white.
   */
  useEffect(() => {
    let stored = false;
    try {
      stored = window.localStorage.getItem('medilink:theme') === 'dark';
    } catch {
      // Storage can be blocked outright; the console still works without it.
    }
    setDark(stored);
    document.documentElement.classList.toggle('dark', stored);
    return () => document.documentElement.classList.remove('dark');
  }, []);

  // Escape closes the mobile drawer. The overlay is a click target and the X
  // is a button, so this is the keyboard's way out of the same thing.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem('medilink:theme', next ? 'dark' : 'light');
    } catch {
      // Private browsing: the toggle still works for this visit.
    }
  }

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
                    // Hover and keyboard focus both count: somebody tabbing
                    // through the sidebar is as likely to open the page as
                    // somebody pointing at it, and they are the ones for whom
                    // a skeleton is hardest to read.
                    onMouseEnter={item.prefetch ? () => prefetch(item.prefetch!) : undefined}
                    onFocus={item.prefetch ? () => prefetch(item.prefetch!) : undefined}
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
        <div className="scrollbar-thin flex-1 overflow-y-auto p-3">{nav}</div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`${title} navigation`}
            className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-card p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold tracking-tight">{title}</p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              >
                <X />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          {/* The sidebar carries this on a wide screen; without it here, a
              phone gives no sign of which console you are actually in. */}
          <p className="truncate font-semibold tracking-tight lg:hidden">{title}</p>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun /> : <Moon />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                  <Avatar name={session.user.fullName} src={avatarSrc} size="sm" />
                  <span className="hidden sm:inline">{session.user.fullName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{session.user.fullName}</p>
                  <p className="text-xs text-muted-foreground">{session.user.phone}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* Was a count of permissions and a step-up flag: true, and
                    meaningless to anybody but a developer. */}
                {session.permissions.includes('suggestion.submit') ? (
                  <DropdownMenuItem onSelect={() => setSuggesting(true)}>
                    <MessageSquarePlus />
                    Send a suggestion
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <SuggestionDialog open={suggesting} onOpenChange={setSuggesting} />

        {/*
          Full width, not a centred column. This was capped at `max-w-6xl`,
          which on a 1920 screen left about 450px of empty page on either side
          of a queue that was itself cramped — a reviewer scrolling a roster
          while two thirds of their monitor showed nothing.

          Long prose is kept readable where it actually occurs rather than by
          narrowing everything around it: `PageHeader` caps its own description,
          and a queue card's text is short by nature. Tables, rosters and tile
          grids get the room.
        */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
