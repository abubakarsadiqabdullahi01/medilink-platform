# Identity and registration verification providers

Covers the provider half of steps 5.3 (NIN through NIMC) and 5.5 (MDCN status
check). Both are **switched off by default**, including in tests.

## Why off

Both need a paid provider subscription this project does not have. The choice
was to block those steps until one is bought, or to build everything around
them and leave the provider call as a switch. This is the second.

With both off, the evidence is recorded by a compliance officer instead — the
manual review path that already exists and works. Buying a subscription later
changes **who supplies the evidence**, not the endpoints, the schema, the
permissions or anything a caller sees.

## How the evidence gets in while both are off

"An officer records it by hand" used to mean: go and check the NIN or the
licence somewhere else, then type the number and the answer into a form. The
product never held the evidence, so the officer had to leave it, and the same
number was entered twice — once by the practitioner, once by the officer.

Now the practitioner sends the number **with a photograph of the slip or the
licence** (the form asks for it exactly while the provider is off, and stops
asking when one is switched on). The officer reads the photograph beside the
number on the practitioner's page and confirms what they see:

- `POST /api/v1/practitioners/verification/confirm` records the identity or the
  registration **from the submission** and decides the submission in the same
  act. The number is read on the server and never re-entered, so it cannot
  differ from what was sent. The officer supplies only their reading — whether
  the name matches, what the licence shows.
- **The officer still decides.** Nothing approves on its own. A name mismatch is
  recorded as a fact and the practitioner is asked to correct it; a licence that
  is not active is recorded as it is and the submission rejected with the reason.
- **The NIN is kept out of the audit trail and is masked after use.** The
  credential audit rows carry only the last four digits, and once an identity
  is recorded the stored number is reduced to its tail, matching what the
  identity record itself keeps.
- **Viewing the photograph is a deliberate act.** It loads when the officer asks,
  so the access event (`credential.document_accessed`) records who chose to look.
- **The plain "Verify" no longer applies to these two.** `POST
  /credentials/:id/review` refuses to approve a number-checked credential
  (`confirm_through_practitioner`), because a bare approval would leave the
  practitioner blocked on an identity nobody recorded. Rejecting and asking for
  more still go through it.
- The by-hand forms remain, under "Record by hand", for somebody who has
  submitted nothing to confirm (verified in person or by telephone).

Switching a provider on later changes who answers the officer's two questions,
not this flow: `recordIdentityVerification` and `recordProfessionalRegistration`
already branch on `enabled`, so the confirm endpoint asks the provider instead of
the officer and the form stops asking for a photograph.

## The switches

| Variable | Values | Default |
| --- | --- | --- |
| `NIN_VERIFICATION_PROVIDER` | `none`, `sandbox`, `live` | `none` |
| `NIN_VERIFICATION_API_KEY` | — | unset |
| `MDCN_VERIFICATION_PROVIDER` | `none`, `sandbox`, `live` | `none` |
| `MDCN_VERIFICATION_API_KEY` | — | unset |

`src/lib/verification/index.ts` mirrors `src/lib/sms/index.ts`, which is the
established shape here for a provider nobody has bought: a switch in the
environment rather than in code, and real adapters that throw until they are
written.

## Decisions worth knowing

**Application code asks `isAutomatedIdentityVerificationEnabled()`, never the
environment.** What happens when a provider is off is then one decision in one
place, rather than a condition repeated at every call site and eventually got
wrong at one of them.

**A disabled adapter throws if a caller asks anyway.** It would have been
easier to return "not verified" and let the caller carry on. But a
verification step that answers without asking anybody is worse than one that
is plainly switched off, because it looks like it worked — and this is the
step the whole platform's safety rests on.

**Selecting a provider without an API key fails at the first call, with a
message about the key.** That is a deploy-time mistake and should read like
one, rather than surfacing as a mysterious provider error in front of the
first practitioner who tries to register.

**`sandbox` and `live` both throw today.** There is no subscription to write
an adapter against, and a Docker-hosted mock of NIMC's or MDCN's API would
prove only that the plumbing pattern works — which `src/lib/sms/index.ts`
already proves — and nothing at all about the real contract, which is the part
that needs credentials to verify.

## Turning one on later

1. Buy the subscription and set the provider and API key in the environment.
2. Write the adapter's `check()` against the real contract, replacing the
   `unimplemented` branch in `select()`.
3. Nothing else changes: `recordIdentityVerification` and
   `recordProfessionalRegistration` already branch on `enabled`, and the
   manual path stays as the fallback when the provider is unreachable.

To switch one back off, set it to `none`. Manual entry resumes immediately.
