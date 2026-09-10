# Stage 6.1 — service requests

Implements module 6 of the specification and step 6.1: a facility's stated
need — who, when, at what rate, and on what cancellation terms.

## Model

`service_requests.service_requests`, moving `DRAFT → PUBLISHED → FILLED`,
with `CANCELLED` reachable from all three and `EXPIRED` from `PUBLISHED`.

A request carries a **headcount**: facilities staff wards in threes, and the
pilot's fill-rate metric should count shifts rather than requests. It stays
open until that many assignments are confirmed against it.

## Two things this closes

**Step 6.1's own verification** — "publish at one kobo below the floor, assert
refusal" — is `checkAgainstFloor`, and the test says exactly that.

**Stage 5.10's gate condition** — "a facility must be verified before it can
publish". `canPublish` has existed since 5.10 with nothing calling it, and
5.10's own doc said the test could not be written until something published.
This is that call, and that test.

## Decisions worth knowing

**Creating and publishing are separate steps.** Publishing is what puts work
in front of practitioners, and it is the point at which the facility's own
verification and the current rate floor are checked. A draft that turns out to
be unpublishable is a better failure than a published request nobody vetted.

**The rate floor is checked twice** — at creation, so a facility learns the
rate is illegal while writing rather than at the last step, and again at
publish, because a floor can move in between and the published rate is the one
that counts.

**The error names the floor.** A facility told only "too low" has to guess,
and will guess low again.

**A specialty floor beats the category-wide `*`.** Anaesthesia having its own
floor is why that column exists, and falling back to the category rate would
quietly underpay it. Among equally specific floors, the latest
`effectiveFrom` at or before **the shift** wins — a floor that rises next
month does not govern a shift being priced for next week.

**At the floor is fine; below it is not.** A floor is a minimum, and refusing
an offer that meets it exactly would make the published number a lie.

**`facilityId` is required on every route, including the `:id` ones.** It
carries the authorisation scope, which the guard checks before any database
read. Naming a facility you do hold permission for, with an id belonging to
another, yields a 404 from the lookup rather than a way in.

**Cancelling uses `service_request.publish`, not `assignment.cancel`.**
Whoever may put work in front of practitioners is who may withdraw it;
`assignment.cancel` is about a confirmed person, not an open request. A reason
is required, because practitioners have already seen the request.

**Nothing revives a closed request.** A facility that changes its mind
publishes a new one — practitioners have already been told this one is closed.
A `FILLED` request can still be cancelled, though: a ward closing does not
care that it found its nurses.

**The facility is reached through `getFacility`, not by querying its table.**
Modules talk through each other's application layer; the rule that a module
never reads another's tables is what keeps that true.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/service-requests` | `service_request.publish` | `FACILITY` |
| GET | `/api/v1/service-requests` | `service_request.read` | `FACILITY` or `PLATFORM` |
| GET | `/api/v1/service-requests/:id` | `service_request.read` | `FACILITY` |
| POST | `/api/v1/service-requests/:id/publish` | `service_request.publish` | `FACILITY` |
| POST | `/api/v1/service-requests/:id/cancel` | `service_request.publish` | `FACILITY` |

## Not in this stage

- **Matching.** Publishing emits `service_request.published`; nothing consumes
  it until 6.3.
- **`FILLED` and `EXPIRED`.** Both are reachable in the transition table and
  nothing reaches them yet — filling needs assignments (6.5) and expiry needs
  the sweep that lands with them.
- **Editing a published request.** A facility that needs different terms
  cancels and republishes, so a practitioner who accepted never finds the
  terms changed underneath them.
- **Recurring requests.** Every Saturday night is six separate requests today.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

```
curl -X POST http://localhost:3000/api/v1/service-requests \
  -H 'content-type: application/json' -b scheduler_cookies.txt \
  -d '{"facilityId":"<id>","professionalCategoryId":"<doctor id>","shiftType":"NIGHT",
       "startsAt":"2026-10-01T19:00:00Z","endsAt":"2026-10-02T07:00:00Z",
       "headcount":2,"hourlyRateKobo":650000,
       "cancellationTerms":"Either party may cancel up to 24 hours before."}'

curl -X POST http://localhost:3000/api/v1/service-requests/<id>/publish \
  -H 'content-type: application/json' -b scheduler_cookies.txt \
  -d '{"facilityId":"<id>"}'
```
