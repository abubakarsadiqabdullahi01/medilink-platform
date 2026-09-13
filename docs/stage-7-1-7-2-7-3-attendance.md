# Stage 7.1, 7.2 and 7.3 — attendance

Implements module 9 of the specification: what actually happened during the
shift, captured in a way that survives a dispute months later.

## Model

`attendance.attendance_records` — one per assignment, carrying **the nine
states of §9.16 verbatim**: `NOT_STARTED`, `CHECK_IN_PENDING`, `CHECKED_IN`,
`CHECKED_OUT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `DISPUTED`,
`MANUALLY_CORRECTED`.

`attendance.checkin_events` — append-only. The record holds the current
state; this holds how it got there, which is what a dispute actually reads.

`attendance.checkin_tokens` — the short-lived secret behind both the
supervisor code and the QR.

**One aggregate, not two.** The specification lists both `attendance_records`
and `timesheets`, and its nine states include submitted, approved and
rejected — so submission and approval act on the attendance record, and the
timesheet lines are what is being approved. Two parallel state machines over
the same shift would drift.

## Step 7.1 — the state machine

Every transition goes through one table in `domain/state-machine.ts`, and the
application layer calls `assertTransition` rather than assigning a status. The
gate condition is that "attendance cannot reach an illegal state through any
code path", and that is only true if there is exactly one path.

The test is **exhaustive over all 81 ordered pairs**, written against a
legal-transitions list kept deliberately separate from the table it checks — a
careless edit to the table then fails the test rather than agreeing with
itself.

Decisions inside the machine:

- **`MANUALLY_CORRECTED` is reachable from anywhere a shift can go wrong**, not
  just from one place. A facility whose network failed may be recording before
  check-in, between check-in and check-out, or after a rejection. It leads back
  to `SUBMITTED`, because a corrected record still has to be approved.
- **`APPROVED` is terminal except for a dispute.** A shift that has been
  approved and will be paid must not quietly become something else; the only
  way back is a visible act with a case attached.
- **`DISPUTED` is the only state with nothing after it.** Module 14 is Stage 8,
  and the empty transition list says so rather than implying it.
- **No self-transitions.** Re-issuing a code while already `CHECK_IN_PENDING`
  is ordinary — a supervisor re-reads it because the practitioner mistyped —
  so the application layer guards only a real move. That distinction was found
  by the integration test, not by reading the code.

## Step 7.2 — one secret, two renderings

"Supervisor OTP or short-lived QR" is **not two systems**. The facility issues
one token bound to `(assignmentId, purpose)`; it renders as a six-digit code a
supervisor reads aloud and as a QR payload a phone can scan. One expiry rule,
one attempt limit, one thing to reason about when a shift is disputed.

- **Keyed HMAC**, for the reason `docs/stage-4-2-auth.md` gives for one-time
  codes: six digits is a million possibilities, and an unkeyed hash of a leaked
  table is reversible by exhaustive search in under a second.
- **The assignment and purpose are bound into the digest**, so a check-in code
  cannot be replayed as a check-out, and a code issued for one shift cannot be
  presented against another.
- **Five minutes.** Long enough to read a code down a ward; short enough that a
  photograph of a QR taped to a noticeboard is worthless by the time anyone
  else uses it. The token's whole job is to prove presence *now*.
- **The facility issues and the practitioner presents.** That direction is what
  makes it evidence: a code the practitioner could generate themselves would
  prove only that they own a phone. It is why issuing is `FACILITY`-scoped and
  presenting is `SELF`.
- **The attempt is counted before the caller learns the result**, so abandoning
  the request mid-flight buys no free guess — the reasoning `consumeOtp`
  already follows.
- **The plaintext code is returned once and never stored or audited.** It is a
  live credential for the next five minutes.
- **Issuing a new code supersedes the outstanding one**, so a stale code read
  out earlier stops working.

## Step 7.3 — recordable when the network fails

A supervisor records the times afterwards with a **mandatory reason**, and the
record is marked `MANUALLY_CORRECTED` so nobody later mistakes it for a
token-backed check-in.

`occurredAt` and `recordedAt` are separate columns, and this is the case they
exist for: a manual record says both when the shift happened and when somebody
wrote it down.

The reason has a minimum length. "Network" tells nobody anything, and a manual
record is exactly the one a dispute turns on.

What "the network failed" means server-side is that no token could be
exchanged. **True offline capture is a client concern** — a PWA queueing
writes — and is not in this stage.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/assignments/:id/attendance/token` | `attendance.record` | `FACILITY` |
| POST | `/api/v1/assignments/:id/attendance/present` | `attendance.record` | `SELF` |
| POST | `/api/v1/assignments/:id/attendance/manual` | `attendance.record` | `FACILITY` |
| GET | `/api/v1/assignments/:id/attendance` | `service_request.read` | `SELF` or `FACILITY` |

## Not in this stage

- **Submission and approval** (7.5) and **corrections to the timesheet** (7.6),
  which is why `SUBMITTED`, `APPROVED` and `REJECTED` are in the machine with
  nothing reaching them yet.
- **Disputes.** `DISPUTED` exists because §9.16 names it; module 14 is Stage 8.
- **GPS or coarse location.** The specification calls it optional and "never
  the sole method". Nothing in the schema holds coordinates, and adding
  location data about people with no consumer for it is not worth doing.
- **Offline capture in the client**, as above.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

The unit suite covers all 81 state pairs and the token's refusals; the
integration suite covers the round trip both ways, the QR rendering, an
expired and a superseded code, a payload naming another shift, and the manual
fallback with its mandatory reason.
