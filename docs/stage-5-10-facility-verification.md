# Stage 5.10 — facility management and verification

Implements module 4 of the specification and step 5.10 of the plan: a facility
record, its licence document, and the review that decides whether it may
publish work.

## Model

One row per facility (`facilities.facilities`), naming a `FacilityType`, a
CAC registration number, a state and optional LGA, an address, contact
details, and a **representative** — the registered user who acts for the
organisation. Status is `PENDING`, `VERIFIED`, `REJECTED` or `SUSPENDED`.

Branches and departments are not built. `BRANCH` and `DEPARTMENT` remain
unused `ScopeType` values, and the guard's `ancestors` mechanism already
supports the hierarchy when it lands.

## Who creates a facility

**Medilink operations, at `PLATFORM` scope.** A facility is an organisation,
not a person, and verification exists precisely to stop anyone declaring
themselves a hospital. Operations creates the record and names the
representative; there is no self-service facility signup.

The representative is granted `facility_owner` over the new facility **in the
same transaction as the insert**. This differs from
`grantPractitionerRoleOnRegistration`, which reacts to an event: that one had
to, because registration's transaction had no facility id to scope a grant
to. Here the id exists in the same transaction, and a facility whose
representative cannot reach it is not worth half-creating.

## Decisions worth knowing

**`operations_officer` gained `facility.write`.** Without it, no seeded role
could create a facility at `PLATFORM` except `super_administrator`, which is
not a role anyone should be doing daily onboarding under. The module was
unusable by its intended actor until this changed.

**The CAC number is normalised in the schema, not the service.** `rc 123456`
and `RC123456` are the same registration, so `normaliseCacNumber` runs at the
boundary and the value that reaches the unique constraint is the one every
caller sees echoed back. The duplicate is then refused **by the constraint**,
not by a prior read — which is what step 5.4 asks for, and what makes two
concurrent creations safe.

**`canPublish` is a pure function, not a column.** Stage 6 will call it on the
way into publishing; keeping it in `domain/facility.ts` means Stage 6 consumes
a decision rather than re-deriving one, and the rule is testable now, before
anything can publish at all. It returns *every* blocker, not the first: an
administrator fixing one problem should not have to resubmit to discover the
next.

**A lapsed licence blocks publishing with no scheduler involved.**
`licence_expired` is evaluated when the record is read. Step 5.9's *automatic
suspension* still needs a scheduled-job mechanism, which does not exist
anywhere in this codebase; this is the half that does not.

**Changing the licence of a verified facility sends it back for review.**
Otherwise verification would mean only that *some* licence was approved once,
and a facility could swap the document afterwards and keep publishing on the
strength of a review nobody did. Name, address and contact changes are not
evidence, so they do not reset it.

**A representative cannot verify their own facility**, mirroring
`cannotReviewOwnSubmission` in credentials. Nothing else stops a user holding
both `facility_owner` and `compliance_officer` from signing off their own
organisation.

**The licence object is keyed by facility, not by uploader.** It belongs to
the organisation and outlives whoever happened to upload it. The reference
check refuses a document minted for facility A being attached to facility B.

**A facility with no grant gets 403, never 404.** The scope check runs before
any database read, so a nonexistent id and an unauthorised one are
indistinguishable — `guarded-handler.ts`'s own reasoning, that a
distinguishable 403 and 404 is a directory.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/facilities` | `facility.write` | `PLATFORM` |
| GET | `/api/v1/facilities` | `facility.read` | `PLATFORM` or `FACILITY` |
| GET | `/api/v1/facilities/:id` | `facility.read` | `FACILITY` |
| PATCH | `/api/v1/facilities/:id` | `facility.write` | `FACILITY` |
| POST | `/api/v1/facilities/:id/licence-upload-url` | `facility.write` | `FACILITY` |
| POST | `/api/v1/facilities/:id/licence-url` | `facility.read` | `FACILITY` |
| POST | `/api/v1/facilities/:id/verify` | `facility.verify` | `PLATFORM` |

A `PLATFORM` grant satisfies the `FACILITY`-scoped checks too, through
`isAuthorized`'s existing rule, which is why operations and compliance reach
any facility without a second set of routes.

## Not in this stage

- **The gate's literal test.** Step 5.10 asks for *"publish as an unverified
  facility, assert refusal"*. There is no publishing until Stage 6, so that
  test cannot exist yet. `canPublish` is unit-tested and exported for Stage 6
  to call — the gate condition is not closed until Stage 6 calls it.
- **Staff management.** `facility.user.manage` exists as a permission and no
  route uses it. Adding schedulers and finance officers to a facility is its
  own piece; the representative holds `facility_owner`, which already carries
  `service_request.publish`, so Stage 6 is unblocked without it.
- **Self-service facility signup.** It needs an account type at registration,
  which does not exist — see the wrinkle below.
- **CAC registry lookup and representative NIN verification.** No provider
  credentials, the same reasoning that deferred Stage 4.7's SMS gateway and
  NIMC verification in 5.2. The CAC number and the representative are stored
  and reviewed by a person. No Docker-mocked provider API either: it would
  prove the plumbing pattern works, which the SMS adapter already does, and
  nothing about the real contract.
- **`SUSPENDED` is reachable by no code path.** It exists because `canPublish`
  must decide on it, and because step 5.9 and module 15 both suspend a
  facility rather than delete it. It is unit-tested regardless.
- **Branches and departments**, as above.
- **Re-review after rejection.** A `REJECTED` facility is terminal today;
  there is no route back to `PENDING` except by changing the licence.

## A pre-existing wrinkle, not fixed here

Every registrant is unconditionally granted the `practitioner` role at `SELF`
by the `PractitionerRegistered` worker handler. A user who exists only to
represent a facility gets it too. It is harmless — the role reaches nothing
but their own empty practitioner profile — but it is the same missing
account-type concept that defers self-service signup, and it belongs in the
auth flow rather than in this module.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

`tests/integration/facility-verification.test.ts` asserts the 403 matrix per
route, that facility A never reaches facility B on **any** of them, the
duplicate CAC constraint, the verification flow, and that the rows returned to
a facility-scoped reader contain only that facility. That last one matters
more than the status codes: a 403 proves the check ran; the rows prove the
filter matches what was authorised.

Onboard through the Stage 4.2 endpoints, then, as operations:

```
curl -X POST http://localhost:3000/api/v1/facilities \
  -H 'content-type: application/json' -b ops_cookies.txt \
  -d '{"name":"Owerri General Hospital","facilityTypeId":"<config.facility_types id>",
       "cacNumber":"RC123456","stateId":"<config.states id>",
       "addressLine":"14 Wetheral Road, Owerri","contactPhone":"08031234567",
       "representativeUserId":"<a registered user id>"}'

curl -X POST http://localhost:3000/api/v1/facilities/<id>/verify \
  -H 'content-type: application/json' -b officer_cookies.txt \
  -d '{"decision":"approve"}'
```

Note that attaching a licence needs the bytes actually uploaded to the signed
URL first — `confirmLicenceReference` calls `headObject`, so a key whose
object does not exist is refused.
