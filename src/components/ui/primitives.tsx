import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/**
 * The console's small vocabulary of shapes.
 *
 * Deliberately a handful of plain components rather than a design system:
 * every queue in here is a list of things with a status and two buttons, and
 * the fastest way to a console somebody can actually use is to build that
 * shape once. shadcn can replace these later without touching a page.
 */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-lg border bg-surface p-5 shadow-sm', className)}>{children}</div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
    </header>
  );
}

const TONES = {
  neutral: 'bg-border/40 text-foreground',
  good: 'bg-primary/10 text-primary',
  warn: 'bg-amber-100 text-amber-900',
  bad: 'bg-destructive/10 text-destructive',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * One place that decides what colour a status is, so the same word does not
 * appear amber on one queue and grey on the next.
 */
export function toneFor(status: string): Tone {
  if (['APPROVED', 'VERIFIED', 'ACTIVE', 'COMPLETED', 'DONE', 'GRANTED'].includes(status)) {
    return 'good';
  }
  if (['REJECTED', 'DISPUTED', 'SUSPENDED', 'NO_SHOW', 'DECLINED', 'REFUSED'].includes(status)) {
    return 'bad';
  }
  if (
    ['PENDING', 'NEW', 'REPORTED', 'OPEN', 'UNDER_REVIEW', 'AWAITING_DECISION', 'SUBMITTED'].includes(
      status,
    )
  ) {
    return 'warn';
  }
  return 'neutral';
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90',
        variant === 'secondary' && 'border bg-surface hover:bg-border/30',
        variant === 'danger' && 'bg-destructive text-white hover:opacity-90',
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded border bg-surface px-3 py-2 text-sm outline-none focus:border-primary';

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted">{children}</p>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mb-4 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

/** Dates are shown in WAT, because that is where the shifts are. */
export function when(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Integer kobo, never a float (rule 3). Displayed as naira, computed as kobo. */
export function naira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined) return '—';
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}
