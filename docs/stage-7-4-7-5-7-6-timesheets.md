# Stage 7.4, 7.5 and 7.6 — timesheets

Implements module 10: what the shift came to, who decided about it, and what
the figures were before somebody changed them.

## What a timesheet is here

**A timesheet classifies hours and prices them at the rate both parties
already agreed.** Overtime, night and weekend *allowances* are module 11,
which is Stage 8, and the 3.1 revenue decision is still unmade — inventing
multipliers here would set commercial terms that are not mine to set, the same
reason rate floors waited on 3.1. So the bands are recorded and carry no
premium yet, and `amountKobo` is simply the billable minutes at the request's
hourly rate.

**One aggregate, not two**, continuing the decision in
`docs/stage-7-1-7-2-7-3-attendance.md`: `SUBMITTED`, `APPROVED` and `REJECTED`
are attendance's states, and the timesheet is what is being approved. Two
state machines over one shift would drift.

## Step 7.4 — the hours

`domain/hours.ts` is pure: check-in, check-out, break, the scheduled window,
the hourly rate and the set of holiday dates in, bands out.

- **It walks the shift minute by minute** — at most 1440 iterations,
  deliberately not clever. Interval arithmetic over a window that crosses
  midnight, a band boundary and a date boundary at once is where the bugs
  live, and nothing here is hot enough to justify them.
- **Night is 20:00–06:00 WAT**, using the offset constant availability already
  owns. A shift crossing midnight is in the unit table by name.
- **Holidays are matched on the WAT calendar date**, not on a UTC instant. The
  `date` column is a DATE, so it names a day rather than a moment.
- **Overtime is time beyond the scheduled length**, not beyond a daily cap:
  the facility agreed to a shift of a certain length and anything past it is
  time nobody planned.
- **The break is deducted proportionally across the bands.** Nothing records
  when the break was taken, so charging it to one band would be a guess — and
  any systematic rule picks in the same party's favour every single time.
- **Integer kobo, rounded once at the end** (rule 3), so the stored amount is
  exactly what a ledger entry will carry.
- **On-call is an input, never derived.** It is hours held available, which no
  clock produces and only a person can assert. It is read back from the row on
  every recomputation, so resubmitting a corrected shift does not silently
  drop it.

The hours are **recomputed at submission** rather than edited, so the only way
a timesheet and its attendance record can disagree is if somebody edited one
of them by hand.

## Step 7.5 — submission, approval, rejection

The practitioner submits (`SELF`); the facility decides (`FACILITY`). Approving
what a shift cost is a different act from scheduling it, so it is a different
permission — `timesheet.approve`, not `service_request.publish`.

- **A rejection without a reason is refused**, in the schema and again in the
  application layer. A rejection nobody can act on is worse than no rejection:
  the practitioner has to know what to correct.
- **Approval sets the assignment to `COMPLETED`.** That state has been in the
  enum since Stage 6 with nothing reaching it. It is reached here, through
  matching's own application layer and outside the timesheet transaction,
  because it is matching's write.
- **Approval is compare-and-set**, not read-then-write: the update names
  `status: 'SUBMITTED'` in its `where` and asserts it touched one row, so two
  concurrent approvals cannot both succeed.
- The facility on the request is checked against the assignment. The scope
  guard proves the caller acts for *a* facility; it does not prove this shift
  belongs to it.

## Step 7.6 — corrections

**No correction destroys the value it replaces** is a gate condition, so a
correction writes the **whole previous state** into `timesheet_revisions`
before anything moves — not a diff, because a diff can only be read against a
history nobody kept. The actor and the reason go with it and the revision
number goes up.

**Correcting an already-corrected record is allowed.** A supervisor fixes the
break, then notices the check-out was wrong too. The machine has no
self-transitions, so the application layer guards only a real move — the same
distinction re-issuing a check-in code makes — and each correction still
writes its own revision.

## Cold start ends here

`listMatchCandidates` used to hardcode `completedAssignments: 0` and
`reliabilityScore: null`, because nothing could complete an assignment. Those
fields are now **gone from that shape entirely** and matching reads its own
`assignmentOutcomes`: practitioners does not own assignments, and matching
already calls practitioners, so a field there would have made the dependency
point both ways to carry a number the caller can read for itself.

`domain/reliability.ts` decides what the number means. It is `null` until
something has been decided either way — **not zero**, because a practitioner
with no history is unproven rather than unreliable, and the engine's
cold-start rule turns null into a neutral score rather than a penalty. Only
decided outcomes count: a shift still running, one the facility cancelled, and
an absence a person excused (7.8) are absent from both terms. An excusal that
quietly lowered the ratio would be a penalty by another name.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/assignments/:id/timesheet/submit` | `timesheet.submit` | `SELF` |
| POST | `/api/v1/assignments/:id/timesheet/review` | `timesheet.approve` | `FACILITY` |
| POST | `/api/v1/assignments/:id/timesheet/correct` | `timesheet.approve` | `FACILITY` |
| GET | `/api/v1/assignments/:id/timesheet` | `service_request.read` | `SELF` or `FACILITY` |

The read returns the revisions alongside the timesheet: read without its
history, a timesheet cannot answer the question a dispute asks.

## Not in this stage

- **Allowances and any final payable figure** — Stage 8, per the 3.1 decision.
- **Fault on unhonoured assignments** (7.7) and **excusals** (7.8).
- **Disputes.** `DISPUTED` is in the machine because §9.16 names it.
- **A user interface**, which is still the largest piece of unscoped work.

## Verifying it locally

```
pnpm verify
docker compose exec web pnpm test:integration timesheets
```

The unit table covers the midnight crossing, the public holiday, the
proportional break and the rounding; the integration suite covers the priced
submission, a rejection refused for want of a reason, approval reaching
`COMPLETED`, two corrections in a row with both revisions intact, on-call
surviving a recomputation, and a foreign facility refused at both the review
and the correction.
