import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
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
  MORE_INFO_REQUESTED: 'warning',
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

  // Money. An invoice that has been sent and not paid is waiting on somebody; a void one is
  // settled and nobody's concern. These fell through to grey, so a paid invoice and an unpaid one
  // read the same in a list.
  ISSUED: 'warning',
  PAID: 'success',
  VOID: 'secondary',
  PREPARED: 'info',
  RELEASED: 'info',
  SETTLED: 'success',
  FAILED: 'destructive',
  NOT_SUBMITTED: 'secondary',
};

export function statusVariant(status: string): BadgeVariant {
  return VARIANTS[status] ?? 'secondary';
}

/** Enum values are SCREAMING_SNAKE; people read sentences. */
export function humanise(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

/**
 * A shape for every tone, beside the word.
 *
 * The word already says what the status is, but a row of badges is scanned, not read, and a
 * scan that depends on telling a green pill from an amber one fails for the one reader in
 * twelve who cannot, and for anybody on a phone in sunlight. Each tone therefore has its
 * own mark — tick, clock, cross, info, dot — so "settled well", "waiting on somebody",
 * "settled badly", "in progress" and "neutral" differ in shape as well as in colour.
 */
const TONE_ICON: Partial<Record<BadgeVariant, LucideIcon>> = {
  success: CircleCheck,
  warning: Clock,
  destructive: CircleX,
  info: Info,
  secondary: CircleDot,
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = statusVariant(status);
  const Icon = TONE_ICON[variant];
  return (
    <Badge variant={variant} className={className}>
      {Icon ? <Icon aria-hidden="true" /> : null}
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

const SEVERITY_ICON: Record<string, LucideIcon> = {
  NEAR_MISS: CircleDot,
  MINOR: Info,
  MODERATE: TriangleAlert,
  SEVERE: CircleAlert,
  DEATH: OctagonAlert,
};

export function SeverityBadge({ severity }: { severity: string }) {
  const Icon = SEVERITY_ICON[severity] ?? CircleDot;
  return (
    <Badge variant={SEVERITY[severity] ?? 'secondary'} className="uppercase tracking-wide">
      <Icon aria-hidden="true" />
      {humanise(severity)}
    </Badge>
  );
}
