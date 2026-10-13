# Evidence: module-by-module fact sheets

Six independent readers each took a slice of the repository at commit `5c199c1`, wrote down how it works
(with `file:line` citations), re-checked the claims of `docs/redesign-recommendations-2026-10-13.md` against
the code, and compared the code with System Documentation v2.9. The chapters in
`../Medilink-Module-Reference-v3.md` were written from these and **supersede them where they differ**.

| Sheet | Slice |
| --- | --- |
| `study-1-identity-platform.md` | Auth, audit and consent, notifications, reference data, platform and operations |
| `study-2-supply-trust.md` | Practitioners, credentials, verification, incidents (suspension side) |
| `study-3-demand-matching.md` | Facilities, availability, service requests, matching, scheduling |
| `study-4-delivery-trust.md` | Attendance, timesheets, sanctions, disputes, incidents, suggestions |
| `study-5-money.md` | Rates, billing, ledger, payouts, gateway |
| `study-6-product-ux.md` | The three consoles, public site, accessibility, tests, CI, documentation |

## Corrections made after the sheets were written (the chapters carry the corrected values)

- `study-2`: eligibility blocker lines are `eligibility.ts:90-91` (`credential_expired`) and `:93-94` (`credential_missing`);
  `reviewCredentialSchema` is `presentation/schemas.ts:76-87`, `submitCredentialSchema` `:18-28`; the years input is
  `profile-form.tsx:169-176`; the claim tally is 12 confirmed and 3 partly, not 11 and 4.
- `study-4`: `UserStatus.SUSPENDED` is `schema.prisma:68`; `FacilityStatus.SUSPENDED` is `:623`; the suggestion schema
  lines are `presentation/schemas.ts:20-29` and `:40-44`.
- `study-6`: the activation sweep runs daily, not hourly (`src/worker/jobs.ts:51-56`); declining an offer needs a reason on
  the server as well as in the page (`matching/presentation/schemas.ts:42-45`); four migrations follow the baseline.
- `study-1`: the audited-table count is 46, not 43.
