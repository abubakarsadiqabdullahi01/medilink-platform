# Stage 4.5 — audit coverage

Implements gate item 4.5: an audit log on every state change, verified by
"a test harness fails the suite if any write leaves no audit row".

## The problem this solves

`recordAudit` has existed since 4.1 and every call site so far uses it. That
is worth exactly as much as the next developer's memory. A service that
updates a row and omits the audit call breaks nothing visible: the endpoint
returns 200, the tests pass, and the gap surfaces months later when a
compliance officer asks who changed a payout account and the answer is that
nobody knows.

An audit trail cannot be backfilled. The rule therefore needs enforcement that
runs on every commit rather than a convention in a document.

## How it works

`src/lib/audit-coverage.ts` attaches a Prisma middleware to the shared client
and records, inside a window a test opens:

* every write to a model listed in `AUDITED_MODELS`
* every row written to `audit.audit_log`

At the end of the window, a write whose table no audit row names is reported.
The report is a list of the offending call sites, not a failed count, because
"expected 0 to be 1" tells you nothing about which write got away.

Middleware rather than a client extension: application code imports the
`prisma` singleton directly, so an extended client would be a different object
that nothing under test would use.

## What counts as a state change

`AUDITED_MODELS` maps a model to the table name its audit rows carry.
`EXEMPT_MODELS` lists the four tables the rule does not apply to, each with
its reason:

| Table | Why it is exempt |
| --- | --- |
| `audit.audit_log` | It is the audit record. Auditing it is circular, and it has no update or delete path. |
| `audit.outbox_events` | Delivery bookkeeping. The state change that published the event is audited; attempt counts and backoff are not decisions anyone made. |
| `audit.security_events` | Append-only security evidence in its own right. |
| `identity.login_attempts` | Append-only evidence of every sign-in attempt and the input to the lockout throttle. Auditing each failed guess would bury real state changes under noise. |

A test asserts that **every** model in the schema appears in one list or the
other. Adding a model without deciding which fails the suite, which is the
point: the decision is cheap now and expensive later.

## Precision and its limits

Matching is by table, not by row. A window that writes two rows to
`identity.users` and audits one of them passes.

This is deliberate rather than an oversight. Matching by entity id would need
every `recordAudit` call to key on the row it describes, and some legitimately
do not — `auth.otp_issued` names the user rather than the code, because the
code's id is not a thing anyone will ever search for. Table-level matching
catches the failure that actually happens, which is a write path with no audit
call at all, and it produces no false alarms that would train people to ignore
it.

Two further checks close part of the gap: a bulk write that matched no rows is
not counted, since nothing changed; and an audit row naming a table that does
not exist is reported, which catches a typo in `entityType` that would
otherwise satisfy the matching while making the trail unsearchable.

Table-level matching also means a write path can pass only because an
unrelated write to the same table happened to be audited elsewhere in the
same window — which is a real gap, not the accepted one above. `identity.otp_codes`
had exactly this: issuing a code is audited, but until this was found neither
a failed guess (an `attempts` increment) nor a successful redemption ever
wrote its own audit row, so both passed only by sharing a window with some
`auth.otp_issued` row. The fix, in `src/modules/auth/application/otp-service.ts`:
a failed guess now writes its own `auth.otp_attempt_failed` row, atomically
with the increment; a successful redemption still writes none, but is now
folded into the same transaction as the state change it authorises, so it can
no longer occur — successfully or not — without that change's own audit row.
The first is a real per-write audit row; the second is a real per-write
guarantee the harness cannot see but the transaction boundary enforces
regardless. Neither relies on coincidence anymore.

## Verifying it

```
docker compose exec web pnpm test:integration
```

The suite drives the real services — register, verify, set password, log in,
revoke, request a reset, confirm it — and asserts the harness finds nothing.

It then asserts the harness *would* have found something: one case writes a
user with no audit row and expects the failure, another writes a deliberate
`entityType` typo. A coverage check that cannot fail reports success on an
empty room, and §2.5 of the plan is explicit that a decorative test is worse
than none.

## Not in this stage

- Row-level matching, as above.
- Enforcement outside tests. The middleware is test-only machinery; it does
  not reject an unaudited write at runtime. Doing that would mean a missing
  audit call takes down a production endpoint, which trades a recording gap
  for an outage.
