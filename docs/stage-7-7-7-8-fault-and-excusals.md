# Stage 7.7 and 7.8 — fault and excusals

Implements the part of module 13 that Stage 7's gate turns on: **every
unhonoured assignment carries a fault decision.**

## The shape of it

**A sweep flags; a person decides.** Nothing closes itself and nothing
accuses a practitioner unreviewed. An absence has a dozen innocent
explanations — a death in the family, a ward that never opened, a flooded
road — and the platform cannot tell them apart from a database row. What it
can do is refuse to let the question go unanswered.

Two tables in a new `cancellations_sanctions` schema:

`unhonoured_assignments` — one per flagged assignment, `AWAITING_DECISION`
until somebody closes it. `fault` is nullable *while* the status is awaiting,
which is what makes the absence of a decision visible rather than implied.

`excusals` — **not unique per assignment**, because both outcomes are
retained: a refusal is a row that stays, and a later request is a second row
rather than an overwrite of the first.

## Step 7.7 — the sweep

`assignment.unhonoured_sweep`, hourly, on the Stage 5 runner.

It takes the `CONFIRMED` assignments whose shift has ended and asks attendance
which of them show any sign of having happened. Both halves go through their
own module's application layer — `listEndedConfirmedAssignments` in matching,
`assignmentsWithAttendance` in attendance — because a module never reads
another module's tables.

**"Any sign" is deliberately generous.** A record still at `NOT_STARTED` means
nobody touched it; anything else, including a check-in that was only ever
pending, means somebody was there doing something. A sweep that accused on a
narrower test would be accusing on a network failure.

**Idempotent**, because `claimDueJobs` guarantees nothing about how many times
a sweep runs: a unique index on `assignment_id` and an explicit skip mean a
second pass writes nothing. The audit row it writes has **no actor** — the
sweep is not a person, and a name against a finding nobody made would be worse
than a blank.

## Step 7.7 — the decision

`closeBlockers` in `domain/fault.ts` is pure and returns everything wrong at
once, the shape `confirmBlockers` already uses. The gate condition is one of
its four cases:

- `fault_not_decided` — **null is not a decision**, it is the absence of one,
  and closing on it would record silence as a finding. The route schema has no
  default and no optional either, but the refusal lives in the application
  layer too, so it holds for a script and a sweep alike.
- `reason_missing` — a minimum length, for the reason a manual attendance
  record's reason has one.
- `already_closed`, enforced again as a compare-and-set so two officers
  deciding at once cannot both write a finding.
- `excused_cannot_be_practitioner_fault`, below.

**Only practitioner fault produces a `NO_SHOW`.** A facility that never opened
the ward and a flood that closed the road are both real, and neither is the
practitioner's record to carry; both land on `CANCELLED`. `NO_SHOW` is the
other state Stage 6 left unreachable, and this is what reaches it.

**Fault is decided at `PLATFORM` scope, never `FACILITY`.** A facility
deciding whether its own practitioner was at fault for a shift that facility
failed to open is not a finding anyone should rely on. The route table test
asserts no route in this module is facility-scoped.

## Step 7.8 — excusals

The practitioner asks (`SELF`); an officer grants or refuses (`PLATFORM`).
Requesting is always allowed — whether the reason is any good is the officer's
judgement, not a validation rule. A refusal needs notes, for the reason a
rejected timesheet does.

**A granted excusal carries no penalty**, and that is true of the data rather
than only of the intention:

- Granting closes any open determination as `NEITHER`, so the assignment
  reaches `CANCELLED` and never `NO_SHOW`.
- `NO_SHOW` is the only thing in the no-show term of the reliability ratio, so
  the score is unchanged. The test asserts the outcomes are still
  `{ completed: 0, noShow: 0 }` and reliability still `null`.
- Granting is itself a person's decision, so the gate condition is *satisfied*
  rather than bypassed — the determination has a fault value and a decider.
- If the excusal is granted before the sweep has run, `closeBlockers` still
  makes practitioner fault impossible afterwards. The invariant does not
  depend on the order things happened in.

**Refusing decides nothing about fault.** An excusal refused for being
unpersuasive is not the same as an absence proven to be the practitioner's
fault, so the determination stays awaiting a decision the officer still has to
make.

## Permissions

No new keys. Requesting an excusal is `attendance.record` at `SELF` — it is an
assertion about your own attendance at a shift, by the person the record is
about, which is the same permission and scope as recording a check-in.
Deciding one is `sanction.apply`, because granting or refusing it is what
determines whether a penalty follows.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| GET | `/api/v1/unhonoured` | `sanction.apply` | `PLATFORM` |
| POST | `/api/v1/assignments/:id/fault` | `sanction.apply` | `PLATFORM` |
| POST | `/api/v1/assignments/:id/excusals` | `attendance.record` | `SELF` |
| GET | `/api/v1/assignments/:id/excusals` | `attendance.record` | `SELF` |
| POST | `/api/v1/excusals/:id/decide` | `sanction.apply` | `PLATFORM` |

## Not in this stage

- **The sanction ladder.** The plan puts automating it in step 10.1, after the
  pilot has shown what the manual decisions actually were. Encoding a tariff
  now would be guessing at it.
- **Cancellation fees and windows.** They are commercial terms, and 3.1 is
  still unmade — the same reason rate floors and allowances waited.
- **Disputing a fault finding.** Module 14 is Stage 8.

## Verifying it locally

```
pnpm verify
docker compose exec web pnpm test:integration unhonoured
```

The unit table covers every close blocker and every fault outcome; the
integration suite covers the sweep flagging and not flagging, a close refused
for want of a decision, practitioner fault reaching `NO_SHOW` with its event,
facility fault costing the practitioner nothing, a granted excusal leaving
reliability untouched, and a refusal still on the record after a later grant.
