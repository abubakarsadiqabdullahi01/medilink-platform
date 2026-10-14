# Stage 4.3 and 4.4 — permission and scope on a real endpoint

Implements gate items 4.3 (permissions, not roles) and 4.4 (tenant isolation:
permission plus scope on every access), and the gate condition "authorisation
is enforced by permission and scope together, with tests proving both".

## What was actually missing

`src/lib/authz/guard.ts` has existed since 4.1, with unit tests proving
`isAuthorized` decides correctly. What those tests could not prove is that any
endpoint asks it — and until this change, none did. `requirePermission` had
zero call sites and every module's `ROUTES` table was empty.

A guard nothing calls passes every test it has. Step 4.3's completion
criterion is a *request* that asserts 403, which needs a route to make the
request to.

## The route guard

`src/lib/http/guarded-handler.ts` is the shape every authenticated endpoint
takes from here. It resolves the session, validates the input, then checks the
permission and the scope before the action runs.

The signature is the enforcement. An endpoint cannot obtain the session
without naming a permission and returning the scope of the record it is about
to touch:

```ts
scope: (input, session) => RequestedScope
```

Deriving the scope from the request is the point. "Does this user hold
audit.read" is not a question that can be answered safely; "does this user hold
audit.read over facility X" is. A handler that cannot say which scope it is
touching cannot be authorised, and the type makes skipping it impossible
rather than merely discouraged.

401 is returned before 403: an anonymous caller is told to sign in, not that
they lack a permission they could never hold.

## The first guarded endpoint

`GET /api/v1/audit` returns the audit trail within one scope, requiring
`audit.read` and a grant that covers the scope asked for.

The scope is a required query parameter rather than an inferred default. A
missing scope could reasonably mean "everything I am allowed to see", and that
reading is how a facility administrator ends up with a page of another
facility's records because one branch of the query builder forgot a filter.
Requiring it means the authorisation check and the database filter are derived
from the same value.

| Grant | `scopeType=PLATFORM` | `FACILITY:A` | `FACILITY:B` |
| --- | --- | --- | --- |
| `audit.read` at PLATFORM | 200, everything | 200 | 200 |
| `audit.read` at FACILITY A | 403 | 200, facility A only | 403 |
| `facility.read` at PLATFORM | 403 | 403 | 403 |
| no grant | 403 | 403 | 403 |

Only PLATFORM sees rows belonging to another scope, and only PLATFORM sees
rows carrying no scope at all — an untagged row is invisible to a narrower
reader rather than accidentally shared.

`before` and `after` are not returned. They hold the changed values, redacted
at write time but still the most sensitive columns in the table, and a list
view has no use for them.

Reading the trail writes an `audit.trail_read` row to `audit.security_events`.
It is not a state change, so it does not belong in the audit trail it would
otherwise pollute — but who conducted an investigation is a question asked
afterwards.

## SELF is strictly self

A practitioner holding `audit.read` at SELF scope reads their own history.
Asking for another user's id is **refused**, not quietly answered with the
caller's own records: a request for someone else's history is a different
request, and substituting a different answer leaves the caller to work out
what happened.

## Verifying it

```
docker compose exec web pnpm test:integration
```

`tests/integration/authorization.test.ts` asserts, against the real endpoint:
a role without the permission is refused (4.3); a grant scoped to facility A
is refused facility B and refused the platform-wide view (4.4); a revoked
grant and a suspended account both stop working immediately; and the rows
returned to a facility-scoped reader contain only that facility.

That last one matters more than the status codes. A 403 proves the check ran;
the rows prove the filter matches what was authorised. Authorising one scope
and then querying a wider one returns a 200 and the wrong data, and no
assertion about status codes would catch it.

## Not in this stage

- **Every resource type.** Step 4.4's verification says "asserts 403 on every
  resource type", and there is one: the audit trail. Practitioner profiles,
  facilities, service requests and timesheets do not exist until Stage 5 and
  6, and the assertion has to be repeated for each as it lands. The guard and
  the test shape are in place so that is a few lines per endpoint rather than
  a design question.
- **Scope ancestry.** `RequestedScope.ancestors` lets a grant on a facility
  reach a branch beneath it, and the guard implements it, but nothing yet has
  a hierarchy to walk. It is exercised by the unit tests only until facilities
  land.
- **Rate limiting a caller who is probing scopes.** Refusals are logged at
  warn, and a burst of them is an attack, but nothing acts on that yet.

## Every route that takes an identifier is attacked from another tenant (AUT-10)

The guard proves that a caller holds a permission over the scope they *name*.
Whether the record they name lies inside that scope is each route's own
business, and a route that forgets is invisible to every test that only calls it
as its rightful owner. That is how the owner of one hospital could revoke
another's staff with a single identifier (AUT-01): nothing ever called the
route as somebody else.

`tests/integration/cross-tenant.test.ts` is the answer, and it is a pattern, not
a patch. Two verified hospitals are built side by side
(`support/tenant-world.ts`, one of everything a route can name: shifts,
bookings, invitations, timesheets, disputes and their evidence, incidents,
invoices, payouts, credentials, availability, access grants). A caller from
hospital A then tries every route against hospital B's records, and each attempt
must come to:

- **refused, and only refused** - 403 or 404. A 409 or 422 is the route reaching
  the record and complaining about its state, which tells the caller it exists
  in somebody else's hospital; a 200 is the bug;
- **changed nothing** - a hash of every mutable table before and after;
- **given nothing away** - the answer holds no identifier, name or number of B's.

For every attack there is a control, the rightful caller making the same request
and not being refused, so a request built wrongly cannot pass by being refused
for the wrong reason. Routes that take a facility in their input are attacked
twice: naming the other tenant's facility (the guard must refuse) and naming
their own with the other tenant's identifier (the route must refuse, which is
what AUT-01 was).

**A new route has to say where it stands.** A second test lists every
`route.ts` under `src/app/api/v1` and fails if one is neither in the table nor
in `NO_TENANT_IDENTIFIER` with the reason it takes no identifier. To add one:

- a route on a hospital's records - `onFacility(...)`, one line giving the
  request;
- a practitioner's own records - `onSelf(...)`;
- only the platform may call it - `onPlatform(...)`;
- it names a scope in its query or body - add it to `SCOPED` (reads; a listing
  is also checked to show only the caller's own) or `SCOPED_WRITES`.

If the new route needs something the world does not have, add it to
`buildTenant`; both hospitals get it, so either can be the attacker.

Run it on its own database when other sessions share the stack:
`TEST_DATABASE_URL=...medilink_something_test pnpm test:integration
tests/integration/cross-tenant.test.ts` (the name must end in `_test`).

What this found when it was first run: opening a dispute, and withdrawing one,
answered somebody on neither side with a 409 listing what was wrong with the
shift. That confirmed the shift existed and what state its attendance was in.
Both now answer "not found", as the evidence routes already did.

Known and *not* fixed by it: before DSP-04 a hospital's owner could not reach the
dispute evidence routes at all, because they are guarded on the caller's own
scope. A hospital's people are now a party to a case; the harness still uses the
practitioner as the control for those routes, and the attacks are refusals for
everybody else.
