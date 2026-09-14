'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogIn, LogOut } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/app/status-badge';
import { formatWhen } from '@/components/app/format';

interface Attendance {
  id: string;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

/**
 * Presenting the code the ward read out.
 *
 * One field for both renderings — six digits typed, or a whole scanned
 * payload pasted — because they are the same secret and the service tells
 * them apart. Two inputs would imply two systems.
 */
export function CheckInPanel({ assignmentId }: { assignmentId: string }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');

  const attendance = useQuery({
    queryKey: ['my-attendance', assignmentId],
    queryFn: () =>
      api.get<{ attendance: Attendance }>(
        `/api/v1/assignments/${assignmentId}/attendance?scopeType=SELF`,
      ),
    retry: false,
  });

  const present = useMutation({
    mutationFn: (purpose: 'CHECK_IN' | 'CHECK_OUT') =>
      api.post(`/api/v1/assignments/${assignmentId}/attendance/present`, {
        purpose,
        code: code.trim(),
      }),
    onSuccess: (_data, purpose) => {
      toast.success(purpose === 'CHECK_IN' ? 'Checked in' : 'Checked out');
      setCode('');
      void queryClient.invalidateQueries({ queryKey: ['my-attendance', assignmentId] });
      void queryClient.invalidateQueries({ queryKey: ['my-timesheets'] });
    },
    onError: (error) => toast.error('That code did not work', { description: errorMessage(error) }),
  });

  const status = attendance.data?.attendance.status ?? 'NOT_STARTED';
  const checkingIn = status !== 'CHECKED_IN';
  const finished = ['CHECKED_OUT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(status);

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

      {finished ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <Label htmlFor={`code-${assignmentId}`}>
              Code from the ward{' '}
              <span className="font-normal text-muted-foreground">— or a scanned QR</span>
            </Label>
            <Input
              id={`code-${assignmentId}`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="tabular tracking-widest"
            />
          </div>
          <Button
            disabled={code.trim().length < 6}
            loading={present.isPending}
            onClick={() => present.mutate(checkingIn ? 'CHECK_IN' : 'CHECK_OUT')}
          >
            {checkingIn ? <LogIn /> : <LogOut />}
            {checkingIn ? 'Check in' : 'Check out'}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The ward issues the code; you present it. Five minutes, five attempts — ask them to read it
        again if it lapses.
      </p>
    </div>
  );
}
