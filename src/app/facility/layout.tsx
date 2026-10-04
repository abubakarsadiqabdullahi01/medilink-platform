'use client';

import {
  CalendarPlus,
  FileText,
  LayoutDashboard,
  Percent,
  Receipt,
  Stethoscope,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { SessionProvider, useScopeIds } from '@/lib/ui/session';
import { ConsoleShell, type NavSection } from '@/components/app/console-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FacilitySwitcher } from './facility-switcher';

/**
 * The facility console: the people who create the work.
 *
 * Everything here is scoped to one facility, and the id comes from the
 * caller's own grants rather than from a picker — a scheduler at one hospital
 * should never have to know their facility's uuid. Somebody who works at two
 * chooses between them with the switcher above every page.
 */
const SECTIONS: NavSection[] = [
  {
    heading: 'Overview',
    items: [{ href: '/facility', label: 'Dashboard', icon: LayoutDashboard, permission: null }],
  },
  {
    heading: 'Staffing',
    items: [
      {
        href: '/facility/shifts',
        label: 'Shifts',
        icon: CalendarPlus,
        permission: 'service_request.read',
      },
      {
        href: '/facility/roster',
        label: 'Roster',
        icon: Users,
        permission: 'attendance.record',
      },
    ],
  },
  {
    heading: 'After the shift',
    items: [
      {
        href: '/facility/timesheets',
        label: 'Timesheets',
        icon: Receipt,
        permission: 'timesheet.approve',
      },
      {
        href: '/facility/invoices',
        label: 'Invoices',
        icon: FileText,
        permission: 'invoice.read',
      },
      {
        href: '/facility/rates',
        label: 'Rates and allowances',
        icon: Percent,
        permission: 'facility.write',
      },
      {
        href: '/facility/incidents',
        label: 'Report an incident',
        icon: Stethoscope,
        permission: 'incident.report',
      },
    ],
  },
];

function Guard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Any facility-scoped grant will do to prove they belong here; each page
  // asks for the scope it actually needs.
  const anyFacility = [
    ...useScopeIds('service_request.read', 'FACILITY'),
    ...useScopeIds('service_request.publish', 'FACILITY'),
    ...useScopeIds('timesheet.approve', 'FACILITY'),
    ...useScopeIds('attendance.record', 'FACILITY'),
    ...useScopeIds('incident.report', 'FACILITY'),
  ];

  // Somebody with no facility is not lost — they are a hospital that has not
  // registered yet. The register page is inside this console but outside the
  // guard, or signing up would require the grant that signing up produces.
  if (anyFacility.length === 0 && pathname !== '/facility/register') {
    return (
      <Alert variant="warning">
        <AlertDescription className="space-y-3">
          <p>
            This account is not attached to a facility yet. Either register yours, or ask whoever
            runs it to add you — they can grant access from their own console.
          </p>
          <Link href="/facility/register" className={cn(buttonVariants({ size: 'sm' }))}>
            Register a facility
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {pathname !== '/facility/register' ? <FacilitySwitcher /> : null}
      {children}
    </>
  );
}

export default function FacilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ConsoleShell title="Facility" sections={SECTIONS}>
        <Guard>{children}</Guard>
      </ConsoleShell>
    </SessionProvider>
  );
}
