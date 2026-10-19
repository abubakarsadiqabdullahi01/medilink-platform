import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DescribedEstimate } from '@/modules/rates-contracts/domain/estimate';

const get = vi.fn();
vi.mock('@/lib/ui/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

import { useShiftEstimate, type ShiftEstimateInput } from '@/lib/ui/estimate';
import { ShiftEstimate } from './shift-estimate';

/**
 * M11-04 on the screen: the words the server wrote are shown as written, and the browser asks for
 * them only when there is something to ask about, and only once the typing has stopped.
 */

const words: DescribedEstimate = {
  totalKobo: 12_000_000,
  headline: 'This shift would cost about ₦40,000 for each person, and about ₦120,000 for 3 people',
  lines: ['8 hours at ₦5,000 an hour'],
  notes: ['This is for the hours as scheduled, 8 hours in all.', 'If an unpaid break is recorded, those minutes come off the hours.'],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the estimate on the screen', () => {
  it('shows the sentence, how it is made up, and what it leaves out', () => {
    render(<ShiftEstimate estimate={words} />);

    expect(screen.getByText(words.headline)).toBeInTheDocument();
    expect(screen.getByText('8 hours at ₦5,000 an hour')).toBeInTheDocument();
    expect(screen.getByText(/unpaid break is recorded/)).toBeInTheDocument();
  });

  it('shows no empty list when there are no lines', () => {
    render(<ShiftEstimate estimate={{ ...words, lines: [] }} />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('asking the server for it', () => {
  const input = (over: Partial<ShiftEstimateInput> = {}): ShiftEstimateInput => ({
    facilityId: 'facility-1',
    startsAt: new Date('2026-10-14T07:00:00Z'),
    endsAt: new Date('2026-10-14T15:00:00Z'),
    hourlyRateKobo: 500_000,
    headcount: 3,
    ...over,
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );

  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ estimate: words });
  });

  it('asks with the times, rate and headcount, and returns what the server said', async () => {
    const { result } = renderHook(() => useShiftEstimate(input()), { wrapper });

    await waitFor(() => expect(result.current).toEqual(words));

    const url = new URL(String(get.mock.calls[0]![0]), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/service-requests/estimate');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      facilityId: 'facility-1',
      startsAt: '2026-10-14T07:00:00.000Z',
      endsAt: '2026-10-14T15:00:00.000Z',
      hourlyRateKobo: '500000',
      headcount: '3',
    });
  });

  it.each([
    ['there are no times yet', { startsAt: null, endsAt: null }],
    ['the rate is nothing', { hourlyRateKobo: 0 }],
    ['the rate is not a whole number of kobo', { hourlyRateKobo: 500_000.5 }],
    ['the headcount is not a whole number', { headcount: Number.NaN }],
    ['the headcount is beyond what a request allows', { headcount: 51 }],
    ['there is no facility', { facilityId: null }],
    ['the person may not ask', { allowed: false }],
  ] as const)('does not ask when %s', async (_why, over) => {
    const { result } = renderHook(() => useShiftEstimate(input(over)), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(get).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it('asks once for a rate that is typed in several keystrokes, not once for each', async () => {
    const { rerender } = renderHook(({ rate }) => useShiftEstimate(input({ hourlyRateKobo: rate })), {
      wrapper,
      initialProps: { rate: 500_000 },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    // Keystrokes well inside the pause, one render each.
    for (const rate of [600_000, 650_000, 700_000]) {
      rerender({ rate });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(get).toHaveBeenCalledTimes(2);
    expect(new URL(String(get.mock.calls[1]![0]), 'http://localhost').searchParams.get('hourlyRateKobo')).toBe('700000');
  });

  it('stops showing what it has when asking is no longer allowed, for instance once the dialog is closed', async () => {
    const { result, rerender } = renderHook(({ allowed }) => useShiftEstimate(input({ allowed })), {
      wrapper,
      initialProps: { allowed: true },
    });
    await waitFor(() => expect(result.current).toEqual(words));

    rerender({ allowed: false });

    expect(result.current).toBeUndefined();
  });

  it('says nothing, and does not stop anybody, when the server refuses or fails', async () => {
    get.mockRejectedValue(new Error('refused'));
    const { result } = renderHook(() => useShiftEstimate(input()), { wrapper });

    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.current).toBeUndefined();
  });

  it('passes on null when the times cannot be priced', async () => {
    get.mockResolvedValue({ estimate: null });
    const { result } = renderHook(() => useShiftEstimate(input()), { wrapper });

    await waitFor(() => expect(result.current).toBeNull());
  });
});
