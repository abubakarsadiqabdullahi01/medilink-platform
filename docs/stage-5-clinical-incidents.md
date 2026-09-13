# Module 15 — clinical incidents

A Stage 5 module that was never built. The module map has carried "folder
only" against it since the map was written, and the Stage 5 commits went past
it. This closes it, and with it the `user.suspend` permission, which had been
in the catalogue since Stage 4 **with no code behind it anywhere**.

## The governing principle

**A report is not an accusation.**

The patient-safety literature is unanimous that a reporting system which
punishes reporters stops receiving reports, and a platform that hears nothing
about near misses is worth less than one that never asked. That principle is
not a comment here; it is load-bearing, and it shows up in the code as:

- **Reporting asks for a summary and nothing else.** Every additional
  mandatory field is a reason somebody closes the form instead, and then the
  report simply does not exist.
- **The shift and the practitioner are both optional.** An incident found
  during a case note review a week later may not be traceable to one
  assignment; a medication error in a shared drug cupboard may involve nobody
  in particular. Refusing either report because the paperwork is untidy loses
  the report.
- **`NEAR_MISS` is first in the severity enum, not last.** They are the most
  useful reports and the easiest to lose.
- **`SYSTEM_ISSUE` is first in the outcome enum.** It is the commonest true
  answer to a clinical incident and the one a blame-first process never
  reaches.
- **Nothing deletes or edits a report.** There is no `DELETE` and no `PATCH`
  in the route table, and a test asserts it. A report that can be withdrawn is
  one a facility can be pressured into withdrawing, and the value of the log
  is that it holds what people said at the time.

## Who decides

Reporting is `incident.report` at `FACILITY`; deciding is `incident.manage` at
`PLATFORM`. A facility judging an incident that reflects on its own staffing
is not a finding anyone should rely on — the same reasoning that put fault
determination at `PLATFORM` in step 7.7.

A read of one incident returns **every other report naming the same
practitioner** alongside it, because one incident read alone cannot
distinguish a bad night from a pattern, and that distinction is the whole of
the decision compliance has to make.

## Closing

An outcome and a reason, both mandatory. Additionally, **a `SEVERE` incident
or a death cannot be closed straight from `REPORTED`** — somebody has to have
picked it up first. A death closed as "no action" with a one-line note is the
failure mode that rule exists to make awkward, and the status is the only
evidence either way.

## Suspension

`user.suspend` had a permission and no implementation. Nothing in the codebase
could suspend an account.

It lives in this module rather than in `auth` because the specification
defines `incident.manage` as "Manage a clinical incident, **including
suspension**" — a suspension with no case attached is the exception, not the
rule.

- **The suspension and the closure are written in one transaction.** A closure
  claiming `PRACTITIONER_SUSPENDED` with nobody suspended, or a suspension
  recorded under `NO_ACTION`, are both records that lie, and this is the only
  place either could be written.
- **`account_suspensions` is a decision log, not a flag.**
  `identity.users.status` says what somebody is now; this says how they got
  there and why. A suspension with no recorded reason is one nobody can lift
  with any confidence, which is how people stay suspended by accident.
- **Reinstating carries its own mandatory reason** and closes the suspension
  row rather than deleting it. Lifting is as much a decision as imposing.
- **Reinstatement returns the account to `ACTIVE`, not to its earlier status.**
  A practitioner suspended out of `UNDER_REVIEW` has by then been looked at
  rather harder than the review would have managed, and the Stage 5 activation
  sweep re-checks every eligibility rule on its next pass anyway. Restoring a
  stale status would be reinstating the paperwork rather than the person.

## The teeth

**A suspension makes the practitioner ineligible immediately**, and that is
asserted end to end rather than assumed: `SUSPENDED` fails the
`account_not_usable` check in the Stage 5 eligibility rule, so they stop
matching the moment the closure is written — no sweep, no delay, everywhere at
once. Without that assertion the module would be a filing cabinet.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/incidents` | `incident.report` | `FACILITY` |
| GET | `/api/v1/incidents` | `incident.report` | `FACILITY` |
| GET | `/api/v1/incidents/queue` | `incident.manage` | `PLATFORM` |
| GET | `/api/v1/incidents/:id` | `incident.manage` | `PLATFORM` |
| POST | `/api/v1/incidents/:id/review` | `incident.manage` | `PLATFORM` |
| POST | `/api/v1/incidents/:id/close` | `incident.manage` | `PLATFORM` |
| POST | `/api/v1/users/:id/reinstate` | `incident.manage` | `PLATFORM` |
| GET | `/api/v1/users/:id/suspensions` | `incident.manage` | `PLATFORM` |

The queue is ordered most serious first, oldest within that: a death reported
this morning outranks a near miss from March.

## Not in this module

- **Attachments.** The `incident_attachments` table and the
  `incident_attachment` storage purpose both exist and nothing writes to them
  yet. The dispute evidence flow is the pattern to copy when it is wanted.
- **Notifying the practitioner named in a report.** A live question rather
  than an oversight: telling somebody they have been named, before anyone has
  looked at it, is not obviously right. It belongs with module 16 and a
  decision from the clinical safety lead (gate item 3.6, still unappointed).
- **Regulatory referral itself.** `REFERRED_TO_REGULATOR` records that the
  decision was taken; making the referral is a person writing to the MDCN.
- **Any automatic suspension.** Nothing suspends on severity alone. A person
  decides, every time.

## Verifying it locally

```
pnpm verify
docker compose exec web pnpm test:integration incidents
```
