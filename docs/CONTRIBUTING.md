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

## Money

Integers in kobo, never floats. Column names end in `_kobo`.
