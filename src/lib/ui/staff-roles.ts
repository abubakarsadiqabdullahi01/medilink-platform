import type { StaffRole } from '@/components/app/staff-manager';

/**
 * The roles a facility's staff can hold, in the words a hospital uses. Shared by the facility's own
 * Staff page and by the view Medilink's operations have of the same list, so they cannot describe
 * a role two different ways.
 */
export const FACILITY_STAFF_ROLES: StaffRole[] = [
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
