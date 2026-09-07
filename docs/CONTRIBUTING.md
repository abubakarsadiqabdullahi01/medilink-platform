# Working in this repository

## Definition of done (Implementation Plan §2.1)

A step is done when all of these hold:

1. The behaviour is covered by an automated test that fails if the behaviour is removed.
2. Authorisation is enforced server-side, not only hidden in the interface.
3. Any state change writes an audit record identifying who, what, when and why.
4. Errors are handled and surfaced in language the user can act on.
5. The change sits behind a feature flag where it alters an existing workflow.
6. A second person has read the code.

## Branching

`main` is always deployable. Work happens on short-lived branches merged by
pull request with CI green. Migrations are backward-compatible for one
release: add columns before writing to them, stop reading before dropping.

## Writing an audited change

```ts
await prisma.$transaction(async (tx) => {
  const before = await tx.user.findUniqueOrThrow({ where: { id } });
  const after = await tx.user.update({ where: { id }, data: { status: 'SUSPENDED' } });

  await recordAudit(tx, {
    action: 'user.suspended',
    entityType: 'identity.users',
    entityId: id,
    actorId: context.userId,
    reason: input.reason,
    before,
    after,
    correlationId: context.correlationId,
  });

  await publishEvent(tx, {
    eventType: EVENTS.SanctionApplied,
    aggregateType: 'user',
    aggregateId: id,
    payload: { userId: id },
    correlationId: context.correlationId,
  });
});
```

The audit row and the event are written in the same transaction as the change.
If the transaction rolls back, none of the three exist — which is the point.

The audit rule is enforced, not merely stated: `pnpm test:integration` fails if
a write leaves no audit row. See `docs/stage-4-5-audit-coverage.md`, and add
any new model to `AUDITED_MODELS` or `EXEMPT_MODELS` in
`src/lib/audit-coverage.ts` — a model in neither fails the suite.

## Writing an authenticated endpoint

Route handlers go through `handleGuardedRequest`, which will not hand over the
session without a permission and the scope of the record being touched:

```ts
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: someQuerySchema,
    permission: 'facility.read',
    scope: (query) => ({ type: 'FACILITY', id: query.facilityId }),
    action: async ({ input, session, context }) => readSomething(input),
  });
}
```

Add the route to the module's `routes.ts` table, which is what a reviewer
reads instead of every route file, and add the 403 cases to
`tests/integration/authorization.test.ts` — one for the permission, one for a
grant scoped elsewhere. See `docs/stage-4-3-4-4-authorization.md`.

## Money

Integers in kobo, never floats. Column names end in `_kobo`.

## If `pnpm typecheck` passes suspiciously easily

This project uses pnpm, and `@prisma/client` is a stub that re-exports the
client generated into `node_modules/.prisma/client`. If that generation has
not run in pnpm's own tree, TypeScript resolves the stub instead, where
`PrismaClient` is declared `any` — every Prisma call then typechecks, whatever
it says, and `Prisma.dmmf` and `Prisma.raw` appear not to exist.

The fix is `pnpm prisma generate`. The cause is usually `npm install` having
been run in this repository at some point: it creates a hoisted
`node_modules/.prisma` that generation targets instead. `package-lock.json` is
in `.gitignore` for this reason — if one appears, delete it along with
`node_modules`, then `pnpm install`.
