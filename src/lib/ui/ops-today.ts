import type { AttentionItem } from '@/components/app/dashboard';
import type {
  PlatformSummary,
  QueueKey,
} from '@/modules/audit-compliance/application/platform-summary';
import { ageTone, waitingFor, type AgeThresholds, type AgeTone } from '@/components/app/queue-age';
import { formatDate } from '@/components/app/format';
import type { Json } from '@/lib/ui/json';

/**
 * What an operations officer should open first, and how long each queue has been left.
 *
 * The old dashboard had one rule for every queue — "stale after five days" — so a death reported
 * four days ago was fine and a suggestion at six was late. Each queue now says how long is too
 * long *for what it is*: an incident is measured in hours, a suggestion in weeks. Pure, so each of
 * those numbers is a line in a test, and so the screen that draws them has nothing to decide.
 */

export type PlatformSummaryJson = Json<PlatformSummary>;

export interface QueueMeta {
  key: QueueKey;
  label: string;
  /** "to review", "open": what the count counts. */
  noun: string;
  href: string;
  /** How long before the oldest item is "getting old" and then "overdue". */
  thresholds: AgeThresholds;
  /** Whether a pilot-feedback queue: listed, but never allowed to head the page. */
  background?: boolean;
}

const hours = (ageing: number, overdue: number): AgeThresholds => ({
  ageingAfterHours: ageing,
  overdueAfterHours: overdue,
});

