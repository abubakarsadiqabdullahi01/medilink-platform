# Module map

One folder per specification module under `src/modules/`, each with the same
internal shape: `domain/`, `application/`, `infrastructure/`, `presentation/`,
`permissions.ts`, `routes.ts`, `tests/`.

| Module folder | Specification module | Stage | Status |
| --- | --- | --- | --- |
| `auth` | 1. Authentication and access control | 4 | Foundations in `src/lib` |
| `practitioners` | 2. Practitioner profiles | 5 | Profile, identity/registration, screening, eligibility |
| `credentials` | 3. Credential verification | 5 | Submit + manual review (SELF/PLATFORM) |
| `facilities` | 4. Facility management | 5 | Create, verify, licence (PLATFORM/FACILITY) |
| `availability` | 5. Availability | 6 | Slots, blocks, matcher boundary (SELF) |
| `service-requests` | 6. Service requests | 6 | Draft, publish, cancel (FACILITY) |
| `matching` | 7. Matching and assignment | 6 | Ranking, invitations, assignments, conflict |
| `scheduling` | 8. Scheduling | 6 | Schedule list lives in `matching` — see below |
| `attendance` | 9. Attendance | 7 | State machine, tokens, manual fallback |
| `timesheets` | 10. Timesheets | 7 | Hours, submission, approval, revisions |
| `rates-contracts` | 11. Rates and contracts | 8 | Folder only |
| `billing-settlement` | 12. Billing, ledger and settlement | 8 | Folder only |
| `cancellations-sanctions` | 13. Cancellations, no-shows and sanctions | 7 | Folder only |
| `disputes` | 14. Disputes | 8 | Folder only |
| `clinical-incidents` | 15. Clinical incidents | 5 | Folder only |
| `notifications` | 16. Notifications | 4 | SMS adapter + recorded messages |
| `audit-compliance` | 17. Audit, consent and compliance | 4 | Scoped audit-trail read |
| `suggestions` | 18. Suggestion log | 9 | Folder only |

Step 6.7's schedule list and its conflict detection were built in `matching`
rather than in `scheduling`: an assignment and the schedule it appears on are
the same aggregate, and splitting them would have meant one module reading
the other's tables to answer "is this practitioner free?". The `scheduling`
folder stays for whatever module 8 turns out to need beyond that — shift
patterns and rota templates — which nothing has asked for yet.

Rules: a module never reads another module's tables; cross-module reactions go
through domain events in `src/lib/events.ts` and the outbox.
