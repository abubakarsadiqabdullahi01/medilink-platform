'use client';

import {
  Building2,
  ChartColumn,
  FileCheck2,
  HandCoins,
  Receipt,
  FileClock,
  Gavel,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { SessionProvider } from '@/lib/ui/session';
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
      {
        href: '/admin/credentials',
        label: 'Credentials',
        icon: FileCheck2,
        permission: 'credential.review',
      },
      {
        href: '/admin/facilities',
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
        label: 'Clinical incidents',
        icon: Stethoscope,
        permission: 'incident.manage',
      },
      { href: '/admin/disputes', label: 'Disputes', icon: Gavel, permission: 'dispute.manage' },
      {
        href: '/admin/unhonoured',
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
      { href: '/admin/invoices', label: 'Invoices', icon: Receipt, permission: 'payout.manage' },
      { href: '/admin/payouts', label: 'Payouts', icon: HandCoins, permission: 'payout.manage' },
    ],
  },
  {
    heading: 'The pilot',
    items: [
      {
        href: '/admin/suggestions',
        label: 'Suggestions',
        icon: MessageSquareText,
        permission: 'suggestion.triage',
      },
      {
        href: '/admin/data-requests',
        label: 'Data requests',
        icon: ShieldCheck,
        permission: 'audit.read',
      },
      { href: '/admin/audit', label: 'Audit trail', icon: ScrollText, permission: 'audit.read' },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ConsoleShell title="Operations" sections={SECTIONS}>
        {children}
      </ConsoleShell>
    </SessionProvider>
  );
}
