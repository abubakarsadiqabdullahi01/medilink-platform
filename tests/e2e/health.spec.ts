import { expect, test } from '@playwright/test';

test('health endpoint reports the database is reachable', async ({ request }) => {
  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(body.checks.database).toBe('ok');
});
