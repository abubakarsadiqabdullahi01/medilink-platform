'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleDot, Clock, KeyRound, PencilLine, Timer, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/app/field';
import { StatusBadge } from '@/components/app/status-badge';
import { formatClock, formatMinutes, formatWhen } from '@/components/app/format';
import { lagosLocalToInstant } from '@/lib/lagos-date';
import { spansDays } from '../timesheets/timesheet-view';
import { attendanceNote } from './attendance-note';

export interface Attendance {
  id: string;
  assignmentId: string;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  breakMinutes: number;
}

interface IssuedToken {
  code: string;
  qr: string;
  expiresAt: string;
}

const NOTE_ICON = { warning: TriangleAlert, info: CircleDot, neutral: Clock } as const;

/** A time typed into the hand-recording form is one that has happened, give or take a watch. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Attendance for one shift, from the ward's side.
 *
 * **The facility issues and the practitioner presents** — that direction is
 * what makes a code evidence of presence rather than proof that somebody owns
 * a phone. So this panel issues; nothing here can check anybody in.
 *
 * It says where things stand in words ("Not checked in — 25 minutes after the start"), because a
 * status badge reading "Not started" is the same at 07:00 and at 09:00, and only one of those is a
 * problem for the ward. The line is a polite live region, so a change is read out.
 */
