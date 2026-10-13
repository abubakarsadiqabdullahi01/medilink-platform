'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Gavel, History, ReceiptText, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useQueue } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import {
  Detail,
  DetailGrid,
  EmptyState,
  PageHeader,
  QueueSkeleton,
} from '@/components/app/page-shell';
import { formatMinutes, formatNaira, formatWhen } from '@/components/app/format';

interface Assignment {
  id: string;
  facilityId: string;
  facilityName: string;
  status: string;
  startsAt: string;
  endsAt: string;
  /** Joined by `include=timesheet`; null for a shift with nothing worked yet. */
  sheet?: { timesheet: Timesheet; revisions: Revision[] } | null;
}

interface Timesheet {
  id: string;
  attendanceStatus: string;
  workedMinutes: number;
  breakMinutes: number;
  billableMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  onCallMinutes: number;
  hourlyRateKobo: number;
  amountKobo: number;
  revision: number;
}

interface Revision {
  revision: number;
  previous: Record<string, unknown>;
  reason: string;
}

const CATEGORIES = [
  ['HOURS', 'The hours are wrong'],
  ['PAY', 'The hours are right and the money is not'],
  ['NON_ATTENDANCE', 'The shift did not happen as agreed'],
  ['CONDUCT', 'Conduct'],
  ['OTHER', 'Something else'],
] as const;

const MIN_REASON = 20;

/**
 * The practitioner's side of a timesheet: submit it, then live with what the
 * facility decides — or dispute it.
 *
 * Disputing is offered on the same card as the outcome rather than buried in
 * a help page. A decision you cannot contest from where you read it is one
 * most people will not contest at all.
 */
