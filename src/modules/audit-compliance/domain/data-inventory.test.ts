// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DATA_CATEGORIES,
  INVENTORY_STATUS,
  PURGE_RULES,
  purgeDaysFor,
  renderInventory,
} from './data-inventory';

/**
 * AUD-04: a data inventory nobody had to keep up to date would be out of date
 * by the next migration. These tests are what make adding a table a decision.
 */

const ROOT = join(__dirname, '../../../..');

/** Every table the schema defines, as `schema.table`. */
function schemaTables(): string[] {
  const source = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const tables: string[] = [];
  for (const [, body] of source.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)) {
    const table = /@@map\("(\w+)"\)/.exec(body!)?.[1];
    const schema = /@@schema\("(\w+)"\)/.exec(body!)?.[1];
    if (table && schema) tables.push(`${schema}.${table}`);
  }
  return tables;
}

describe('the data inventory', () => {
  it('finds the tables the schema defines', () => {
    // A guard on the parser: an inventory that matches nothing proves nothing.
    expect(schemaTables().length).toBeGreaterThan(50);
  });

  it('accounts for every table in the schema', () => {
    const listed = new Set(DATA_CATEGORIES.flatMap((category) => category.tables));

    const missing = schemaTables().filter((table) => !listed.has(table));

    expect(missing).toEqual([]);
  });

  it('names no table that does not exist', () => {
    const real = new Set(schemaTables());

    const invented = DATA_CATEGORIES.flatMap((category) => category.tables).filter(
      (table) => !real.has(table),
    );

    expect(invented).toEqual([]);
  });

  it('puts each table in exactly one category', () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const category of DATA_CATEGORIES) {
      for (const table of category.tables) {
        if (seen.has(table)) twice.push(`${table} in ${seen.get(table)} and ${category.key}`);
        seen.set(table, category.key);
      }
    }

    expect(twice).toEqual([]);
  });

  it('says purpose, basis, owner, retention and deletion for every category', () => {
    for (const category of DATA_CATEGORIES) {
      for (const field of ['name', 'holds', 'purpose', 'basis', 'owner', 'retention'] as const) {
        expect(category[field].trim(), `${category.key}.${field}`).not.toBe('');
      }
      expect(category.tables.length, category.key).toBeGreaterThan(0);
    }
  });

  it('has unique category keys', () => {
    const keys = DATA_CATEGORIES.map((category) => category.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every purge rule a number of days and a category that owns it', () => {
    const owned = DATA_CATEGORIES.flatMap((category) => category.purges ?? []);

    for (const rule of PURGE_RULES) {
      expect(rule.days, rule.key).toBeGreaterThan(0);
      expect(owned.filter((key) => key === rule.key), rule.key).toHaveLength(1);
    }
    expect(new Set(PURGE_RULES.map((rule) => rule.key)).size).toBe(PURGE_RULES.length);
    for (const key of owned) expect(PURGE_RULES.map((rule) => rule.key)).toContain(key);
  });

  it('says a category is purged only if it has a rule that purges it', () => {
    for (const category of DATA_CATEGORIES) {
      if (category.enforcement === 'purge_job') {
        expect(category.purges?.length ?? 0, category.key).toBeGreaterThan(0);
      }
    }
  });

  it('looks the days up by rule, and refuses data that is not purged', () => {
    expect(purgeDaysFor('sign_in_codes')).toBeGreaterThan(0);
    expect(() => purgeDaysFor('money')).toThrow(/no purge rule/i);
  });

  it('is open about what has not been signed off, and what nothing yet enforces', () => {
    expect(INVENTORY_STATUS).toMatch(/not (been )?signed off/i);
    expect(DATA_CATEGORIES.some((category) => category.notEnforced)).toBe(true);
  });
});

describe('the inventory document', () => {
  it('is the one rendered from this data, so counsel reads what the code does', () => {
    const written = readFileSync(join(ROOT, 'docs/data-inventory.md'), 'utf8').replace(/\r\n/g, '\n');

    expect(written).toBe(renderInventory());
  });

  it('says it is a proposal in its first lines', () => {
    expect(renderInventory().split('\n').slice(0, 8).join('\n')).toMatch(/proposed/i);
  });

  it('lists every category by name', () => {
    const rendered = renderInventory();

    for (const category of DATA_CATEGORIES) expect(rendered).toContain(category.name);
  });
});
