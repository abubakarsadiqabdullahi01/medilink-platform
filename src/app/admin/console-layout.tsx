'use client';

import { SessionProvider, type SessionState } from '@/lib/ui/session';
import { ConsoleShell, type NavSection } from '@/components/app/console-shell';
import { ICON } from '@/components/app/icons';

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
    items: [{ href: '/admin', label: 'Dashboard', icon: ICON.dashboard, permission: null }],
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
        icon: ICON.practitioner,
        permission: 'credential.review',
      },
      {
        href: '/admin/sanctions',
        prefetch: '/api/v1/sanctions',
        label: 'Sanctions list',
        icon: ICON.sanction,
        permission: 'credential.review',
      },
      {
        href: '/admin/credentials',
        prefetch: '/api/v1/credentials?scopeType=PLATFORM&status=PENDING&limit=20',
        label: 'Credentials',
        icon: ICON.credential,
        permission: 'credential.review',
      },
      {
        href: '/admin/facilities',
        prefetch: '/api/v1/facilities?scopeType=PLATFORM&status=PENDING&limit=20',
        label: 'Facilities',
        icon: ICON.facility,
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
        icon: ICON.incident,
        permission: 'incident.manage',
      },
      { href: '/admin/disputes',
        prefetch: '/api/v1/disputes?status=OPEN&limit=20', label: 'Disputes', icon: ICON.dispute, permission: 'dispute.manage' },
      {
        href: '/admin/unhonoured',
        prefetch: '/api/v1/unhonoured?status=AWAITING_DECISION&limit=20',
        label: 'Unhonoured shifts',
        icon: ICON.unhonoured,
        permission: 'sanction.apply',
      },
    ],
  },
  {
    heading: 'Money',
    items: [
      { href: '/admin/finance', label: 'Overview', icon: ICON.finance, permission: 'invoice.read' },
      { href: '/admin/invoices', label: 'Invoices', icon: ICON.invoice, permission: 'payout.manage' },
      { href: '/admin/payouts', label: 'Payouts', icon: ICON.payout, permission: 'payout.manage' },
    ],
  },
  {
    heading: 'The pilot',
    items: [
      {
        href: '/admin/suggestions',
        prefetch: '/api/v1/suggestions?status=NEW&limit=20',
        label: 'Suggestions',
        icon: ICON.suggestion,
        permission: 'suggestion.triage',
      },
      {
        href: '/admin/data-requests',
        prefetch: '/api/v1/data-requests?status=RECEIVED&limit=20',
        label: 'Data requests',
        icon: ICON.dataRequest,
        permission: 'audit.read',
      },
      { href: '/admin/audit',
        prefetch: '/api/v1/audit?scopeType=PLATFORM&limit=50', label: 'Audit trail', icon: ICON.audit, permission: 'audit.read' },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { href: '/admin/staff', label: 'Staff', icon: ICON.staff, permission: 'role.grant' },
      { href: '/admin/performance', label: 'Performance', icon: ICON.performance, permission: 'audit.read' },
      { href: '/admin/system', label: 'System health', icon: ICON.health, permission: 'audit.read' },
      {
        href: '/admin/agreements',
        label: 'Terms and notices',
        icon: ICON.terms,
        permission: 'config.manage',
      },
      {
        href: '/admin/holidays',
        label: 'Public holidays',
        icon: ICON.holiday,
        permission: 'config.manage',
      },
      {
        href: '/admin/rate-floors',
        label: 'Pay floors',
        icon: ICON.rateFloor,
        permission: 'config.manage',
      },
      {
        href: '/admin/levels',
        label: 'Levels',
        icon: ICON.level,
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
