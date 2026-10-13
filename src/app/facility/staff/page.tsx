'use client';

import { useFacility, useFacilityId } from '@/lib/ui/facility';
import { PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { StaffManager, type StaffRole } from '@/components/app/staff-manager';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * The hospital's own staff. The owner's alone: `role.grant` is in the owner's
 * bundle and not the administrator's, so an administrator never sees this
 * page, and the server would refuse them if they found it.
 */
const ROLES: StaffRole[] = [
  {
    key: 'facility_administrator',
    label: 'Facility administrator',
    description:
      'Runs the hospital day to day: publishes and staffs shifts, records attendance, approves timesheets, reports incidents. Cannot add staff or answer disputes.',
  },
  {
    key: 'facility_owner',
    label: 'Owner',
    description:
      'Everything an administrator can do, plus adding and removing staff and answering disputes. Give this only to the person accountable for the hospital.',
  },
];

export default function FacilityStaffPage() {
  const facilityId = useFacilityId();
  const facility = useFacility(facilityId);
  // Adding people, and looking them up to do so, is for a verified facility: the
  // server refuses it otherwise (AUT-07), so the page says why rather than
  // offering a form that can only fail.
  const awaitingVerification = Boolean(facility.data) && facility.data?.status !== 'VERIFIED';

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can act for this facility. Each person signs in with their own account, so nobody shares a password and every action carries a name."
      />
      {awaitingVerification ? (
        <Alert variant="warning">
          <AlertDescription>
            You can add staff once Medilink has verified this facility. Until then you are the only
            person who can act for it.
          </AlertDescription>
        </Alert>
      ) : facilityId ? (
        <StaffManager
          scopeType="FACILITY"
          scopeId={facilityId}
          roles={ROLES}
          signupPath="/register?as=staff"
        />
      ) : (
        <QueueSkeleton rows={2} />
      )}
    </>
  );
}
