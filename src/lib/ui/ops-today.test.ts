import { describe, expect, it } from 'vitest';
import { opsAttention, oldestWaiting, queueRows, type PlatformSummaryJson } from './ops-today';

const now = new Date('2026-10-18T12:00:00Z');
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const base = (over: Partial<PlatformSummaryJson> = {}): PlatformSummaryJson => ({
  queues: {},
  incidentSeverity: [],
  worstIncident: null,
  growth: [],
  recent: [],
  ...over,
});

describe('how long is too long, for each queue', () => {
  it('measures an incident in hours and a suggestion in weeks', () => {
    const summary = base({
      queues: {
        incidents: { count: 1, oldest: ago(5) },
        suggestions: { count: 40, oldest: ago(24 * 6) },
        credentials: { count: 3, oldest: ago(24 * 6) },
      },
    });
    const rows = queueRows(summary, now);
    const tone = (key: string) => rows.find((row) => row.key === key)!.tone;
    expect(tone('incidents')).toBe('ageing');
    expect(tone('suggestions')).toBe('fresh');
    expect(tone('credentials')).toBe('overdue');
  });

  it('lists queues with the longest-waiting item first and empty ones last', () => {
    const rows = queueRows(
      base({
        queues: {
          credentials: { count: 2, oldest: ago(30) },
          facilities: { count: 0, oldest: null },
          disputes: { count: 1, oldest: ago(100) },
        },
      }),
      now,
    );
    expect(rows.map((row) => row.key)).toEqual(['disputes', 'credentials', 'facilities']);
  });

  it('shows only the queues the caller may see', () => {
    expect(
      queueRows(base({ queues: { disputes: { count: 1, oldest: ago(1) } } }), now).map(
        (row) => row.key,
      ),
    ).toEqual(['disputes']);
  });

  it('names the oldest real queue, never a background one', () => {
    const rows = queueRows(
      base({
        queues: {
          suggestions: { count: 5, oldest: ago(24 * 30) },
          credentials: { count: 1, oldest: ago(10) },
        },
      }),
      now,
    );
    expect(oldestWaiting(rows)?.key).toBe('credentials');
  });
});

describe('what to open first', () => {
  it('puts a missed legal deadline, a serious incident and a failing system before any queue', () => {
    const items = opsAttention(
      base({
        queues: { credentials: { count: 7, oldest: ago(24 * 6) } },
        incidentSeverity: [
          { severity: 'SEVERE', count: 1 },
          { severity: 'MINOR', count: 4 },
        ],
        worstIncident: {
          severity: 'SEVERE',
          category: 'STAFFING',
          summary: 'x',
          reportedAt: ago(30),
        },
        privacy: { open: 2, overdue: 1, oldest: ago(24 * 40), nextDue: ago(24), erasures: 0 },
        health: { status: 'degraded', problems: 2, deadLetter: 1, failedTexts24h: 0 },
      }),
      now,
    );
    expect(items.map((item) => item.id)).toEqual([
      'privacy-overdue',
      'serious-incidents',
      'system',
      'queue-credentials',
    ]);
    expect(items.every((item) => item.tone === 'danger')).toBe(true);
  });

  it('warns of a deadline inside a week, and not of one far off', () => {
    const soon = opsAttention(
      base({
        privacy: {
          open: 1,
          overdue: 0,
          oldest: ago(5),
          nextDue: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
          erasures: 0,
        },
      }),
      now,
    );
    expect(soon.map((item) => item.id)).toEqual(['privacy-soon']);
    const far = opsAttention(
      base({
        privacy: {
          open: 1,
          overdue: 0,
          oldest: ago(5),
          nextDue: new Date(now.getTime() + 25 * 86_400_000).toISOString(),
          erasures: 0,
        },
      }),
      now,
    );
    expect(far).toEqual([]);
  });

  it('calls a failed reconciliation urgent and quotes what it said', () => {
    const [item] = opsAttention(
      base({
        money: {
          reconciliation: {
            lastRunAt: ago(3),
            lastStatus: 'FAILED',
            lastError: 'Ledger is out by ₦2,000.00',
          },
        },
      }),
      now,
    );
    expect(item).toMatchObject({ id: 'reconciliation', tone: 'danger' });
    expect(item!.detail).toContain('Ledger is out by');
  });

  it('does not list a queue that is not yet old, and never lets feedback head the page', () => {
    const items = opsAttention(
      base({
        queues: {
          credentials: { count: 2, oldest: ago(3) },
          suggestions: { count: 99, oldest: ago(24 * 90) },
        },
      }),
      now,
    );
    expect(items).toEqual([]);
  });

  it('lists the money acts for those who may do them, and nothing for those who may not', () => {
    const none = opsAttention(
      base({ money: { reconciliation: { lastRunAt: null, lastStatus: null, lastError: null } } }),
      now,
    );
    expect(none).toEqual([]);

    const items = opsAttention(
      base({
        money: {
          reconciliation: { lastRunAt: ago(5), lastStatus: 'SUCCEEDED', lastError: null },
          payoutsPrepared: { count: 8, oldest: ago(100) },
          draftInvoices: { count: 3, oldest: ago(2) },
          payoutsReleased: { count: 0, oldest: null },
        },
      }),
      now,
    );
    expect(items.map((item) => item.id)).toEqual(['payouts-prepared', 'invoices-draft']);
    expect(items[0]!.title).toBe('8 payouts are prepared and waiting to be released');
  });
});
