# Stage 6.3 and 6.4 — matching, and cold start

Implements module 7 and steps 6.3 and 6.4: who could work this shift, in
order, and why.

> **The rules as they stand are in [`matching-rules.md`](matching-rules.md)**,
> generated from the engine and held to it by a test. This page records why the
> engine was built the way it was; where a list below differs from that page
> (this one was written before the level and supervision filters), that page is
> right.

## The engine is pure

`src/modules/matching/domain/engine.ts` takes everything it needs as
arguments and returns everything it decided. Step 6.3 requires results that
are **reproducible and explainable**, and neither survives a function that
queries as it scores.

Two phases, both recorded:

**Hard filters**, each producing a named reason (nine, listed in
[`matching-rules.md`](matching-rules.md)). All of them are reported, not just
the first: an operations officer asking "why did nobody match?" wants the
whole picture.

**Weighted factors**, out of 100 — experience 30, proximity 35, fatigue 20,
reliability 15 — each returning its raw value, its points and a sentence a
person can read.

## Decisions worth knowing

**The weights are in code, not in a config table.** A ranking that changes
because somebody edited a row is one that cannot be explained after the fact.
Changing them is a code change, a review, and a new snapshot.

**Every run is persisted with the weights that produced it.** Without them an
old ranking cannot be read back once the weights change, and "why did they
rank there" becomes unanswerable for exactly the runs anyone would want to
question. `matching.match_runs` and `match_candidates` are step 6.3's
explainability requirement — a ranking nobody can revisit explains nothing.

**Eligibility is called, not restated.** `isEligibleForMatching` is the Stage
5 invariant; expressing it a second time as a `WHERE` clause is precisely the
"under any code path" failure step 5.8 exists to prevent. Every candidate is
evaluated through the same function the property test covers.

**A requested specialty is a requirement, not a preference.** Asking for an
anaesthetist and being sent a generalist is a clinical failure, not a near
miss.

**Experience is capped at ten years.** Beyond that, more experience is not
more suitability for a single shift, and uncapped it would let a forty-year
veteran outrank somebody nearby, rested and available, on a dimension that had
stopped meaning anything.

**Fatigue counts hours already confirmed in the preceding week**, reaching
zero at 48. It is the only factor that reads other assignments.

**Proximity is scored in tiers** — same LGA, same state, elsewhere — because
nothing in the schema holds coordinates. `proximityTier` is one function;
real distances replace it and nothing else. A practitioner who has said
nothing about where they live is treated as far away, not near: a guess in
their favour would put them in front of somebody who actually is nearby.

**Ties break on user id.** Without an explicit tiebreak two equally scored
candidates could order differently between runs, which is exactly what
"reproducible" rules out — and a snapshot test would catch it only
intermittently.

**Cold start (6.4) scores neutral, at the midpoint.** No history is not
evidence of unreliability, and not evidence of reliability either. A newcomer
and a proven-average practitioner rank identically on that factor; a
proven-good one still ranks above both. (When this was written nothing
completed an assignment, so everybody was in cold start; reliability now comes
from decided shifts, as `matching-rules.md` describes.)

**Cross-module reads go through application functions**, never joins:
`getServiceRequest`, `listMatchCandidates`, `availabilityForWindow`. That rule
is why `listMatchCandidates` exists at all.

**Running a match needs `assignment.confirm`**, not `service_request.read`. It
puts names in front of a facility, which is closer to confirming somebody than
to reading a request.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/service-requests/:id/match` | `assignment.confirm` | `FACILITY` |
| GET | `/api/v1/match-runs/:id` | `service_request.read` | `FACILITY` |

## Not in this stage

- **Inviting anyone.** A run ranks and explains; 6.5 is what acts on it.
- **Paging the candidate pool.** Every profile in the requested category is
  evaluated. The pilot is fifty practitioners; this needs paging well before
  it is thousands, and `listMatchCandidates` says so.
- **Automatic matching.** Step 9.4 requires every match to be hand-reviewed
  for the first fifty engagements, so a facility runs this deliberately rather
  than the platform running it on publish.
- **Real distances**, as above.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

The unit suite covers each factor on its own, both directions of every hard
filter, the cold-start threshold, and a snapshot proving that differently
ordered inputs give an identical result. The integration suite proves the
wiring: real eligibility, real availability, real proximity, and a run read
back afterwards with its weights.

```
curl -X POST http://localhost:3000/api/v1/service-requests/<id>/match \
  -H 'content-type: application/json' -b scheduler_cookies.txt \
  -d '{"facilityId":"<id>"}'
```
