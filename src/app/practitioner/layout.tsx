'use client';

import {
  CalendarCheck,
  CalendarDays,
  FileCheck2,
  Inbox,
  LayoutDashboard,
  Receipt,
  UserRound,
} from 'lucide-react';
import { SessionProvider } from '@/lib/ui/session';
import { ConsoleShell, type NavSection } from '@/components/app/console-shell';

/**
 * The practitioner's own view.
 *
 * Everything here is `SELF`-scoped, so nothing needs a facility id and no
 * page has to ask which hospital — a practitioner acts for themselves and the
 * session already says who that is.
 *
 * Ordered by how often it is opened rather than by module number: offers and
 * the next shift are daily; the profile and credentials are filled in once
 * and then largely left alone.
 */
const SECTIONS: NavSection[] = [
  {
    heading: 'Today',
    items: [
      { href: '/practitioner', label: 'Overview', icon: LayoutDashboard, permission: null },
      {
        href: '/practitioner/offers',
        label: 'Offers',
        icon: Inbox,
        permission: 'service_request.read',
      },
      {
        href: '/practitioner/shifts',
        label: 'My shifts',
        icon: CalendarCheck,
        permission: 'service_request.read',
      },
    ],
  },
  {
    heading: 'Getting paid',
    items: [
      {
        href: '/practitioner/timesheets',
        label: 'Timesheets',
        icon: Receipt,
        permission: 'timesheet.submit',
      },
    ],
  },
  {
    heading: 'Your account',
    items: [
      {
        href: '/practitioner/availability',
        label: 'Availability',
        icon: CalendarDays,
        permission: 'availability.write',
      },
      {
        href: '/practitioner/credentials',
        label: 'Credentials',
        icon: FileCheck2,
        permission: 'credential.submit',
      },
      {
        href: '/practitioner/profile',
        label: 'Profile',
        icon: UserRound,
        permission: 'practitioner.profile.read',
      },
    ],
  },
];

export default function PractitionerLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ConsoleShell title="Practitioner" sections={SECTIONS}>
        {children}
      </ConsoleShell>
    </SessionProvider>
  );
}
