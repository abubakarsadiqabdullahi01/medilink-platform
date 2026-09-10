# Stage 6.2 — availability

Implements module 5 of the specification and step 6.2: the windows a
practitioner offers, and the periods they are away.

## Model

One table, `availability.availability_slots`, holding two shapes
distinguished by `kind`:

- `RECURRING_WEEKLY` — day of week, start and end minute, and an optional
  effective window.
- `ONE_OFF` — a concrete start and end.

One table rather than two, because both answer the same question — "is this
practitioner free for this window?" — and a matcher that had to union two
would eventually drift between them.

`availability.blocked_periods` holds leave, training, a shift worked
elsewhere. **A block always beats a slot.** Saying "I work Mondays" and "I am
away this Monday" is not a contradiction: the second is the more specific
statement.

`PractitionerProfile` gains `homeLgaId` and `travelPreference`
(`SAME_LGA | SAME_STATE | ANYWHERE`), which the proximity factor in 6.3 reads.

## Decisions worth knowing

**Recurring times are minutes since midnight in WAT (UTC+1, no DST).** That
is how a practitioner states them — "I work eight till six" — and Nigeria has
no daylight saving, so a fixed offset is honest and a timezone library would
be ceremony. The conversion lives in exactly one place,
`domain/availability.ts`, and the test that pins it asserts an 08:00–18:00
local slot lands at 07:00–17:00 UTC. Storing local minutes and comparing them
in UTC is the bug that shape exists to avoid.

**An end at or before the start means the slot wraps past midnight.** Night
shifts are the point of this platform, and 20:00–06:00 is how somebody writes
one. Expansion therefore starts a day early, because Monday's slot covers
Tuesday's small hours.

**Availability must cover the *whole* shift.** Half a night shift is not a
night shift, so partial cover is a no.

**Merging joins windows that merely touch.** Two adjacent slots, 08:00–14:00
and 14:00–20:00, cover a 09:00–18:00 shift between them; a merge that only
joined overlapping windows would say they do not.

**A block and an unoffered day are reported differently** — `blocked` versus
`not_offered`. "I am away that week" and "I do not work Tuesdays" are
different answers, and operations chasing an unfilled shift benefits from
knowing which.

**Writing is `SELF`-only, always.** Availability is a statement a practitioner
makes about themselves; nobody else should be able to say they are free.
Reading is also open at `PLATFORM`, for operations working an unfilled shift.
A test asserts no write route ever gains a wider scope.

**Withdrawal is a soft delete**, so a match run that considered a slot can
still be explained after the practitioner removes it.

**Blocks require a reason.** "Why was this practitioner unavailable" is a
question disputes ask, and a block with no reason is one nobody can evaluate
months later.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| GET | `/api/v1/availability` | `availability.read` | `SELF` or `PLATFORM` |
| POST | `/api/v1/availability/slots` | `availability.write` | `SELF` |
| DELETE | `/api/v1/availability/slots/:id` | `availability.write` | `SELF` |
| POST | `/api/v1/availability/blocks` | `availability.write` | `SELF` |
| DELETE | `/api/v1/availability/blocks/:id` | `availability.write` | `SELF` |

`availability.read` and `availability.write` are new permissions —
availability is its own specification module, and folding it into
`practitioner.profile.*` would have meant a facility scheduler who needs to
read a calendar also gaining the right to rewrite a profile.

## Not in this stage

- **Travel radius in kilometres.** `travelPreference` is in the same tiers
  proximity is scored in, because nothing in the schema holds coordinates.
- **Matching.** Step 6.2's stated verification — "a blocked period removes
  the practitioner from candidates" — is asserted here at the boundary the
  matcher calls (`availabilityForWindow`), and again through the matcher
  itself in 6.3.
- **Overlap detection between a practitioner's own slots.** Two overlapping
  slots merge harmlessly, so there is nothing to refuse.
- **Availability derived from confirmed assignments.** A practitioner already
  working a shift is excluded by the matcher's conflict check, not by their
  calendar.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

```
curl -X POST http://localhost:3000/api/v1/availability/slots \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"kind":"RECURRING_WEEKLY","dayOfWeek":1,"startMinute":480,"endMinute":1080}'
```