export function AttendancePanel({
  assignmentId,
  facilityId,
  attendance: record,
  startsAt,
  endsAt,
  now,
  who,
}: {
  assignmentId: string;
  facilityId: string;
  /**
   * What the roster list already joined onto this row (`include=attendance`);
   * null or absent when nobody has issued a code yet. This panel used to fetch
   * it itself, so a page of fifty shifts made fifty extra requests.
   */
  attendance?: Attendance | null;
  /** With `endsAt` and `now`, lets the panel say when somebody is late. */
  startsAt?: string;
  endsAt?: string;
  now?: Date;
  /** The practitioner's name, so each button says whom it is for. */
  who?: string;
}) {
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<{ purpose: string; token: IssuedToken } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [checkedInAt, setCheckedInAt] = useState('');
  const [checkedOutAt, setCheckedOutAt] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [reason, setReason] = useState('');

  const issue = useMutation({
    mutationFn: (purpose: 'CHECK_IN' | 'CHECK_OUT') =>
      api
        .post<IssuedToken>(`/api/v1/assignments/${assignmentId}/attendance/token`, {
          facilityId,
          purpose,
        })
        .then((token) => ({ purpose, token })),
    onSuccess: (result) => {
      setIssued(result);
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
    onError: (error) => toast.error('Could not issue a code', { description: errorMessage(error) }),
  });

  const manual = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/assignments/${assignmentId}/attendance/manual`, {
        facilityId,
        checkedInAt: lagosLocalToInstant(checkedInAt).toISOString(),
        checkedOutAt: lagosLocalToInstant(checkedOutAt).toISOString(),
        breakMinutes: Number(breakMinutes || '0'),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Recorded by hand', {
        description: 'Marked as a manual correction, with your reason against it.',
      });
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
      setManualOpen(false);
      setCheckedInAt('');
      setCheckedOutAt('');
      setBreakMinutes('0');
      setReason('');
    },
    // The dialog stays open and everything typed stays in it: a failed save is not a lost one.
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
  });

  const status = record?.status ?? 'NOT_STARTED';
  const canCheckIn = ['NOT_STARTED', 'CHECK_IN_PENDING'].includes(status);
  const canCheckOut = status === 'CHECKED_IN';
  // The states the attendance machine lets become MANUALLY_CORRECTED. Offered
  // on an approved or disputed shift, the button could only ever fail.
  const canRecordByHand = [
    'NOT_STARTED',
    'CHECK_IN_PENDING',
    'CHECKED_IN',
    'CHECKED_OUT',
    'SUBMITTED',
    'REJECTED',
  ].includes(status);

  const note =
    startsAt && endsAt
      ? attendanceNote(
          { status, startsAt, endsAt, checkedInAt: record?.checkedInAt ?? null },
          now ?? new Date(),
        )
      : null;
  const NoteIcon = note ? NOTE_ICON[note.tone] : null;
  const forWho = who ? ` for ${who}` : '';

  // What the hand-recording form says about itself, as it is filled in.
  const inMs = checkedInAt ? lagosLocalToInstant(checkedInAt).getTime() : null;
  const outMs = checkedOutAt ? lagosLocalToInstant(checkedOutAt).getTime() : null;
  const limit = (now ?? new Date()).getTime() + FUTURE_TOLERANCE_MS;
  const inError = inMs !== null && inMs > limit ? 'That time has not happened yet.' : undefined;
  const outError =
    outMs !== null && outMs > limit
      ? 'That time has not happened yet.'
      : inMs !== null && outMs !== null && outMs <= inMs
        ? 'Checked out must be after checked in.'
        : undefined;
  const breakNumber = Number(breakMinutes || '0');
  const breakError =
    !Number.isInteger(breakNumber) || breakNumber < 0
      ? 'Enter a whole number of minutes, or 0.'
      : undefined;
  const workedMinutes =
    inMs !== null && outMs !== null && !outError && !inError && !breakError
      ? Math.max(0, Math.round((outMs - inMs) / 60_000) - breakNumber)
      : null;
  const canRecord =
    inMs !== null &&
    outMs !== null &&
    !inError &&
    !outError &&
    !breakError &&
    reason.trim().length >= 10;

  return (
    <div className="space-y-3">
      <div aria-live="polite" className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={status} />
          {record?.checkedInAt ? (
            <span className="tabular text-sm text-muted-foreground">
              in {formatClock(record.checkedInAt)}
            </span>
          ) : null}
          {record?.checkedOutAt ? (
            <span className="tabular text-sm text-muted-foreground">
              · out {formatClock(record.checkedOutAt)}
              {spansDays(record.checkedInAt, record.checkedOutAt) ? ' (next day)' : ''}
            </span>
          ) : null}
        </div>
        {note && NoteIcon ? (
          <p
            className={cn(
              'flex items-start gap-1.5 text-sm leading-snug',
              note.tone === 'warning' ? 'font-medium text-warning' : 'text-muted-foreground',
            )}
          >
            <NoteIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {note.text}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {canCheckIn ? (
          <Button
            variant="outline"
            aria-label={`Code to check in${forWho}`}
            loading={issue.isPending && issue.variables === 'CHECK_IN'}
            onClick={() => issue.mutate('CHECK_IN')}
          >
            <KeyRound />
            Code to check in
          </Button>
        ) : null}
        {canCheckOut ? (
          <Button
            variant="outline"
            aria-label={`Code to check out${forWho}`}
            loading={issue.isPending && issue.variables === 'CHECK_OUT'}
            onClick={() => issue.mutate('CHECK_OUT')}
          >
            <Timer />
            Code to check out
          </Button>
        ) : null}
        {canRecordByHand ? (
          <Button
            variant="ghost"
            aria-label={`Record by hand${forWho}`}
            onClick={() => setManualOpen(true)}
          >
            <PencilLine />
            Record by hand
          </Button>
        ) : null}
      </div>

      {/* Shown once and never stored. It is a live credential for five
          minutes, which is also why it is not in the audit log. */}
      <Dialog open={issued !== null} onOpenChange={(next: boolean) => !next && setIssued(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Read this to the practitioner</DialogTitle>
            <DialogDescription>
              {issued?.purpose === 'CHECK_IN' ? 'Check in' : 'Check out'}
              {who ? ` for ${who}` : ''} · lapses {issued ? formatWhen(issued.token.expiresAt) : ''}
            </DialogDescription>
          </DialogHeader>

          <p className="tabular select-all rounded-lg border bg-muted py-6 text-center text-4xl font-semibold tracking-[0.3em]">
            {issued?.token.code}
          </p>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Five minutes, five attempts. Issuing another supersedes this one. It is shown here once
            and is not stored anywhere you can read it again.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIssued(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={(next) => !manual.isPending && setManualOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record this shift by hand</DialogTitle>
            <DialogDescription>
              {who ? `${who}. ` : ''}For when the network failed and no code could be exchanged. The
              record is marked a manual correction so nobody later mistakes it for a token-backed
              check-in.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Checked in" required error={inError}>
              <Input
                type="datetime-local"
                value={checkedInAt}
                onChange={(event) => setCheckedInAt(event.target.value)}
              />
            </Field>
            <Field label="Checked out" required error={outError}>
              <Input
                type="datetime-local"
                value={checkedOutAt}
                onChange={(event) => setCheckedOutAt(event.target.value)}
              />
            </Field>
            <Field label="Unpaid break (minutes)" error={breakError} className="sm:col-span-2">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
              />
            </Field>
          </div>

          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {workedMinutes !== null ? (
              <>
                That is{' '}
                <strong className="tabular text-foreground">{formatMinutes(workedMinutes)}</strong>{' '}
                worked, Lagos time.
              </>
            ) : (
              'Times are Lagos time.'
            )}
          </p>

          <Field
            label="Why by hand"
            required
            hint={
              <>
                A dispute will turn on this. &quot;Network&quot; on its own tells nobody anything:
                say what happened and where the times came from. At least 10 characters.
              </>
            }
          >
            <Textarea
              rows={3}
              placeholder='"Network was down all night; taken from the ward paper log."'
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
            <Button
              variant="outline"
              onClick={() => setManualOpen(false)}
              disabled={manual.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={!canRecord}
              loading={manual.isPending}
              onClick={() => manual.mutate()}
            >
              Record it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
