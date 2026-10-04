import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, prefetch } from './api';

/**
 * The prefetch layer, which is the only part of the api client with state.
 *
 * The cases that matter are the ones about *not* serving a warmed response:
 * a prefetch that behaved like a cache would hand a queue a three-second-old
 * body after somebody had just worked a row in it, and the page would look
 * broken in a way nobody could reproduce.
 */

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('prefetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ rows: [] })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('serves the warmed request to the page that then asks for it', async () => {
    prefetch('/api/v1/incidents/queue?status=OPEN');
    const body = await api.get('/api/v1/incidents/queue?status=OPEN');

    expect(body).toEqual({ rows: [] });
    // One request, not two: the page joined the one already in flight.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not start a second request while one is already warming', () => {
    prefetch('/api/v1/facilities');
    prefetch('/api/v1/facilities');
    prefetch('/api/v1/facilities');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is consumed once, so a refetch after a mutation goes to the server', async () => {
    prefetch('/api/v1/unhonoured');

    await api.get('/api/v1/unhonoured');
    await api.get('/api/v1/unhonoured');

    // The second read is what a queue does after recording a decision. If it
    // were served the warmed body the row just worked would still be there.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a warmed response that has gone stale', async () => {
    vi.useFakeTimers();

    prefetch('/api/v1/audit');
    vi.advanceTimersByTime(31_000);

    await api.get('/api/v1/audit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('only matches the exact url, so a filtered page fetches for itself', async () => {
    prefetch('/api/v1/credentials?status=PENDING');
    await api.get('/api/v1/credentials?status=VERIFIED');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a failed prefetch become an unhandled rejection', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'forbidden', message: 'No.' } })),
      } as unknown as Response),
    );

    // Hovering a link you may not open must not reject into the void. The
    // page that follows still gets a real error of its own.
    expect(() => prefetch('/api/v1/payouts')).not.toThrow();
    await expect(api.get('/api/v1/payouts')).rejects.toThrow('No.');
  });
});
