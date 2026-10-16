# Test and demo access

Medilink uses synthetic identities in local demonstrations and automated tests.
None of the accounts below belongs to a real person, and none may be installed
in staging or production.

## Boundaries

| Environment | Accounts | Password/code source | Rule |
| --- | --- | --- | --- |
| Local demo | `scripts/seed-demo.ts` | Shared public demo password below; console SMS in local logs | Synthetic data only; reset freely |
| Performance | `scripts/seed-performance.ts` | Three synthetic accounts printed by the script | Only a database named `*_perf` |
| Integration | Each test creates its own fixtures | Test-only constants | Only a database named `*_test` |
| Browser journeys | `scripts/e2e-world.ts` creates an isolated world | One-time codes in `.e2e/sms-outbox.jsonl` | CI/local only; file must never exist outside local |
| Staging/production | Individually provisioned accounts | Real configured SMS provider and unique passwords | Never seed demo, performance or E2E users |

The demo and performance seed scripts refuse to run unless `APP_ENV=local`.
The performance seed additionally refuses any database whose name does not end
in `_perf`; the integration preparation refuses a database without `_test`.
Staging and production refuse the console SMS and console payment adapters and
refuse secrets published in the repository.

## Local demonstration accounts

Run:

```bash
docker compose exec web pnpm db:seed
docker compose exec web pnpm tsx scripts/seed-demo.ts
```

Sign in at <http://localhost:3000/login>. Every local demo account uses the
public password `Medilink-demo-2026`. Useful starting accounts are:

| Role | Phone | Demonstrates |
| --- | --- | --- |
| Super administrator | `+2348031200001` | Complete operations console |
| Operations administrator | `+2348031200002` | Onboarding and casework |
| Compliance administrator | `+2348031200003` | Credentials, facilities and incidents |
| Finance administrator | `+2348031200004` | Invoices and payouts |
| Facility owner | `+2348031200011` | Whole facility console and staff access |
| Facility scheduler | `+2348031200013` | Shifts, matching and attendance |
| Facility accounts officer | `+2348031200014` | Timesheets and invoices |
| Eligible practitioner | `+2348031200021` | Offers, active shift and credentials |
| Nurse with near shift | `+2348031200022` | Schedule and submitted timesheet |

The complete synthetic account sheet and each account’s intended state are in
[demo-walkthrough.md](demo-walkthrough.md). The role-by-role acceptance journey
is in [testing-by-role.md](testing-by-role.md).

## Local one-time codes

Local registration and password recovery use `SMS_PROVIDER=console`. Read the
latest message from the local container log:

```bash
docker compose logs web --tail 30
```

The browser journeys instead set `SMS_CONSOLE_OUTBOX=.e2e/sms-outbox.jsonl` and
read their own codes from that ignored file. Delete it after a local test if it
is no longer required. Never copy either source into a ticket, recording or
shared production log.

## Performance accounts

`scripts/seed-performance.ts` prints the three generated logins when it
finishes. They are reserved for the disposable `medilink_perf` database and use
the same public demo password. Do not point the performance scripts at a demo,
test, staging or production database.

## First real administrator

`pnpm db:seed` deliberately creates no people. After migrations and reference
data are installed in a new real environment, an authorised operator creates
the first administrator from the production image:

```bash
node_modules/.bin/tsx scripts/create-first-administrator.ts \
  --phone +234... --name "..."
```

Provide the password through the command’s supported secure prompt/environment
path, not in a committed file, shell history, screenshot or team message. After
the first sign-in, create individual accounts for other operators; never share
an administrator login.

## Release check

Before approving a deployment:

- confirm `APP_ENV` is explicitly `staging` or `production`;
- confirm no demo, performance or E2E seed command appears in the deployment;
- confirm `.e2e/`, `.env` and console SMS output are absent from the image and artifacts;
- confirm the configured SMS provider delivers a code to a controlled real test phone;
- confirm every operator uses an individual account and the expected scope;
- confirm synthetic screenshots contain no copied production data.
