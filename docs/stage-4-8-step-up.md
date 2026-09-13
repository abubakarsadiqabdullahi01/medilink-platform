# Step 4.8 — step-up authentication, enforced

`isStepUpFresh` has existed since Stage 4.2. Nothing called it. The freshness
was computed on every session read, reported to clients as `stepUpFresh`, and
never once acted on — the gate item was half-built and looked finished.

## Declared against the permission, not the route

The whole of the policy is one set in `src/lib/authz/permissions.ts`:

```ts
export const STEP_UP_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'payout.account.change',
  'role.grant',
]);
```

A per-route flag is a thing somebody forgets on the eleventh route. A
permission that carries its own requirement is enforced by
`handleGuardedRequest` for **every route that ever names it, including ones
not written yet** — which matters here, because neither of these permissions
has a route today. `payout.account.change` belongs to module 12, blocked on
the 3.1 revenue decision; `role.grant` has no endpoint yet. When either is
written, it is already covered.

`payout.account.change` is in the set because the catalogue entry beside it
has said "(requires step-up auth)" in prose since Stage 4. This is the same
statement in a form the code can act on.

`role.grant` is there because granting a role is how somebody with one
session gets a durable second one. It is also rare enough that a password
prompt costs an administrator seconds a month.

**The bar for adding a third:** an act that moves money to a new destination,
or that hands somebody else the ability to. Both are what a stolen laptop with
an open session is used for, and neither is undone by noticing quickly. A unit
test asserts the set stays at four or fewer — not a rule the code can really
enforce, but a number somebody has to change deliberately.

## Checked before the permission, not after

This is the one subtle part.

If step-up were checked after `requirePermission`, then a `step_up_required`
response would tell the caller **they hold the permission** — precisely what
the 403 is written to refuse to disclose. Checking it first means everybody
asking gets the same answer whatever they hold.

Two integration tests pin this down: a caller with no grant at all gets
`step_up_required`, the same as a caller who holds it; and a stranger who
*does* step up then gets a plain 403, because step-up proves who you are and
grants nothing.

## The endpoint

`POST /api/v1/auth/step-up`, taking a password.

**Not a guarded route**, and deliberately so: `handleGuardedRequest` requires
a permission and a scope, and this endpoint is how a caller acquires the right
to exercise one. Naming a permission there would be circular. It still
requires a usable session — a step-up with nothing to step up from is nothing.

**A password, not a fresh sign-in.** The point is to prove the person at the
keyboard is still the account holder; issuing a new session would discard the
one they are working in.

**Freshness belongs to the session, not the account.** A laptop left open in
one place must not step up a phone somewhere else, and a test asserts a second
session of the same user is untouched.

## It shares the login lockout

Failures are written as `login_attempts` rows against the same identifier, and
the same window is checked before a guess is allowed.

A step-up prompt with no throttle would simply be a softer door into the same
house. There is no point locking one and leaving the other open. A test drives
it to `LOGIN_MAX_FAILURES` and then asserts the *correct* password is refused
with `account_locked`.

## The window

Five minutes (`STEP_UP_WINDOW_SECONDS`), unchanged from Stage 4.2. A window
rather than a flag, for the reason step-up exists at all: an unattended laptop
is still unattended a few minutes later.

## Not in this step

- **A second factor.** Step-up here re-proves the password. Real MFA is a
  larger change and is not in the plan as a step; when it lands, this is where
  it plugs in.
- **A client prompt.** The API answers `step_up_required` with a 401; nothing
  renders a dialogue, because nothing renders anything yet.
- **Step-up on suspension or reinstatement.** Arguable, and left out: a
  clinical safety decision is taken deliberately by somebody already in a
  compliance queue, not fired off from a hijacked tab. Revisit if the pilot
  says otherwise.

## Verifying it locally

```
pnpm verify
docker compose exec web pnpm test:integration step-up
```
