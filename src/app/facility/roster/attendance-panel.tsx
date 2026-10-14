'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, PencilLine, Timer } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { formatWhen } from '@/components/app/format';
import { lagosLocalToInstant } from '@/lib/lagos-date';

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

/**
 * Attendance for one shift, from the ward's side.
 *
 * **The facility issues and the practitioner presents** — that direction is
 * what makes a code evidence of presence rather than proof that somebody owns
 * a phone. So this panel issues; nothing here can check anybody in.
 */
export function AttendancePanel({
  assignmentId,
  facilityId,
  attendance: record,
}: {
  assignmentId: string;
  facilityId: string;
  /**
   * What the roster list already joined onto this row (`include=attendance`);
   * null or absent when nobody has issued a code yet. This panel used to fetch
   * it itself, so a page of fifty shifts made fifty extra requests.
   */
  attendance?: Attendance | null;
}) {
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<{ purpose: string; token: IssuedToken } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [checkedInAt, setCheckedInAt] = useState('');
  const [checkedOutAt, setCheckedOutAt] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [reason, setReason] = useState('');

  const attendance = { data: record ? { attendance: record } : undefined };

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
      setManualOpen(false);
      setReason('');
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
  });

  const status = attendance.data?.attendance.status ?? 'NOT_STARTED';
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        {attendance.data?.attendance.checkedInAt ? (
          <span className="text-xs text-muted-foreground">
            in {formatWhen(attendance.data.attendance.checkedInAt)}
          </span>
        ) : null}
        {attendance.data?.attendance.checkedOutAt ? (
          <span className="text-xs text-muted-foreground">
            · out {formatWhen(attendance.data.attendance.checkedOutAt)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {canCheckIn ? (
          <Button
            size="sm"
            variant="outline"
            loading={issue.isPending && issue.variables === 'CHECK_IN'}
            onClick={() => issue.mutate('CHECK_IN')}
          >
            <KeyRound />
            Code to check in
          </Button>
        ) : null}
        {canCheckOut ? (
          <Button
            size="sm"
            variant="outline"
            loading={issue.isPending && issue.variables === 'CHECK_OUT'}
            onClick={() => issue.mutate('CHECK_OUT')}
          >
            <Timer />
            Code to check out
          </Button>
        ) : null}
        {canRecordByHand ? (
          <Button size="sm" variant="ghost" onClick={() => setManualOpen(true)}>
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
            <DialogTitle>
              Read this to the practitioner
            </DialogTitle>
            <DialogDescription>
              {issued?.purpose === 'CHECK_IN' ? 'Check in' : 'Check out'} · lapses{' '}
              {issued ? formatWhen(issued.token.expiresAt) : ''}
            </DialogDescription>
          </DialogHeader>

          <p className="tabular select-all rounded-lg border bg-muted py-6 text-center text-4xl font-semibold tracking-[0.3em]">
            {issued?.token.code}
          </p>

          <p className="text-xs leading-relaxed text-muted-foreground">
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

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record this shift by hand</DialogTitle>
            <DialogDescription>
              For when the network failed and no code could be exchanged. The record is marked a
              manual correction so nobody later mistakes it for a token-backed check-in.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="in">Checked in</Label>
              <Input
                id="in"
                type="datetime-local"
                value={checkedInAt}
                onChange={(event) => setCheckedInAt(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="out">Checked out</Label>
              <Input
                id="out"
                type="datetime-local"
                value={checkedOutAt}
                onChange={(event) => setCheckedOutAt(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="break">Unpaid break (minutes)</Label>
              <Input
                id="break"
                type="number"
                min={0}
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-reason">
              Why by hand{' '}
              <span className="font-normal text-muted-foreground">
                — required, and a dispute will turn on it
              </span>
            </Label>
            <Textarea
              id="manual-reason"
              rows={2}
              placeholder='"Network was down all night; taken from the ward paper log."'
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <Alert variant="info">
            <AlertDescription>
              &quot;Network&quot; on its own tells nobody anything. Say what happened and where the
              times came from.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!checkedInAt || !checkedOutAt || reason.trim().length < 10}
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
