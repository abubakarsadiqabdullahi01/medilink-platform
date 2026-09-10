# Stage 5.8 and 5.9 — eligibility, expiry, and activation

Implements step 5.8 (every reason a practitioner is not yet eligible to be
matched, computed at once) and step 5.9 (a verified credential or an active
registration whose expiry has passed stops counting) — plus the piece
neither step named outright: something has to act on 5.8's answer, or it is
just a read nobody's account ever changes because of.

## Why this waited

`UserStatus.ACTIVE` existed since Stage 4 and nothing ever set it. The
natural trigger — "every mandatory credential for this practitioner's
category is verified" — could not be built correctly before now:
`CredentialType.isMandatory` was a single global flag on a doctor-shaped
list, under which a nurse or a pharmacist would have appeared to need an
MDCN practising licence and an MBBS certificate. Building eligibility on
that would have been actively wrong, not merely incomplete.

`CredentialRequirement` (config schema) replaces it: a category ↔
credential-type pair, with its own `isMandatory`. Seeded, partial by design
like the state and LGA lists — only the doctor category is populated for
now, with the three types that used to carry the old global flag. Nurse,
pharmacist, lab scientist and radiographer have no seeded requirements yet;
each needs its own regulator-specific credential types added first, which
is compliance's list to complete.

## Model

Nothing new for 5.8 itself beyond `CredentialRequirement` — the rule reads
five existing things: `User.status`, `PractitionerProfile` (exists or not),
`IdentityVerification.nameMatch`, the `ProfessionalRegistration` matching
the practitioner's category's own `regulator` column, `CredentialSubmission`
rows against `CredentialRequirement`, and `ScreeningResult.status`.

5.9 adds one status value: `CredentialSubmissionStatus.EXPIRED` — a
`VERIFIED` row whose `expiresAt` has passed. Not `REJECTED`: nobody judged
it wanting, and the practitioner renews rather than re-argues it.
`RegistrationStatus.EXPIRED` already existed; 5.9 is what the sweep now sets
it to instead of just being a value nothing wrote.

## The rule itself

`src/modules/practitioners/domain/eligibility.ts` — pure, no database,
taking every fact as an explicit input. `eligibilityBlockers` returns every
reason at once, not just the first: a practitioner (or a compliance officer
looking at their file) should see the whole outstanding list, not fix one
thing and resubmit to discover the next. `isEligibleForMatching` is
`blockers.length === 0`.

**`UNDER_REVIEW` is deliberately not a blocker.** It is the state a
practitioner sits in *until* they become eligible — this rule is what
promotes them out of it, so treating it as a blocker would make promotion
impossible.

**Proven by a 5000-profile property test, not just the cases someone wrote
down.** `eligibility.test.ts` generates random combinations of every input
with a deterministic PRNG (a seed, reproducible on failure) and asserts:
whatever combination comes out eligible, identity was verified and matched,
registration was active, screening was clear, the profile existed, and
every required credential was verified and not expired. The invariant is
README rule 5 — no practitioner is matched to work before identity and
licence verification pass — and it has to hold for every combination, not
the ones a hand-written test thought to check.

## Activation

`src/modules/practitioners/application/eligibility.ts`. Nothing pushes
eligibility to a status change synchronously — a credential being verified
does not itself activate the account. A nightly sweep,
`activateEligiblePractitioners`, re-checks every `UNDER_REVIEW` practitioner
instead, the same shape as the screening sweep: querying every
`UNDER_REVIEW` user rather than joining on `practitioner_profiles` keeps "no
profile yet" a "not eligible yet" outcome the rule already reports, not a
case the sweep has to know to skip.

Conditional on the status just read (`updateMany` where `status =
'UNDER_REVIEW'`), so a concurrent pass cannot activate the same account
twice — proven by running the sweep twice in a row and asserting exactly
one `practitioner.activated` audit row.

`GET /api/v1/practitioners/eligibility` (SELF for a practitioner's own
account, PLATFORM for compliance, the same caller-states-the-scope pattern
as `/verification` and the credential queue) is read-only. It answers "why
am I still stuck", nothing more — activation itself only ever happens on
the sweep.

## Expiry

`src/modules/credentials/application/expiry.ts` and
`src/modules/practitioners/application/expiry.ts` — `expireCredentials` and
`expireRegistrations`. Each is conditional on the status just read
(`updateMany` where the row is still `VERIFIED` / `ACTIVE`), so a reviewer
acting on the same row at the same moment cannot be overwritten by the
sweep, and each writes its own audit row and, for credentials,
`EVENTS.CredentialExpired` — already declared in the event vocabulary since
Stage 4, unpublished until now.

**Neither sweep suspends the account.** The plan's wording is "an expired
licence suspends an account", but `UserStatus.SUSPENDED` is refused by
`currentSession`, so a practitioner could not log in to upload the renewal
that fixes it. The actual safety requirement — cannot be matched — is
already satisfied the moment the expiry passes: `isRegistrationUsable`
refuses a lapsed licence regardless of what `registrationStatus` still
says, and the eligibility rule reads that live, not the sweep's output.
What the sweep changes is the *stored* state, which is what a compliance
officer reads and what a "who needs to renew" report would be built from.
Suspension stays a compliance officer's and a clinical incident's decision.

## Scheduling

Three new entries in `src/worker/jobs.ts`'s `JOB_DEFINITIONS`:
`credential.expiry_sweep`, `registration.expiry_sweep`,
`practitioner.activation_sweep` — daily, alongside the existing
`screening.sweep`. All four run through the scheduler
(`src/worker/scheduler.ts`) added for step 5.6, itself borrowing the
outbox's own `SKIP LOCKED` claiming so two workers never run a sweep twice.
`tests/integration/scheduler.test.ts`'s "the job registry" test already
asserts every definition has a handler and vice versa, generically, for all
four — not re-tested per job here.

Order between the four in one pass is not relied on. If activation runs
before that day's expiry sweep for the same practitioner, the practitioner
is judged against credentials that have not expired *yet* — correct as of
that moment — and the next day's sweep, or Stage 6 matching reading the
rule live, catches anything that changes after.

## Not in this stage

- **Demoting an already-`ACTIVE` account when a credential later expires.**
  The eligibility rule is meant to be read live at the point that matters
  (Stage 6 matching, not built yet), not only at the moment of promotion —
  so an `ACTIVE` practitioner whose credential lapses is correctly refused a
  match without the stored `UserStatus` needing to change. Building an
  automatic demotion now would be reacting to a consumer that does not
  exist yet.
- **Credential requirements for any category but doctor.** Named above, not
  silently absent — compliance's list to complete, one category and one
  regulator-specific credential type at a time.
- **A config-management endpoint for editing `CredentialRequirement`.**
  Same position as 5.6's sanctioned list: `config.manage` exists and
  nothing uses it yet.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

`tests/integration/eligibility.test.ts` builds a fully eligible practitioner
(profile, matched identity, active registration, every required credential
verified, clear screening), asserts zero blockers, runs the sweep and
asserts promotion to `ACTIVE` with exactly one audit row even across two
passes, and drives the `GET /eligibility` endpoint at both scopes.
`tests/integration/expiry.test.ts` covers both sweeps directly, including
that a `REJECTED` or `SUSPENDED` row is left alone regardless of its
`expiresAt`.
