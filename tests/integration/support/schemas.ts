/**
 * Every PostgreSQL schema this application owns.
 *
 * One list, because there were two: the truncation helper and the
 * audited-model registry test each carried their own, and adding a module
 * meant remembering both. `facilities.facilities` was in neither at first and
 * was still being emptied between cases — but only because `TRUNCATE ...
 * CASCADE` on `identity.users` happened to reach it through a foreign key.
 * The next module's table might not have one, and would leak rows into every
 * test that followed it.
 */
export const APP_SCHEMAS = [
  'identity',
  'audit',
  'config',
  'storage',
  'practitioners',
  'credentials',
  'facilities',
  'availability',
  'service_requests',
] as const;

/**
 * `config` holds the controlled vocabularies the seed loads — reference data,
 * not test state — so it is never truncated.
 */
export const MUTABLE_SCHEMAS = APP_SCHEMAS.filter((schema) => schema !== 'config');

/**
 * Tables inside `config` that are test state rather than reference data.
 *
 * `sanctioned_entries` is compliance-owned like every other config list, so
 * that is where it belongs — but it ships empty and the tests write to it, and
 * a listed name left behind would flag an unrelated practitioner in every case
 * that followed.
 */
export const MUTABLE_CONFIG_TABLES = ['config.sanctioned_entries'] as const;
