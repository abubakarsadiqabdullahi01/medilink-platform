'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clock,
  Gavel,
  KeyRound,
  LogIn,
  LogOut,
  ReceiptText,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import {
  attendanceState,
  type AttendanceKey,
  type AttendanceTone,
} from '@/lib/ui/attendance-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/app/field';
import { formatClock } from '@/components/app/format';

export interface Attendance {
  id: string;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

const ICON: Record<AttendanceKey, LucideIcon> = {
  'opens-later': Clock,
  'check-in-open': KeyRound,
  late: TriangleAlert,
  unattended: CircleAlert,
  'checked-in': CircleDot,
  'check-out-due': TriangleAlert,
  'checked-out': ReceiptText,
  submitted: Send,
  approved: CircleCheck,
  rejected: CircleAlert,
  disputed: Gavel,
};

const TONE: Record<AttendanceTone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-info',
  warning: 'text-warning',
  success: 'text-success',
};

/**
 * Presenting the code the ward read out.
 *
 * One field for both renderings — six digits typed, or a whole scanned payload pasted — because
 * they are the same secret and the service tells them apart. Two inputs would imply two systems.
 *
 * Above the field, one line says where the shift stands in words and with a mark — can I check in
 * yet, am I late, am I on shift, have the hours gone — so the state never rests on a colour and
 * the next step is never a guess. The box itself appears only when a code can be used: the ward
 * reads it out at the desk, so nobody can use one days ahead, and a list of next week's shifts
 * each with an empty code box and a Check in button reads as though they should.
 */
export function CheckInPanel({
  assignmentId,
  startsAt,
  endsAt,
  attendance: record,
  now,
}: {
  assignmentId: string;
  startsAt: string;
  endsAt: string;
  /** Joined onto the shift by the list (`include=attendance`); null until a code has been issued. */
  attendance?: Attendance | null;
  now: Date;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const present = useMutation({
    mutationFn: (purpose: 'CHECK_IN' | 'CHECK_OUT') =>
      api.post(`/api/v1/assignments/${assignmentId}/attendance/present`, {
        purpose,
        code: code.trim(),
      }),
    onSuccess: (_data, purpose) => {
      toast.success(purpose === 'CHECK_IN' ? 'Checked in' : 'Checked out');
      setCode('');
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey: ['my-shifts'] });
      void queryClient.invalidateQueries({ queryKey: ['my-assignments-for-timesheets'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
    // The code stays in the box: a mistyped digit is corrected, not typed again from nothing.
    onError: (error) => {
      setFailure(errorMessage(error));
      toast.error('That code did not work', { description: errorMessage(error) });
    },
  });

  const state = attendanceState({ status: record?.status, startsAt, endsAt, now });
  const Icon = ICON[state.key];
  const checkingIn = record?.status !== 'CHECKED_IN';
  const canPresent =
    state.key === 'check-in-open' ||
    state.key === 'late' ||
    state.key === 'checked-in' ||
    state.key === 'check-out-due';

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 size-5 shrink-0 ${TONE[state.tone]}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium leading-snug">{state.label}</p>
          <p className="text-sm text-muted-foreground">{state.detail}</p>
          {record?.checkedInAt ? (
            <p className="tabular mt-0.5 text-sm text-muted-foreground">
              <span>in {formatClock(record.checkedInAt)}</span>
              {record.checkedOutAt ? <span> · out {formatClock(record.checkedOutAt)}</span> : null}
            </p>
          ) : null}
        </div>
      </div>

      {state.key === 'checked-out' || state.key === 'rejected' ? (
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/practitioner/timesheets">
            {state.key === 'rejected' ? 'See why, and send again' : 'Send your hours'}
          </Link>
        </Button>
      ) : null}

      {canPresent ? (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim().length >= 6) present.mutate(checkingIn ? 'CHECK_IN' : 'CHECK_OUT');
          }}
        >
          <Field
            label="Code from the ward"
            hint="Six digits the ward reads out, or a scanned QR. Five minutes, five attempts — ask them to read it again if it lapses."
            error={failure ?? undefined}
          >
            <Input
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setFailure(null);
              }}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="tabular tracking-widest"
            />
          </Field>
          <Button
            type="submit"
            disabled={code.trim().length < 6}
            loading={present.isPending}
            className="w-full sm:w-auto"
          >
            {checkingIn ? <LogIn /> : <LogOut />}
            {checkingIn ? 'Check in' : 'Check out'}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
