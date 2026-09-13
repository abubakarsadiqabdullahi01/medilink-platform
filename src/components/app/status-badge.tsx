import { Badge, type BadgeVariant } from '@/components/ui/badge';

/**
 * One place that decides what colour a status is.
 *
 * Every module has its own enum and several share words — `APPROVED` means
 * something in credentials and something else in timesheets — but they always
 * mean the same *kind* of thing, and a reader scanning three queues should
 * not have to relearn the palette on each. Mapping by word rather than per
 * page is what keeps that true.
 */
const VARIANTS: Record<string, BadgeVariant> = {
  // Settled, and settled well.
  APPROVED: 'success',
  VERIFIED: 'success',
  ACTIVE: 'success',
  COMPLETED: 'success',
  DONE: 'success',
  GRANTED: 'success',
  CLOSED: 'secondary',
  RESOLVED: 'secondary',
  UPHELD: 'success',

  // Settled, and settled badly.
  REJECTED: 'destructive',
  DISPUTED: 'destructive',
  SUSPENDED: 'destructive',
  NO_SHOW: 'destructive',
  DECLINED: 'destructive',
  REFUSED: 'destructive',
  EXPIRED: 'destructive',
  STRUCK_OFF: 'destructive',
  CANCELLED: 'secondary',
  WITHDRAWN: 'secondary',
  DISMISSED: 'secondary',

  // Waiting on somebody.
  PENDING: 'warning',
  NEW: 'warning',
  REPORTED: 'warning',
  OPEN: 'warning',
  UNDER_REVIEW: 'warning',
  AWAITING_DECISION: 'warning',
  SUBMITTED: 'warning',
  REQUESTED: 'warning',
  INFO_REQUESTED: 'warning',
  TRIAGED: 'info',
  PLANNED: 'info',
  INVITED: 'info',
  ACCEPTED: 'info',
  CONFIRMED: 'info',
  PUBLISHED: 'info',
  DRAFT: 'secondary',
  NOT_STARTED: 'secondary',
  MANUALLY_CORRECTED: 'warning',
  CHECKED_IN: 'info',
  CHECKED_OUT: 'info',
  CHECK_IN_PENDING: 'warning',
};

export function statusVariant(status: string): BadgeVariant {
  return VARIANTS[status] ?? 'secondary';
}

/** Enum values are SCREAMING_SNAKE; people read sentences. */
export function humanise(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={statusVariant(status)} className={className}>
      {humanise(status)}
    </Badge>
  );
}

/**
 * Severity has its own scale because it is ordered and status is not: a
 * reader needs to see at a glance that a death outranks a near miss, and a
 * palette shared with "pending" would flatten that.
 */
const SEVERITY: Record<string, BadgeVariant> = {
  NEAR_MISS: 'secondary',
  MINOR: 'info',
  MODERATE: 'warning',
  SEVERE: 'destructive',
  DEATH: 'destructive',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant={SEVERITY[severity] ?? 'secondary'} className="uppercase tracking-wide">
      {humanise(severity)}
    </Badge>
  );
}