export default function MyTimesheetsPage() {
  const queryClient = useQueryClient();

  const shifts = useQueue<Assignment>(
    ['my-assignments-for-timesheets'],
    // The timesheet and its revisions arrive with each shift: one request for the
    // page, where it used to be one more for every shift ever worked.
    '/api/v1/assignments?scopeType=SELF&include=timesheet',
    (body) => (body as { assignments?: Assignment[] }).assignments ?? [],
  );

  const [disputing, setDisputing] = useState<Assignment | null>(null);
  const [category, setCategory] = useState('HOURS');
  const [reason, setReason] = useState('');

  const submit = useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/api/v1/assignments/${assignmentId}/timesheet/submit`),
    onSuccess: () => {
      toast.success('Submitted', { description: 'The facility decides next.' });
      void queryClient.invalidateQueries({ queryKey: ['my-assignments-for-timesheets'] });
    },
    onError: (error) => toast.error('Could not submit', { description: errorMessage(error) }),
  });

  const dispute = useMutation({
    mutationFn: (assignment: Assignment) =>
      api.post(`/api/v1/assignments/${assignment.id}/disputes`, {
        category,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Dispute opened', {
        description: 'An officer will look at it. The shift is on hold until they decide.',
      });
      void queryClient.invalidateQueries({ queryKey: ['my-assignments-for-timesheets'] });
      setDisputing(null);
      setReason('');
    },
    onError: (error) => toast.error('Could not open it', { description: errorMessage(error) }),
  });

  const withSheets = (shifts.data ?? [])
    .filter((row) => row.sheet)
    .map((row) => ({ assignment: row, data: row.sheet! }));

  const checkedOut = (shifts.data ?? []).filter((row) => {
    const status = row.sheet?.timesheet.attendanceStatus;
    return status === 'CHECKED_OUT' || status === 'MANUALLY_CORRECTED';
  });

  return (
    <>
      <PageHeader
        title="Timesheets"
        description="What each shift came to, at the rate agreed when it was offered. Submit yours and the facility approves or asks you to correct it."
      />

      {checkedOut.length > 0 ? (
        <Alert className="mb-6" variant="info">
          <ReceiptText />
          <AlertDescription>
            {checkedOut.length} shift{checkedOut.length === 1 ? '' : 's'} ready to submit. Nothing
            is paid until you do.
          </AlertDescription>
        </Alert>
      ) : null}

      {shifts.isPending ? (
        <QueueSkeleton />
      ) : shifts.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Your timesheets could not be loaded.</AlertDescription>
        </Alert>
      ) : withSheets.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title="No timesheets yet"
          description="One is worked out for you as soon as you check out of a shift."
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {withSheets.map(({ assignment, data }) => {
            const sheet = data!.timesheet;
            const revisions = data!.revisions;
            const canSubmit = ['CHECKED_OUT', 'MANUALLY_CORRECTED', 'REJECTED'].includes(
              sheet.attendanceStatus,
            );
            const decided = ['APPROVED', 'REJECTED'].includes(sheet.attendanceStatus);

            return (
              <Card key={assignment.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-medium">{formatWhen(assignment.startsAt)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {assignment.facilityName}
                    </p>
                    {sheet.revision > 1 ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        revision {sheet.revision}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge status={sheet.attendanceStatus} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Worked">{formatMinutes(sheet.workedMinutes)}</Detail>
                    <Detail label="Break">{formatMinutes(sheet.breakMinutes)}</Detail>
                    <Detail label="Billable">{formatMinutes(sheet.billableMinutes)}</Detail>
                    {/* Not "you are owed": this is the timesheet at the base
                        rate, and what is actually credited is priced against
                        the facility's rate card when the shift is invoiced. */}
                    <Detail label="At the agreed rate">
                      <strong>{formatNaira(sheet.amountKobo)}</strong>
                    </Detail>
                  </DetailGrid>

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>Night {formatMinutes(sheet.nightMinutes)}</span>
                    <span>Overtime {formatMinutes(sheet.overtimeMinutes)}</span>
                    <span>Holiday {formatMinutes(sheet.holidayMinutes)}</span>
                    <span>at {formatNaira(sheet.hourlyRateKobo)}/hour</span>
                  </div>

                  {/* Said plainly, because a practitioner reading a night
                      figure will reasonably expect it to be worth more. */}
                  {sheet.nightMinutes > 0 || sheet.holidayMinutes > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Night and holiday hours are priced against the facility&rsquo;s rate card when
                      the shift is invoiced. A facility that has not set one pays them at the
                      ordinary rate.
                    </p>
                  ) : null}

                  {revisions.length > 0 ? (
                    <details className="rounded-md border px-3 py-2">
                      <summary className="cursor-pointer text-sm text-muted-foreground">
                        <History className="mr-1 inline size-3.5" />
                        {revisions.length} earlier version{revisions.length === 1 ? '' : 's'}, kept
                      </summary>
                      <div className="mt-2 space-y-2">
                        {revisions.map((revision) => (
                          <div key={revision.revision} className="text-xs">
                            <p className="font-medium">
                              Was {formatNaira(revision.previous.amountKobo as number)} ·{' '}
                              {formatMinutes(revision.previous.billableMinutes as number)}
                            </p>
                            <p className="text-muted-foreground">{revision.reason}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}

                  {canSubmit || decided ? <Separator /> : null}

                  <div className="flex flex-wrap gap-2">
                    {canSubmit ? (
                      <Button
                        loading={submit.isPending && submit.variables === assignment.id}
                        onClick={() => submit.mutate(assignment.id)}
                      >
                        Submit {formatNaira(sheet.amountKobo)}
                      </Button>
                    ) : null}

                    {decided ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setDisputing(assignment);
                          setReason('');
                        }}
                      >
                        <Gavel />
                        Dispute this
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={disputing !== null}
        onOpenChange={(next: boolean) => !next && setDisputing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispute this shift</DialogTitle>
            <DialogDescription>
              An officer at the platform decides, not the facility. You have fourteen days from
              their decision, and the shift is held until yours is resolved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>What is wrong</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispute-reason">In your words</Label>
            <Textarea
              id="dispute-reason"
              rows={4}
              placeholder="What happened, and what the record should say instead."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {reason.length > 0 && reason.trim().length < MIN_REASON ? (
              <p className="text-xs text-muted-foreground">
                {MIN_REASON - reason.trim().length} more characters needed.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputing(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < MIN_REASON}
              loading={dispute.isPending}
              onClick={() => disputing && dispute.mutate(disputing)}
            >
              Open the dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
