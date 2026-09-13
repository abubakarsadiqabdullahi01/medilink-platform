'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { api } from '@/lib/ui/api';
import { SessionProvider, useSession } from '@/lib/ui/session';

/**
 * The console shell.
 *
 * Every entry names the permission it needs, so the navigation is built from
 * the same question the guard asks rather than from role names that would
 * drift from it. A queue somebody cannot work simply is not offered.
 */
const NAV = [
  { href: '/admin', label: 'Overview', permission: null },
  { href: '/admin/credentials', label: 'Credentials', permission: 'credential.review' },
  { href: '/admin/facilities', label: 'Facilities', permission: 'facility.verify' },
  { href: '/admin/incidents', label: 'Incidents', permission: 'incident.manage' },
  { href: '/admin/disputes', label: 'Disputes', permission: 'dispute.manage' },
  { href: '/admin/unhonoured', label: 'Unhonoured shifts', permission: 'sanction.apply' },
  { href: '/admin/suggestions', label: 'Suggestions', permission: 'suggestion.triage' },
  { href: '/admin/audit', label: 'Audit trail', permission: 'audit.read' },
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const visible = NAV.filter(
    (item) => item.permission === null || session.permissions.includes(item.permission),
  );

  async function signOut() {
    await api.post('/api/v1/auth/logout').catch(() => undefined);
    router.push('/login');
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r bg-surface p-4 md:block">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">Medilink</p>
        <p className="mb-6 text-sm font-medium">Operations</p>

        <nav className="space-y-1">
          {visible.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'block rounded px-3 py-2 text-sm',
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-border/30',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-surface px-6 py-3">
          <div className="flex gap-2 overflow-x-auto md:hidden">
            {visible.map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap text-sm">
                {item.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-muted">{session.user.fullName}</span>
            <button onClick={signOut} className="rounded border px-2 py-1 hover:bg-border/30">
              Sign out
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
