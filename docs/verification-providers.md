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
