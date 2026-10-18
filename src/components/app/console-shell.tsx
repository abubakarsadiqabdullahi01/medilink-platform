'use client';

import Link from 'next/link';
import { prefetch } from '@/lib/ui/api';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Download,
  LogOut,
  type LucideIcon,
  Menu,
  MessageSquarePlus,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/app/avatar';
import { SuggestionDialog } from '@/components/app/suggestion-dialog';
import { useDownloadMyData } from '@/components/app/download-my-data';
import { NotificationBell } from '@/components/app/notification-bell';
import { TextSizeControl } from '@/components/app/text-size-control';
import { api } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { activeHref, breadcrumbsFor } from '@/components/app/nav';
import { hasChosenTheme, readTheme, saveTheme } from '@/lib/ui/theme';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
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
  const myData = useDownloadMyData();

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
   * The theme belongs to the console rather than to the whole site (UXA-13).
   *
   * The first paint is handled before React runs, by the script in the root layout, so a
   * reload does not flash. This brings the toggle's state in line with it, before the
   * browser paints, and keeps following the device while nobody has chosen. Removing the
   * class on unmount matters: the public pages are light by design, and a `dark` left on
   * `<html>` once followed somebody out of the console and rendered the landing page as
   * white on white.
   */
  useLayoutEffect(() => {
    const apply = (next: boolean) => {
      setDark(next);
      document.documentElement.classList.toggle('dark', next);
    };
    apply(readTheme() === 'dark');

    const device = window.matchMedia?.('(prefers-color-scheme: dark)');
    const follow = () => {
      if (!hasChosenTheme()) apply(readTheme() === 'dark');
    };
    device?.addEventListener('change', follow);
    return () => {
      device?.removeEventListener('change', follow);
      document.documentElement.classList.remove('dark');
    };
  }, []);

  const openerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  /**
   * The mobile drawer behaves like the modal it announces itself as.
   *
   * It said `aria-modal` and did none of what that promises: Tab walked out of
   * it into the page behind, closing it dropped focus on nothing, and the page
   * scrolled underneath. Now focus moves into it, Tab and Shift+Tab stay inside
   * it, Escape closes it, the page behind does not scroll, and focus goes back to
   * the button that opened it. The overlay is a click target and the X is a
   * button; this is the keyboard's way through the same thing.
   */
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const opener = openerRef.current;
    const reachable = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    reachable()[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const items = reachable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    saveTheme(next ? 'dark' : 'light');
  }

  const owner = activeHref(
    pathname,
    visible.flatMap((section) => section.items.map((item) => item.href)),
  );
  const trail = breadcrumbsFor(
    pathname,
    visible.flatMap((section) => section.items),
  );

  const nav = (
    <nav className="space-y-6">
      {visible.map((section) => (
        <div key={section.heading}>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section.heading}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = owner === item.href;
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
                    aria-current={pathname === item.href ? 'page' : undefined}
                    className={cn(
                      // 44px tall: the size of a thumb, which is what most people use this with.
                      'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-fast',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
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
      {/* First thing a keyboard reaches: otherwise every page begins with the
          whole navigation, and there is no way past it but to tab through it. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-card lg:flex">
        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${title} navigation`}
            className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-raised"
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
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:gap-3 sm:px-6">
          <Button
            ref={openerRef}
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
            <NotificationBell />
            <TextSizeControl />
            {/* On a phone the theme lives in the account menu: with five controls in a 360px
                header the console's own name was cut to three letters. */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex"
              onClick={toggleTheme}
              aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
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
                {/* Everyone who can sign in may ask what is held about them, not
                    only practitioners (AUD-08). */}
                <DropdownMenuItem className="sm:hidden" onSelect={toggleTheme}>
                  {dark ? <Sun /> : <Moon />}
                  {dark ? 'Light theme' : 'Dark theme'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void myData.download()}>
                  <Download />
                  Download my data
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <SuggestionDialog open={suggesting} onOpenChange={setSuggesting} />
        {myData.dialog}

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
        <main
          id="main-content"
          // Focusable by script only: the skip link moves focus here, and a
          // heading that cannot take focus would leave it where it was.
          tabIndex={-1}
          className="min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8"
        >
          {trail.length > 0 ? (
            <Breadcrumb className="mb-4">
              <BreadcrumbList>
                {trail.map((crumb, index) => (
                  <Fragment key={`${crumb.label}-${index}`}>
                    {index > 0 ? <BreadcrumbSeparator /> : null}
                    <BreadcrumbItem>
                      {crumb.href ? (
                        <BreadcrumbLink asChild>
                          {/* A 44px target, not a 20px line of text. */}
                          <Link href={crumb.href} className="inline-flex min-h-11 items-center">
                            {crumb.label}
                          </Link>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
