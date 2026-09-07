# Stage 4.6 — outbox recovery

Implements gate item 4.6: domain events and the PostgreSQL outbox, verified by
"force a consumer to throw, assert the event is retried and eventually
consumed". This is one of the four Stage 4 gate conditions, and the evidence
it asks for is a recorded failure and recovery.

## What changed

The worker's behaviour moved from the loop in `src/worker/index.ts` into
`src/worker/processor.ts`. Nothing about how it runs in production changed;
what changed is that a test can now drive one pass at a time.

The behaviour was previously welded into a `while (running)` with a sleep in
it, which cannot be asserted on without either running a real worker process
and waiting, or reimplementing the logic in the test — and a test that
reimplements the thing it checks passes when both are wrong.

| Function | What it does |
| --- | --- |
| `claimDueEvents` | Claims due rows with `FOR UPDATE SKIP LOCKED`, marks them `PROCESSING` and counts the attempt before any handler runs |
| `processEvent` | Runs one event through its handler and records the outcome |
| `runOnce` | One claim-and-dispatch pass, returning counts a test can assert on |

`index.ts` now only decides when to call `runOnce` and when to stop.

## Behaviour the tests pin down

| Case | What it proves |
| --- | --- |
| Handler throws, then succeeds | The event goes to `FAILED` with the error recorded and a future `available_at`, is not claimed again before that time, and is processed on the next due pass |
| Handler always throws | Backoff grows with each attempt, and the event reaches `DEAD_LETTER` only on attempt 8 — never earlier, and it is not claimed again afterwards |
| Transaction rolls back | No outbox row exists. No event without the state change, and no state change without the event |
| Duplicate idempotency key | The second publish is refused, so a replayed webhook cannot become a second event to consume |
| Unregistered event type | Marked processed rather than retried. Modules arrive stage by stage, and an event with no audience yet must not accumulate attempts and dead-letter for having none |
| Two workers at once | Five events, two concurrent passes, five deliveries and one attempt each. This is what `SKIP LOCKED` buys |

## Why the attempt is counted before the handler runs

`claimDueEvents` increments `attempts` in the same statement that takes the
lock. A handler that hangs rather than throwing — a gateway that never answers
— would otherwise be retried for free forever, because the increment would
never be reached.

## How a test moves time

It does not. Advancing a clock would need the due-ness check to take an
injected time, and that check has to live inside the statement that takes the
lock or two workers can disagree about what is due.

A test that needs a backed-off event to become due rewinds its `available_at`
instead, which is precisely what the passage of time would have done.

## Verifying it

```
docker compose exec web pnpm test:integration
```

Integration rather than unit: `SKIP LOCKED`, transaction rollback and the
unique constraint on `idempotency_key` are properties of PostgreSQL. A mocked
client would assert that the test's own mock behaves as the test expects.

The suite creates and migrates `medilink_test` itself, and refuses to run
against a database whose name does not end in `_test` — it truncates between
cases, and pointing it at the development database would delete a developer's
data.

## Not in this stage

- A dead-letter alert. `DEAD_LETTER` is a queue an operator is supposed to
  work, and nothing yet tells them it has anything in it. Section 2.8 of the
  plan lists queue-depth alerts among the observability baseline; that lands
  with the rest of it.
- Retry of a dead letter. It requires a decision about who may replay a
  financial event, which is Stage 8's to make.
