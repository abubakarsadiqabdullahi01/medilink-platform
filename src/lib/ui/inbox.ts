/**
 * Where a message in the inbox leads, per console. Pure.
 *
 * The same kind of message goes to different pages for the people it reaches: a
 * cancelled shift is the practitioner's shifts and the facility's roster. A kind
 * this does not know, or one with no sensible page in the console it is read in,
 * has no link: a message that cannot say where to go still says what happened.
 */

export type ConsoleName = 'practitioner' | 'facility' | 'admin';

export function consoleOf(pathname: string): ConsoleName | null {
  const first = pathname.split('/')[1];
  return first === 'practitioner' || first === 'facility' || first === 'admin' ? first : null;
}

const LINKS: Record<string, Partial<Record<ConsoleName, string>>> = {
  'shift.invited': { practitioner: '/practitioner/offers' },
  'shift.accepted': { facility: '/facility/shifts' },
  'assignment.confirmed': { practitioner: '/practitioner/shifts', facility: '/facility/roster' },
  'assignment.cancelled': { practitioner: '/practitioner/shifts', facility: '/facility/roster' },
  'shift.reminder': { practitioner: '/practitioner/shifts' },
  'shift.not_checked_in': { practitioner: '/practitioner/shifts', facility: '/facility/roster' },
  'timesheet.submitted': { facility: '/facility/timesheets' },
  'timesheet.waiting': { facility: '/facility/timesheets', practitioner: '/practitioner/timesheets' },
  'invoice.issued': { facility: '/facility/invoices' },
  'payout.settled': { practitioner: '/practitioner/earnings' },
  'incident.severe': { admin: '/admin/incidents' },
  'credential.verified': { practitioner: '/practitioner/profile' },
  'credential.rejected': { practitioner: '/practitioner/profile' },
  'credential.info_requested': { practitioner: '/practitioner/profile' },
  'dispute.opened': { admin: '/admin/disputes' },
  'dispute.under_review': { admin: '/admin/disputes' },
  'dispute.resolved': { admin: '/admin/disputes' },
  'dispute.withdrawn': { admin: '/admin/disputes' },
};

export function inboxHref(kind: string, console: ConsoleName | null): string | null {
  if (!console) return null;
  return LINKS[kind]?.[console] ?? null;
}
