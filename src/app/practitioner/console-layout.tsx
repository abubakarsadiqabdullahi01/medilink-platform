'use client';

import { usePhoto } from '@/lib/ui/practitioner';
import { SessionProvider, type SessionState } from '@/lib/ui/session';
import { ConsoleShell, type NavSection } from '@/components/app/console-shell';
import { ICON } from '@/components/app/icons';

/**
 * The practitioner's own view.
 *
 * Everything here is `SELF`-scoped, so nothing needs a facility id and no
 * page has to ask which hospital — a practitioner acts for themselves and the
 * session already says who that is.
 *
 * Ordered by how often it is opened rather than by module number: offers and
 * the next shift are daily; everything about the person — details, documents,
 * availability, privacy — is one "My profile" page, filled in once and then
 * largely left alone.
 */
const SECTIONS: NavSection[] = [
  {
    heading: 'Today',
    items: [
      { href: '/practitioner', label: 'Overview', icon: ICON.dashboard, permission: null },
      {
        href: '/practitioner/offers',
        label: 'Offers',
        icon: ICON.offer,
        permission: 'service_request.read',
      },
      {
        href: '/practitioner/shifts',
        label: 'My shifts',
        icon: ICON.shift,
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
        icon: ICON.timesheet,
        permission: 'timesheet.submit',
      },
      {
        href: '/practitioner/earnings',
        label: 'Earnings',
        icon: ICON.earnings,
        permission: 'invoice.read',
      },
      {
        href: '/practitioner/disputes',
        label: 'Disputes',
        icon: ICON.dispute,
        permission: 'dispute.manage',
      },
    ],
  },
  {
    heading: 'Your account',
    items: [
      {
        href: '/practitioner/profile',
        label: 'My profile',
        icon: ICON.practitioner,
        permission: 'practitioner.profile.read',
      },
    ],
  },
];

/**
 * Inside the session provider, so the photograph is only asked for once there
 * is somebody signed in to own it.
 */
function PractitionerShell({ children }: { children: React.ReactNode }) {
  const photo = usePhoto();
  return (
    <ConsoleShell title="Practitioner" sections={SECTIONS} avatarSrc={photo.url}>
      {children}
    </ConsoleShell>
  );
}

export default function PractitionerLayout({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession: SessionState | null;
}) {
  return (
    <SessionProvider initial={initialSession}>
      <PractitionerShell>{children}</PractitionerShell>
    </SessionProvider>
  );
}
