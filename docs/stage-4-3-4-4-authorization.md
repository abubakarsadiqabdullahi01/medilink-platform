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
