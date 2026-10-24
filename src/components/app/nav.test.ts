import { describe, expect, it } from 'vitest';
import { activeHref, breadcrumbsFor, segmentLabel } from './nav';

const FACILITY = [
  { href: '/facility', label: 'Dashboard' },
  { href: '/facility/shifts', label: 'Shifts' },
  { href: '/facility/roster', label: 'Roster' },
];

const ID = '3f2b6c1e-8a4d-4e7b-9c1a-2d5e6f708192';

describe('activeHref', () => {
  it('marks the item whose page this is', () => {
    expect(activeHref('/facility/shifts', FACILITY.map((i) => i.href))).toBe('/facility/shifts');
    expect(activeHref('/facility', FACILITY.map((i) => i.href))).toBe('/facility');
  });

  it('gives a deep page to the section it sits in, not to the dashboard that is a prefix of everything', () => {
    expect(activeHref(`/facility/shifts/${ID}`, FACILITY.map((i) => i.href))).toBe('/facility/shifts');
  });

  it('does not match a sibling that merely starts with the same letters', () => {
    expect(activeHref('/facility/shifts-archive', FACILITY.map((i) => i.href))).toBe('/facility');
    expect(activeHref('/administrators', ['/admin'])).toBeNull();
  });

  it('says nothing is active outside the menu', () => {
    expect(activeHref('/practitioner/offers', FACILITY.map((i) => i.href))).toBeNull();
  });
});

describe('segmentLabel', () => {
  it('calls a record id "Details" and spells out a slug', () => {
    expect(segmentLabel(ID)).toBe('Details');
    expect(segmentLabel('12345')).toBe('Details');
    expect(segmentLabel('new-shift')).toBe('New shift');
    expect(segmentLabel('timesheets')).toBe('Timesheets');
  });
});

describe('breadcrumbsFor', () => {
  it('is empty on a page that is itself a menu item', () => {
    expect(breadcrumbsFor('/facility/shifts', FACILITY)).toEqual([]);
    expect(breadcrumbsFor('/facility', FACILITY)).toEqual([]);
  });

  it('is empty on a page the menu does not own', () => {
    expect(breadcrumbsFor('/practitioner/offers', FACILITY)).toEqual([]);
  });

  it('leads back to the list, and names where you are without linking it', () => {
    expect(breadcrumbsFor(`/facility/shifts/${ID}`, FACILITY)).toEqual([
      { label: 'Shifts', href: '/facility/shifts' },
      { label: 'Details' },
    ]);
  });

  it('links every step but the last on a deeper page', () => {
    expect(breadcrumbsFor(`/facility/shifts/${ID}/candidates`, FACILITY)).toEqual([
      { label: 'Shifts', href: '/facility/shifts' },
      { label: 'Details', href: `/facility/shifts/${ID}` },
      { label: 'Candidates' },
    ]);
  });
});
