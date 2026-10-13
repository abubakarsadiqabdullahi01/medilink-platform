'use client';

import { PageHeader } from '@/components/app/page-shell';
import { StaffManager, type StaffRole } from '@/components/app/staff-manager';

/**
 * Medilink's own staff.
 *
 * An administrator can appoint another administrator; only a super
 * administrator can appoint a super administrator, because that bundle
 * carries `config.manage` and the server refuses to hand out a permission the
 * granter does not hold. Both options are offered to everybody and the server
 * answers — showing the rule rather than hiding the button.
 */
const ROLES: StaffRole[] = [
  {
    key: 'administrator',
    label: 'Administrator',
    description:
      'Onboarding, verification, disputes, incidents, invoices and payouts across every facility. Can appoint other administrators.',
  },
  {
    key: 'super_administrator',
    label: 'Super administrator',
    description:
      'Everything, plus the reference lists and the minimum pay rates. Only a super administrator can appoint one. Keep at least two, so the role is never down to a single phone.',
  },
];

export default function AdminStaffPage() {
  return (
    <>
      <PageHeader
        title="Staff"
        description="Who works for Medilink itself. Each appointment and removal is recorded with who made it and why."
      />
      <StaffManager scopeType="PLATFORM" roles={ROLES} signupPath="/register?as=staff" />
    </>
  );
}
