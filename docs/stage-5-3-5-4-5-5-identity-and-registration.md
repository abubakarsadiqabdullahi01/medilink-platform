# Stage 5.3, 5.4 and 5.5 — identity, uniqueness and professional registration

Three plan steps in one cut, because they are one record split in two tables:
who this practitioner is, and what their regulator says about them.

All of it runs with **NIN and MDCN verification switched off**, which is the
default and the only mode this project can run in until the subscriptions are
bought — see `docs/verification-providers.md`. The manual path is the product,
not a stand-in for tests.

## Model

`practitioners.identity_verifications` — one row per practitioner:
`ninHash` (**unique**), `ninLast4`, `nameMatch`, `method`, `verifiedBy`,
`verifiedAt`, `evidenceRetrievedAt`.

`practitioners.professional_registrations` — one row per practitioner per
regulator: `folioNumber` (**unique**), `practiceType`, `registrationStatus`,
`location`, `evidenceRetrievedAt`, `expiresAt`, `source`.

## Decisions worth knowing

**The NIN is never stored.** The column holds an HMAC keyed with
`SESSION_SECRET` — the same decision, for the same reason, as one-time codes
in `docs/stage-4-2-auth.md`. An eleven-digit number under an unkeyed hash is
reversible by exhaustive search in seconds, and a leaked table would then be a
list of real people's NINs. `ninLast4` is what a reviewer quotes back.

There is deliberately **no column named `nin`**, and a test queries
`information_schema` to keep it that way — step 5.3's "automated scan asserts
no raw NIN column".

**The audit row carries the last four and the outcome, not the number.** The
audit trail is append-only and read by more people than the record itself: a
NIN written there could never be taken back out. A test asserts the number
never appears in an audit row.

**Uniqueness is enforced by the database, not by a prior read** — step 5.4's
requirement, in its own words: "assert the second fails on the constraint, not
in code". Two concurrent attempts to register the same identity cannot both
win. Folio numbers are normalised before storage so `mdcn/r/ 12345` and
`MDCN/R/12345` collide as they should.

**`nameMatch` and `registrationStatus` have no defaults.** When an officer is
recording the evidence, assuming the name matched would let a mismatched
identity through silently, and assuming `ACTIVE` would be assuming the answer
to the only question the record exists to ask. Both are refused with a 422.

**A name mismatch is recorded, not refused.** It is a finding for the
eligibility rule to act on; the officer still has to record what they saw.

**`UNKNOWN` is not good news.** It means the regulator was unreachable or said
something unreadable. `isRegistrationUsable` refuses it, because defaulting
that to "fine" is exactly the failure verification exists to prevent.

**The retrieval date is the substance of step 5.5.** A licence checked two
years ago is not evidence that someone may work a shift tomorrow.
`isEvidenceStale(retrievedAt, reviewDays, now)` is the pure function that says
so, inclusive at the boundary — exactly a year old on a one-year period has
expired, not "about to".

**Recording is PLATFORM-only.** A practitioner verifying their own identity is
what this step exists to prevent. Reading is available at `SELF` for their own
record and `PLATFORM` for compliance, the same "caller states the scope"
pattern as the audit trail and the credential queue.

**One registration per regulator, updated in place.** A doctor holds one MDCN
folio, not a history of rows for a reviewer to reconcile; the audit trail
carries the history.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| GET | `/api/v1/practitioners/verification` | `practitioner.profile.read` | `SELF` or `PLATFORM` |
| POST | `/api/v1/practitioners/verification/identity` | `credential.review` | `PLATFORM` |
| POST | `/api/v1/practitioners/verification/registration` | `credential.review` | `PLATFORM` |

`credential.review` rather than a new permission: recording an identity or a
licence status **is** credential review, done by the same officer, and
inventing a second permission would split one job across two.

## Not in this stage

- **The NIMC and MDCN adapters themselves.** Both throw until a subscription
  exists; `docs/verification-providers.md` covers how to turn one on.
- **Acting on stale evidence.** `isEvidenceStale` exists and is unit-tested,
  and the eligibility rule in 5.8 is what consumes it.
- **A practitioner supplying their own NIN for an officer to check.** Today
  the officer types it from the slip. A self-service capture step that hands
  the number straight to a provider without an officer seeing it would be
  better once a provider exists.
- **Regulators other than by name.** `regulator` is a free string matching
  `ProfessionalCategory.regulator`; nothing constrains it to the five seeded
  values yet.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

As a compliance officer:

```
curl -X POST http://localhost:3000/api/v1/practitioners/verification/identity \
  -H 'content-type: application/json' -b officer_cookies.txt \
  -d '{"userId":"<practitioner id>","nin":"12345678901","nameMatch":true}'

curl -X POST http://localhost:3000/api/v1/practitioners/verification/registration \
  -H 'content-type: application/json' -b officer_cookies.txt \
  -d '{"userId":"<practitioner id>","regulator":"MDCN","folioNumber":"MDCN/R/12345",
       "registrationStatus":"ACTIVE","practiceType":"Full","location":"Owerri, Imo"}'
```
