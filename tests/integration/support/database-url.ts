/**
 * Integration tests run against a real PostgreSQL, because the behaviour they
 * prove — transactional audit rows, SKIP LOCKED claiming, rollback — does not
 * exist in a mock. They also truncate every table between cases, so pointing
 * them at the wrong database would delete a developer's working data.
 *
 * Hence the naming rule below: the suite refuses to start unless the database
 * name ends in `_test`. A convention that is only written in a README is one
 * that gets skipped at 6pm on a Friday.
 */

const TEST_SUFFIX = '_test';

function baseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Neither TEST_DATABASE_URL nor DATABASE_URL is set. Integration tests need a PostgreSQL to run against.',
    );
  }
  return url;
}

function parsed(): URL {
  const url = new URL(baseUrl());
  const name = url.pathname.replace(/^\//, '');

  if (!name) {
    throw new Error(`No database name in the connection string "${url.host}${url.pathname}".`);
  }

  // Idempotent: deriving twice must not produce medilink_test_test.
  if (!name.endsWith(TEST_SUFFIX)) {
    url.pathname = `/${name}${TEST_SUFFIX}`;
  }

  return url;
}

export function testDatabaseName(): string {
  const name = parsed().pathname.replace(/^\//, '');

  if (!name.endsWith(TEST_SUFFIX)) {
    throw new Error(
      `Refusing to use "${name}" for integration tests: the name must end in "${TEST_SUFFIX}", ` +
        'because the suite truncates every table between cases.',
    );
  }

  // The name is interpolated into CREATE DATABASE, which takes no parameters.
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to use "${name}" as a database name: letters, digits and underscore only.`);
  }

  return name;
}

export function testDatabaseUrl(): string {
  testDatabaseName();
  return parsed().toString();
}

/** The same server, connected to `postgres`, for CREATE DATABASE. */
export function adminDatabaseUrl(): string {
  const url = parsed();
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}
