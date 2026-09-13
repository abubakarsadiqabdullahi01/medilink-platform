# Stage 8 — disputes

Implements module 14. The first piece of Stage 8, and deliberately the first:
modules 11 and 12 are blocked on the 3.1 revenue decision and the 3.3 payment
provider, and this one is blocked on neither. It needs no money to work.

## What a dispute is here

**A case opened over a shift that has already been decided.** Not a
correction, not a rejection — those are the ordinary routes for a shift still
in play. A dispute is what one party has left after the other has decided and
they disagree.

`DISPUTED` has been in the attendance machine since Stage 7 with an empty
transition list and a comment saying module 14 would fill it. This fills it.

## The split

**The case is this module's; the shift's state is attendance's.**

`disputes.disputes` holds who complained, on which side, why, and what an
adjudicator decided. It reaches the attendance record through `openDispute`
and `closeDispute` in attendance's application layer, never by writing
`attendance.attendance_records`.

That split is why **the attendance record remembers its own pre-dispute
state** rather than the case file doing it. Putting a record back where it was
is attendance's invariant, and a `pre_dispute_status` column there keeps the
state machine's whole story inside the module that owns it.

## The state machine, reopened

`DISPUTED` now leads to three places rather than nowhere:

| Outcome | Where the record goes |
| --- | --- |
| Upheld | `SUBMITTED` — the figures are decided again |
| Dismissed | back to `APPROVED` or `REJECTED`, whichever it was |
| Withdrawn | the same restore a dismissal does |

**No attendance state is terminal any more**, and the exhaustive 81-pair test
says so where it used to assert `DISPUTED` was the only one. An approved shift
can be disputed and a dispute resolves back into the machine, so nothing is
ever permanently frozen. What stops a record cycling forever is this module's
one-open-case rule, not the machine — which describes what is *possible*, and
should not be asked to describe what is *allowed*.

**Upholding does not rewrite the hours.** An adjudicator decides who was
right; the facility then corrects the timesheet through the ordinary route, so
the change lands in `timesheet_revisions` with its own actor and reason. A
resolution that silently rewrote the figures would be a correction nobody
could see in the one table built to show corrections.

## Who may do what

One permission, three scopes — and the scope is the whole distinction.
`dispute.manage` is held by practitioners, facility owners and operations
officers alike, so the key alone cannot tell "complain about my own shift"
from "adjudicate somebody else's". The grant's scope can:

| Act | Scope |
| --- | --- |
| Raise | `SELF` (practitioner) or `FACILITY` |
| Withdraw | `SELF`, and only the party who raised it |
| Review, resolve | `PLATFORM` |

**An adjudicator cannot open a case.** `partyFor` returns null for somebody on
neither side of the shift, which `openBlockers` turns into `not_a_party`. A
case nobody involved wanted is not a dispute, it is an audit — and there is
already an audit trail for that.

This is the case Section 8.8's permission-plus-scope rule exists for, and the
reason no new permission key was added.

## The window

**Fourteen days, from the decision rather than from the shift.**

A real cut-off, not a formality: the evidence a dispute turns on is a ward's
own record of who was on the floor, and those get thinner every week. Long
enough to notice a wrong payment, short enough that somebody can still check.

Running it from the decision matters — a timesheet approved three weeks late
leaves the practitioner the same fortnight as one approved the next morning.

## Evidence

Files go to Tigris under the `dispute_evidence` purpose, which was already in
`ObjectPurpose` waiting for this. Only the key is stored, per the schema
convention, and the browser uploads to a signed URL so the file never passes
through the application — the shape credential documents already use.

**Either party may attach; neither may remove.** A dispute where one side can
withdraw an inconvenient photograph after the other has seen it is not a
record of anything. Append-only, for the reason `checkin_events` and
`timesheet_revisions` are.

Download links are issued per read and audited. A dispute's evidence is the
most sensitive thing this module holds — a photograph of a ward, a medical
letter — and a permanent URL would outlive any reason to hold it.

## Nothing is published on resolution

`DisputeOpened` is published; no event marks a resolution, and that is a
decision rather than an omission. Upholding sends the figures back to
`SUBMITTED`, so the ordinary approval path publishes `TimesheetApproved` again
when they are decided. Dismissing restores the record unchanged, so there is
nothing downstream to react to. An event would carry no information the
existing ones do not, and Section 8.2's vocabulary is not mine to extend for
that.

## A bug this found

Re-approving a shift after an upheld dispute threw `A COMPLETED assignment
cannot become COMPLETED`. The first approval had already set the assignment to
`COMPLETED`, and the second had nowhere to go.

The fix is that **completing an already-completed assignment is a no-op**, not
an illegal move. The hours were in question, not whether the shift happened —
the practitioner did work — so the assignment stays completed throughout. An
integration test asserts the reliability count and the status history both
still show exactly one completion after a full dispute round trip, because the
alternative would be a practitioner inflating their own record by disputing
their own shift and winning.

## Routes

| Method | Path | Scope |
| --- | --- | --- |
| POST | `/api/v1/assignments/:id/disputes` | `SELF` or `FACILITY` |
| GET | `/api/v1/assignments/:id/disputes` | `SELF` or `FACILITY` |
| GET | `/api/v1/disputes` | `PLATFORM` |
| GET | `/api/v1/disputes/:id` | `PLATFORM` |
| POST | `/api/v1/disputes/:id/review` | `PLATFORM` |
| POST | `/api/v1/disputes/:id/resolve` | `PLATFORM` |
| POST | `/api/v1/disputes/:id/withdraw` | `SELF` |
| POST | `/api/v1/disputes/:id/evidence/upload-url` | `SELF` |
| POST | `/api/v1/disputes/:id/evidence` | `SELF` |
| GET | `/api/v1/disputes/:id/evidence` | `PLATFORM` |

All ten carry `dispute.manage`.

## Not in this stage

- **Any adjustment to money.** Modules 11 and 12 do not exist, and upholding a
  pay dispute currently means the figures go back to be decided again. When
  billing lands, a resolved dispute will need to reach it; the hook is the
  re-approval, not a new event.
- **Turning an upheld `NON_ATTENDANCE` dispute into a no-show.** A facility
  disputing a shift it already approved, on the grounds that nobody came, is a
  real case with an awkward answer: `COMPLETED` has no transition out, and
  adding one to satisfy an edge case would weaken a state that means
  something. Today it goes back for re-decision and the facility rejects the
  timesheet. Worth revisiting with real pilot data.
- **A time limit on adjudication.** Nothing ages a case out of the queue,
  because an unresolved dispute is unfinished business rather than a stale row
  — the same reasoning as the unhonoured queue in 7.7.
- **Notifying either party.** Module 16 records messages; wiring the dispute
  events to it is not done here.

## Verifying it locally

```
pnpm verify
docker compose exec web pnpm test:integration disputes
```

The unit table covers the window arithmetic at its boundary, every open,
resolve and withdraw blocker, and which side of a shift somebody is on. The
integration suite covers the full round trip both ways, a dismissal restoring
`APPROVED` and `REJECTED` distinctly, an adjudicator refused when they try to
open a case, a foreign facility refused, a second open case refused, the
fourteen-day cut-off, re-disputing after a dismissal with both cases kept, and
the completion count holding at one across it all.
