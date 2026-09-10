# Module map

One folder per specification module under `src/modules/`, each with the same
internal shape: `domain/`, `application/`, `infrastructure/`, `presentation/`,
`permissions.ts`, `routes.ts`, `tests/`.

| Module folder | Specification module | Stage | Status |
| --- | --- | --- | --- |
| `auth` | 1. Authentication and access control | 4 | Foundations in `src/lib` |
| `practitioners` | 2. Practitioner profiles | 5 | Self-service profile (SELF scope) |
| `credentials` | 3. Credential verification | 5 | Submit + manual review (SELF/PLATFORM) |
| `facilities` | 4. Facility management | 5 | Create, verify, licence (PLATFORM/FACILITY) |
| `availability` | 5. Availability | 6 | Folder only |
| `service-requests` | 6. Service requests | 6 | Folder only |
| `matching` | 7. Matching and assignment | 6 | Folder only |
| `scheduling` | 8. Scheduling | 6 | Folder only |
| `attendance` | 9. Attendance | 7 | Folder only |
| `timesheets` | 10. Timesheets | 7 | Folder only |
| `rates-contracts` | 11. Rates and contracts | 8 | Folder only |
| `billing-settlement` | 12. Billing, ledger and settlement | 8 | Folder only |
| `cancellations-sanctions` | 13. Cancellations, no-shows and sanctions | 7 | Folder only |
| `disputes` | 14. Disputes | 8 | Folder only |
| `clinical-incidents` | 15. Clinical incidents | 5 | Folder only |
| `notifications` | 16. Notifications | 4 | Adapter stub |
| `audit-compliance` | 17. Audit, consent and compliance | 4 | Scoped audit-trail read |
| `suggestions` | 18. Suggestion log | 9 | Folder only |

Rules: a module never reads another module's tables; cross-module reactions go
through domain events in `src/lib/events.ts` and the outbox.
