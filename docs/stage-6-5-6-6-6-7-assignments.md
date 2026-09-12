# Stage 6.5, 6.6 and 6.7 — invitation, confirmation, conflict

Implements the rest of module 7: a facility invites the practitioners it
chose, they answer, and a confirmation puts one of them on the shift.

This is where the Stage 6 gate closes.

## The lifecycle

`matching.invitations` (`INVITED → ACCEPTED | DECLINED | EXPIRED |
WITHDRAWN`), `matching.assignments` (`CONFIRMED → CANCELLED | COMPLETED |
NO_SHOW`), and `matching.assignment_status_history`.

A request reaches `FILLED` when its headcount is met, and returns to
`PUBLISHED` if a confirmed assignment is later cancelled — a freed place needs
filling again.

## Decisions worth knowing

**Invitations are chosen, not automatic.** A match run ranks; a person
decides. Step 9.4 requires every match to be hand-reviewed for the first fifty
engagements, so the platform never invites anybody on its own.

**Accepting is not being confirmed.** A practitioner saying yes only says they
are willing; the facility still confirms. That is why there is no event on a
decline and why `invitation_not_accepted` is a confirmation blocker.

**A decline requires a reason.** It tells a facility whether to ask again, and
the pilot's suggestion log (step 9.5) is built from exactly this.

**Inviting the same person twice is a no-op.** A facility clicking twice
should not see an error.

**Step 6.6 is enforced by the schema, not by discipline.**
`assignment_status_history.actor_id` and `.reason` are both required columns,
so no status change can be written without them. Remembering to record the
actor is not a plan; making the row impossible without one is.

**Step 6.7 uses an advisory lock, not a check-then-insert.** Confirmation
takes `pg_advisory_xact_lock` keyed on the practitioner, then reads, then
writes — so two overlapping confirmations run at the same instant serialise
and exactly one wins. Without it the check passes twice and both rows land.

An `EXCLUDE USING gist` constraint would also work and would be stricter, but
Prisma's schema cannot express one, and hand-written DDL inside a generated
migration is drift this repository has already chosen to avoid once. The lock
is keyed on the practitioner, so confirmations for different people never wait
on each other — there is a test for that too, because a correctness fix that
serialises the whole table is a different bug.

**Back-to-back shifts are allowed.** A shift ending at 14:00 and one starting
at 14:00 do not overlap. Whether somebody should work both is a fatigue
question, and fatigue is a scoring factor rather than a bar.

**The conflict check counts only `CONFIRMED` assignments**, so cancelling one
frees the practitioner to take a clashing shift.

**Notification goes through the outbox, not the confirming transaction.**
Holding a transaction open across an SMS gateway parks a database connection
for the gateway's latency — the reasoning `issueOtp` already documents. The
handler is idempotent, because the outbox delivers at least once and a retry
must not send a second message.

**The recipient is stored masked.** `notifications.messages` is read by more
people than `identity.users` is, for the same reason the audit trail carries
no NIN.

**Invitation audit rows are scoped to the practitioner, not the facility.**
Being invited is a thing that happened to them, and they must see it in their
own history.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/service-requests/:id/invite` | `assignment.confirm` | `FACILITY` |
| POST | `/api/v1/service-requests/:id/confirm` | `assignment.confirm` | `FACILITY` |
| GET | `/api/v1/invitations` | `service_request.read` | `SELF` |
| POST | `/api/v1/invitations/:id/respond` | `service_request.read` | `SELF` |
| GET | `/api/v1/assignments` | `service_request.read` | `SELF` or `FACILITY` |
| POST | `/api/v1/assignments/:id/cancel` | `assignment.cancel` | `FACILITY` |

## The scheduled sweep

`service_request.expiry_sweep`, hourly: a published request whose shift has
already started becomes `EXPIRED`, and any invitation still awaiting an answer
is withdrawn with it. A stale request keeps appearing in lists, keeps
accepting answers, and quietly distorts the fill-rate metric the pilot is
judged on — and a practitioner should not be able to accept a shift that has
begun.

## The Stage 6 gate

| Condition | Where |
| --- | --- |
| A request reaches confirmed assignment without manual database intervention | `assignments.test.ts`, first case |
| Match results are explainable | `matching.match_runs`, read back through `GET /match-runs/:id` |
| A new practitioner with no history can be matched | the cold-start cases in `engine.test.ts` and `matching.test.ts` |
| Overlapping assignments are prevented, not warned about | the concurrent confirmation case, asserting exactly one succeeds |

## Not in this stage

- **`COMPLETED` and `NO_SHOW`.** Reachable in the transition table and set by
  nothing: attendance (Stage 7) is what says whether somebody turned up. This
  is also why reliability stays neutral for everyone.
- **Invitation expiry as a sweep.** `isInvitationOpen` refuses a lapsed
  invitation whenever it is read, so the rule holds; the stored status only
  changes when the request itself expires.
- **A practitioner cancelling their own assignment.** Withdrawal after
  confirmation is a fault question, which is Stage 7's step 7.7.
- **Notifying on invitation.** Only confirmation notifies today; the event is
  published and nothing consumes it.
- **A user interface.** Step 6.5 says "end to end", and here that means
  through the API.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

Note that the worker keeps its **own** `node_modules` volume: after a
migration adds a model, `docker compose exec worker pnpm prisma generate` and
restart it, or its sweeps fail with `Cannot read properties of undefined` on
the new model. Running migrations in `web` does not regenerate the worker's
client.
