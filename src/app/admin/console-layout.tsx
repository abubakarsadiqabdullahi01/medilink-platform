'use client';

import {
  Building2,
  ChartColumn,
  FileCheck2,
  HandCoins,
  ReceiptText,
  FileClock,
  Gavel,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  UserRoundCheck,
  UsersRound,
  FileSignature,
  Gauge,
  CalendarDays,
  Layers,
  Scale,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import { SessionProvider, type SessionState } from '@/lib/ui/session';
import { ConsoleShell, type NavSection } from '@/components/app/console-shell';

/**
 * Operations and compliance: the people who work queues.
 *
 * Grouped by what the work *is* rather than by module number, because
 * somebody clearing a morning's queue thinks "who is waiting to be verified"
 * and never "module 3".
 */
const SECTIONS: NavSection[] = [
  {
    heading: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard, permission: null }],
  },
  {
    heading: 'Onboarding',
    items: [
      // First in this group because it is first in the practitioner's life:
      // identity and registration gate everything, and only this side can
      // record them.
      {
        href: '/admin/practitioners',
        prefetch: '/api/v1/practitioners?scopeType=PLATFORM&limit=20',
        label: 'Practitioners',
        icon: UserRoundCheck,
        permission: 'credential.review',
      },
      {
        href: '/admin/sanctions',
        prefetch: '/api/v1/sanctions',
        label: 'Sanctions list',
        icon: ShieldAlert,
        permission: 'credential.review',
      },
      {
        href: '/admin/credentials',
        prefetch: '/api/v1/credentials?scopeType=PLATFORM&status=PENDING&limit=20',
        label: 'Credentials',
        icon: FileCheck2,
        permission: 'credential.review',
      },
      {
        href: '/admin/facilities',
        prefetch: '/api/v1/facilities?scopeType=PLATFORM&status=PENDING&limit=20',
        label: 'Facilities',
        icon: Building2,
        permission: 'facility.verify',
      },
    ],
  },
  {
    heading: 'Casework',
    items: [
      {
        href: '/admin/incidents',
        prefetch: '/api/v1/incidents/queue?status=OPEN&limit=20',
        label: 'Clinical incidents',
        icon: Stethoscope,
        permission: 'incident.manage',
      },
      { href: '/admin/disputes',
        prefetch: '/api/v1/disputes?status=OPEN&limit=20', label: 'Disputes', icon: Gavel, permission: 'dispute.manage' },
      {
        href: '/admin/unhonoured',
        prefetch: '/api/v1/unhonoured?status=AWAITING_DECISION&limit=20',
        label: 'Unhonoured shifts',
        icon: FileClock,
        permission: 'sanction.apply',
      },
    ],
  },
  {
    heading: 'Money',
    items: [
      { href: '/admin/finance', label: 'Overview', icon: ChartColumn, permission: 'invoice.read' },
      { href: '/admin/invoices', label: 'Invoices', icon: ReceiptText, permission: 'payout.manage' },
      { href: '/admin/payouts', label: 'Payouts', icon: HandCoins, permission: 'payout.manage' },
    ],
  },
  {
    heading: 'The pilot',
    items: [
      {
        href: '/admin/suggestions',
        prefetch: '/api/v1/suggestions?status=NEW&limit=20',
        label: 'Suggestions',
        icon: MessageSquareText,
        permission: 'suggestion.triage',
      },
      {
        href: '/admin/data-requests',
        prefetch: '/api/v1/data-requests?status=RECEIVED&limit=20',
        label: 'Data requests',
        icon: ShieldCheck,
        permission: 'audit.read',
      },
      { href: '/admin/audit',
        prefetch: '/api/v1/audit?scopeType=PLATFORM&limit=50', label: 'Audit trail', icon: ScrollText, permission: 'audit.read' },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { href: '/admin/staff', label: 'Staff', icon: UsersRound, permission: 'role.grant' },
      { href: '/admin/performance', label: 'Performance', icon: Gauge, permission: 'audit.read' },
      { href: '/admin/system', label: 'System health', icon: Activity, permission: 'audit.read' },
      {
        href: '/admin/agreements',
        label: 'Terms and notices',
        icon: FileSignature,
        permission: 'config.manage',
      },
      {
        href: '/admin/holidays',
        label: 'Public holidays',
        icon: CalendarDays,
        permission: 'config.manage',
      },
      {
        href: '/admin/rate-floors',
        label: 'Pay floors',
        icon: Scale,
        permission: 'config.manage',
      },
      {
        href: '/admin/levels',
        label: 'Levels',
        icon: Layers,
        permission: 'config.manage',
      },
    ],
  },
];

export default function AdminLayout({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession: SessionState | null;
}) {
  return (
    <SessionProvider initial={initialSession}>
      <ConsoleShell title="Operations" sections={SECTIONS}>
        {children}
      </ConsoleShell>
    </SessionProvider>
  );
}
