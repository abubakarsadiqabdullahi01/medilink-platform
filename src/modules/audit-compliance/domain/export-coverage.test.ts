import { describe, expect, it } from 'vitest';
import { DATA_CATEGORIES } from './data-inventory';
import { EXCLUSIONS, EXPORT_COVERAGE, EXPORT_SECTIONS } from './export-coverage';

/**
 * M17-03 / AUD-07: the export is checked against the inventory, the way the
 * inventory is checked against the schema.
 *
 * The schema test makes a new table say what it holds. This makes it say, in
 * the same commit, whether the person gets it back or why not. Without it the
 * export was a list somebody wrote once, and eight kinds of data were missing
 * from it for as long as nobody looked.
 */

const personal = DATA_CATEGORIES.filter((category) => category.enforcement !== 'reference').flatMap(
  (category) => category.tables,
);

describe('what the export says about each table the inventory lists', () => {
  it('has an answer for every table that is about a person', () => {
    const unanswered = personal.filter((table) => !(table in EXPORT_COVERAGE));
    expect(unanswered, 'add each to EXPORT_COVERAGE: a section, or the reason it is left out').toEqual([]);
  });

  it('has no answer for a table the inventory does not list', () => {
    const stale = Object.keys(EXPORT_COVERAGE).filter((table) => !personal.includes(table));
    expect(stale).toEqual([]);
  });

  it('gives each table a section or an exclusion, never both and never neither', () => {
    for (const [table, coverage] of Object.entries(EXPORT_COVERAGE)) {
      const hasSection = 'section' in coverage;
      const hasExclusion = 'excluded' in coverage;
      expect(hasSection !== hasExclusion, table).toBe(true);
    }
  });

  it('only names exclusions that are written down, and writes down none that nothing uses', () => {
    const used = new Set<string>();
    for (const coverage of Object.values(EXPORT_COVERAGE)) {
      if ('excluded' in coverage) used.add(coverage.excluded);
      if ('limits' in coverage) for (const limit of coverage.limits ?? []) used.add(limit);
    }
    for (const key of used) expect(Object.keys(EXCLUSIONS), key).toContain(key);
    for (const key of Object.keys(EXCLUSIONS)) expect([...used], key).toContain(key);
  });

  it('explains each exclusion in a sentence a person could act on', () => {
    for (const [key, reason] of Object.entries(EXCLUSIONS)) {
      expect(reason.length, key).toBeGreaterThan(40);
      expect(reason.trim().endsWith('.'), key).toBe(true);
    }
  });

  it('lists every section once', () => {
    expect(new Set(EXPORT_SECTIONS).size).toBe(EXPORT_SECTIONS.length);
    const named = new Set(
      Object.values(EXPORT_COVERAGE).flatMap((coverage) => ('section' in coverage ? [coverage.section] : [])),
    );
    expect([...named].sort()).toEqual([...EXPORT_SECTIONS].sort());
  });
});
