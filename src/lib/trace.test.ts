// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { currentTrace, withTrace } from './trace';

/**
 * AUD-13 — what follows one business action across the request, the event and the worker has to
 * survive every `await` between them without anybody passing it by hand, and must not leak from
 * one action to the next. These are the two ways an ambient id goes wrong.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the trace of an action', () => {
  it('is nothing outside one, which is what code run by hand (a script, a test) sees', () => {
    expect(currentTrace()).toBeUndefined();
  });

  it('is there across awaits, timers and nested calls, with nobody passing it down', async () => {
    const seen = await withTrace({ correlationId: 'c-1', requestId: 'r-1' }, async () => {
      await wait(1);
      const inner = await (async () => {
        await Promise.resolve();
        return currentTrace();
      })();
      return inner;
    });

    expect(seen).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });

  it('is gone again once the action is over', async () => {
    await withTrace({ correlationId: 'c-2' }, async () => undefined);
    expect(currentTrace()).toBeUndefined();
  });

  it('keeps simultaneous actions apart, however their awaits interleave', async () => {
    const run = (id: string, delay: number) =>
      withTrace({ correlationId: id }, async () => {
        await wait(delay);
        const before = currentTrace()?.correlationId;
        await wait(delay);
        return [before, currentTrace()?.correlationId];
      });

    const results = await Promise.all([run('a', 5), run('b', 1), run('c', 3)]);

    expect(results).toEqual([
      ['a', 'a'],
      ['b', 'b'],
      ['c', 'c'],
    ]);
  });

  it('is replaced, not merged, by an action started inside another', async () => {
    const seen = await withTrace({ correlationId: 'outer', requestId: 'r-outer' }, () =>
      withTrace({ correlationId: 'inner' }, async () => currentTrace()),
    );

    expect(seen).toEqual({ correlationId: 'inner' });
  });

  it('is left alone when the action throws', async () => {
    await expect(
      withTrace({ correlationId: 'c-3' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(currentTrace()).toBeUndefined();
  });
});
