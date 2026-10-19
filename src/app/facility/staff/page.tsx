'use client';

import { useFacility, useFacilityId } from '@/lib/ui/facility';
import { PageHeader } from '@/components/app/page-shell';
import { StaffManager } from '@/components/app/staff-manager';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { FACILITY_STAFF_ROLES } from '@/lib/ui/staff-roles';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * The hospital's own staff. The owner's alone: `role.grant` is in the owner's
 * bundle and not the administrator's, so an administrator never sees this
 * page, and the server would refuse them if they found it.
 */
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
      ) : facility.isError && !facility.data ? (
        // Whether this facility is verified decides whether the forms can work, so a failed load
        // is said, not guessed past.
        <ErrorState
          error={facility.error}
          onRetry={() => void facility.refetch()}
          retrying={facility.isFetching}
        />
      ) : facilityId && facility.data ? (
        <StaffManager
          scopeType="FACILITY"
          scopeId={facilityId}
          roles={FACILITY_STAFF_ROLES}
          signupPath="/register?as=staff"
        />
      ) : (
        <ListSkeleton rows={2} label="Loading staff" />
      )}
    </>
  );
}
