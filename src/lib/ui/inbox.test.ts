import { describe, expect, it } from 'vitest';
import { consoleOf, inboxHref } from './inbox';

describe('which console a page belongs to', () => {
  it('reads it from the path', () => {
    expect(consoleOf('/practitioner/offers')).toBe('practitioner');
    expect(consoleOf('/facility/shifts/abc')).toBe('facility');
    expect(consoleOf('/admin/invoices')).toBe('admin');
  });

  it('says nothing for a page outside them', () => {
    expect(consoleOf('/')).toBeNull();
    expect(consoleOf('/login')).toBeNull();
    expect(consoleOf('/practitioners-guide')).toBeNull();
  });
});

describe('where a message leads', () => {
  it('takes a practitioner to their offers for an invitation', () => {
    expect(inboxHref('shift.invited', 'practitioner')).toBe('/practitioner/offers');
  });

  it('takes the same kind of message to the right place in each console', () => {
    expect(inboxHref('assignment.cancelled', 'practitioner')).toBe('/practitioner/shifts');
    expect(inboxHref('assignment.cancelled', 'facility')).toBe('/facility/roster');
    expect(inboxHref('timesheet.waiting', 'facility')).toBe('/facility/timesheets');
    expect(inboxHref('timesheet.waiting', 'practitioner')).toBe('/practitioner/timesheets');
  });

  it('knows where money messages go', () => {
    expect(inboxHref('invoice.issued', 'facility')).toBe('/facility/invoices');
    expect(inboxHref('payout.settled', 'practitioner')).toBe('/practitioner/earnings');
  });

  it('sends a credential decision to the profile, where the documents are', () => {
    for (const kind of ['credential.verified', 'credential.rejected', 'credential.info_requested']) {
      expect(inboxHref(kind, 'practitioner')).toBe('/practitioner/profile');
    }
  });

  it('has no link for a kind it does not know, or one that makes no sense in that console', () => {
    expect(inboxHref('something.new', 'practitioner')).toBeNull();
    expect(inboxHref('shift.invited', 'facility')).toBeNull();
    expect(inboxHref('shift.invited', null)).toBeNull();
  });
});