export const QUEUES: QueueMeta[] = [
  {
    key: 'incidents',
    label: 'Clinical incidents',
    noun: 'open',
    href: '/admin/incidents',
    thresholds: hours(4, 24),
  },
  {
    key: 'disputes',
    label: 'Disputes',
    noun: 'to adjudicate',
    href: '/admin/disputes',
    thresholds: hours(72, 168),
  },
  {
    key: 'credentials',
    label: 'Credentials',
    noun: 'to review',
    href: '/admin/credentials',
    thresholds: hours(48, 120),
  },
  {
    key: 'facilities',
    label: 'Facilities',
    noun: 'to verify',
    href: '/admin/facilities',
    thresholds: hours(48, 120),
  },
  {
    key: 'unhonoured',
    label: 'Missed shifts',
    noun: 'awaiting a fault decision',
    href: '/admin/unhonoured',
    thresholds: hours(72, 168),
  },
  {
    key: 'suggestions',
    label: 'Suggestions',
    noun: 'untriaged',
    href: '/admin/suggestions',
    thresholds: hours(168, 336),
    background: true,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RANK: Record<AttentionItem['tone'], number> = { danger: 0, warning: 1, info: 2 };

export interface QueueRow extends QueueMeta {
  count: number;
  oldest: string | null;
  tone: AgeTone;
}

/** The queues the caller may see, with how long each has been left, oldest first. */
export function queueRows(summary: PlatformSummaryJson | undefined, now: Date): QueueRow[] {
  return QUEUES.flatMap((meta) => {
    const queue = summary?.queues[meta.key];
    if (!queue) return [];
    return [
      {
        ...meta,
        count: queue.count,
        oldest: queue.oldest,
        tone:
          queue.oldest && queue.count > 0
            ? ageTone(queue.oldest, now, meta.thresholds)
            : ('fresh' as AgeTone),
      },
    ];
  }).sort((a, b) => {
    if (b.count === 0 && a.count > 0) return -1;
    if (a.count === 0 && b.count > 0) return 1;
    const left = a.oldest ? Date.parse(a.oldest) : Infinity;
    const right = b.oldest ? Date.parse(b.oldest) : Infinity;
    return left - right;
  });
}

export function opsAttention(summary: PlatformSummaryJson | undefined, now: Date): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (!summary) return items;

  const privacy = summary.privacy;
  if (privacy && privacy.overdue > 0) {
    items.push({
      id: 'privacy-overdue',
      tone: 'danger',
      title: `${plural(privacy.overdue, 'data request is', 'data requests are')} past the legal deadline`,
      detail: 'Answering is a legal duty with a date. Open the oldest first.',
      href: '/admin/data-requests',
      action: 'Open requests',
    });
  } else if (privacy && privacy.nextDue) {
    const left = Date.parse(privacy.nextDue) - now.getTime();
    if (left <= 7 * DAY_MS) {
      items.push({
        id: 'privacy-soon',
        tone: 'warning',
        title: 'A data request is due within a week',
        detail: `The nearest deadline is ${formatDate(privacy.nextDue)}.`,
        href: '/admin/data-requests',
        action: 'Open requests',
      });
    }
  }

  const serious = (summary.incidentSeverity ?? [])
    .filter((row) => row.severity === 'DEATH' || row.severity === 'SEVERE')
    .reduce((sum, row) => sum + row.count, 0);
  if (serious > 0) {
    items.push({
      id: 'serious-incidents',
      tone: 'danger',
      title: `${plural(serious, 'serious incident')} open`,
      detail: summary.worstIncident
        ? `The most serious was reported ${waitingFor(summary.worstIncident.reportedAt, now)} ago.`
        : undefined,
      href: '/admin/incidents',
      action: 'Open incidents',
    });
  }

  const health = summary.health;
  if (health && (health.status === 'degraded' || health.problems > 0 || health.deadLetter > 0)) {
    items.push({
      id: 'system',
      tone: 'danger',
      title:
        health.problems > 0
          ? `${plural(health.problems, 'thing is', 'things are')} wrong in the background work`
          : 'The background work is not healthy',
      detail:
        health.deadLetter > 0
          ? `${plural(health.deadLetter, 'event has', 'events have')} given up and will not be retried until somebody replays them.`
          : 'Messages and jobs may not be going out. The System page says which.',
      href: '/admin/system',
      action: 'Open System',
    });
  }

  const money = summary.money;
  if (money?.reconciliation.lastStatus === 'FAILED') {
    items.push({
      id: 'reconciliation',
      tone: 'danger',
      title: 'The nightly reconciliation failed',
      detail: money.reconciliation.lastError
        ? `It said: ${money.reconciliation.lastError}`
        : 'The books may not add up. Finance should look before any more money moves.',
      href: '/admin/finance',
      action: 'Open Finance',
    });
  }

  if (health && health.failedTexts24h > 0) {
    items.push({
      id: 'texts',
      tone: 'warning',
      title: `${plural(health.failedTexts24h, 'text')} failed to reach ${health.failedTexts24h === 1 ? 'somebody' : 'people'} in the last day`,
      detail: 'A gateway took them and then reported it could not deliver.',
      href: '/admin/system',
      action: 'Open System',
    });
  }

  for (const row of queueRows(summary, now)) {
    if (row.count === 0 || row.tone === 'fresh' || row.background) continue;
    items.push({
      id: `queue-${row.key}`,
      tone: row.tone === 'overdue' ? 'danger' : 'warning',
      title: `${row.count} ${row.label.toLowerCase()} ${row.noun}`,
      detail: row.oldest ? `The oldest has waited ${waitingFor(row.oldest, now)}.` : undefined,
      href: row.href,
      action: 'Open the queue',
    });
  }

  if (money?.payoutsPrepared && money.payoutsPrepared.count > 0) {
    items.push({
      id: 'payouts-prepared',
      tone: 'warning',
      title: `${plural(money.payoutsPrepared.count, 'payout is', 'payouts are')} prepared and waiting to be released`,
      detail: 'A second person releases it, and is asked for their password.',
      href: '/admin/payouts',
      action: 'Open payouts',
    });
  }
  if (money?.payoutsReleased && money.payoutsReleased.count > 0) {
    items.push({
      id: 'payouts-released',
      tone: 'warning',
      title: `${plural(money.payoutsReleased.count, 'released payout')} waiting for the bank transfer to be recorded`,
      href: '/admin/payouts',
      action: 'Open payouts',
    });
  }
  if (money?.draftInvoices && money.draftInvoices.count > 0) {
    items.push({
      id: 'invoices-draft',
      tone: 'info',
      title: `${plural(money.draftInvoices.count, 'invoice')} drafted and not yet issued`,
      href: '/admin/invoices',
      action: 'Open invoices',
    });
  }

  // Stable: within a tone, the order written above is the order of importance.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.tone] - RANK[b.item.tone] || a.index - b.index)
    .map(({ item }) => item);
}

/** The age of the oldest thing waiting in a queue that is not background: what to be ashamed of first. */
export function oldestWaiting(rows: QueueRow[]): QueueRow | null {
  return rows.find((row) => row.count > 0 && !row.background && row.oldest) ?? null;
}
