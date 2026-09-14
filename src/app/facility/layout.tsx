'use client';

import { CalendarPlus, LayoutDashboard, Receipt, Stethoscope, Users } from 'lucide-react';
import { SessionProvider, useScopeIds } from '@/lib/ui/session';
import { ConsoleShell, type NavSection } from '@/components/app/console-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * The facility console: the people who create the work.
 *
 * Everything here is scoped to one facility, and the id comes from the
 * caller's own grants rather than from a picker — a scheduler at one hospital
 * should never have to know their facility's uuid, and one who works at two
 * gets a choice rather than a guess.
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
        href: '/facility/incidents',
        label: 'Report an incident',
        icon: Stethoscope,
        permission: 'incident.report',
      },
    ],
  },
];

function Guard({ children }: { children: React.ReactNode }) {
  // Any facility-scoped grant will do to prove they belong here; each page
  // asks for the scope it actually needs.
  const anyFacility = [
    ...useScopeIds('service_request.read', 'FACILITY'),
    ...useScopeIds('service_request.publish', 'FACILITY'),
    ...useScopeIds('timesheet.approve', 'FACILITY'),
    ...useScopeIds('attendance.record', 'FACILITY'),
    ...useScopeIds('incident.report', 'FACILITY'),
  ];

  if (anyFacility.length === 0) {
    return (
      <Alert variant="warning">
        <AlertDescription>
          This account holds no facility-scoped grants, so there is no facility for this console to
          act for. Operations grants those when a facility is onboarded.
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
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
