'use client';

import { useState } from 'react';
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History, Receipt, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatMinutes, formatNaira, formatWhen, shortId } from '@/components/app/format';

interface Assignment {
  id: string;
  userId: string;
  status: string;
  startsAt: string;
  endsAt: string;
}

interface Timesheet {
  id: string;
  assignmentId: string;
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
  actorId: string;
  reason: string;
  createdAt: string;
}

const MIN_NOTE = 10;

/**
 * Timesheets waiting on this facility.
 *
 * Only submitted ones are actionable, so the list is the roster filtered by
 * what the attendance record actually says — there is no "timesheets waiting"
 * endpoint, and inventing one would be a second thing to keep true.
 */
export default function TimesheetsPage() {
  const facilityId = useFacilityId();
  const queryClient = useQueryClient();

  const roster = useQueue<Assignment>(
    ['roster-for-timesheets', facilityId],
    `/api/v1/assignments?scopeType=FACILITY&scopeId=${facilityId}&status=CONFIRMED`,
    (body) => (body as { assignments?: Assignment[] }).assignments ?? [],
  );

  const sheets = useQueries({
    queries: (roster.data ?? []).map((row) => ({
      queryKey: ['timesheet', row.id],
      queryFn: () =>
        api.get<{ timesheet: Timesheet; revisions: Revision[] }>(
          `/api/v1/assignments/${row.id}/timesheet?scopeType=FACILITY&scopeId=${facilityId}`,
        ),
      // A confirmed shift with no timesheet yet is the normal case, not an
      // error worth retrying three times per row.
      retry: false,
    })),
  });

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [onCallMinutes, setOnCallMinutes] = useState('0');
  const [correctionReason, setCorrectionReason] = useState('');

  function refresh(assignmentId: string) {
    void queryClient.invalidateQueries({ queryKey: ['timesheet', assignmentId] });
    void queryClient.invalidateQueries({ queryKey: ['tile'] });
  }

  const review = useMutation({
    mutationFn: ({
      assignmentId,
      decision,
    }: {
      assignmentId: string;
      decision: 'approve' | 'reject';
    }) =>
      api.post(`/api/v1/assignments/${assignmentId}/timesheet/review`, {
        facilityId,
        decision,
        reviewNotes: notes[assignmentId]?.trim() || undefined,
      }),
    onSuccess: (_data, variables) => {
      toast.success(
        variables.decision === 'approve'
          ? 'Approved — the shift is now completed'
          : 'Rejected, with your reason on the record',
      );
      refresh(variables.assignmentId);
    },
    onError: (error) => toast.error('That did not work', { description: errorMessage(error) }),
  });

  const correct = useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/api/v1/assignments/${assignmentId}/timesheet/correct`, {
        facilityId,
        breakMinutes: Number(breakMinutes || '0'),
        onCallMinutes: Number(onCallMinutes || '0'),
        reason: correctionReason.trim(),
      }),
    onSuccess: (_data, assignmentId) => {
      toast.success('Corrected', { description: 'The previous figures are kept as a revision.' });
      refresh(assignmentId);
      setCorrecting(null);
      setCorrectionReason('');
    },
    onError: (error) => toast.error('Could not correct it', { description: errorMessage(error) }),
  });

  const withSheets = (roster.data ?? [])
    .map((row, index) => ({ assignment: row, result: sheets[index] }))
    .filter((entry) => entry.result?.data);

  return (
    <>
      <PageHeader
        title="Timesheets"
        description="What each shift came to, at the rate both sides agreed. Approving completes the assignment; rejecting needs a reason, or the practitioner has nothing to correct."
      />

      {roster.isPending ? (
        <QueueSkeleton />
      ) : roster.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>The roster could not be loaded.</AlertDescription>
        </Alert>
      ) : withSheets.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No timesheets yet"
          description="One appears when a practitioner submits the hours for a shift they have checked out of."
        />
      ) : (
        <div className="space-y-4">
          {withSheets.map(({ assignment, result }) => {
            const sheet = result!.data!.timesheet;
            const revisions = result!.data!.revisions;
            const note = notes[assignment.id]?.trim() ?? '';
            const submitted = sheet.attendanceStatus === 'SUBMITTED';

            return (
              <Card key={assignment.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium">{shortId(assignment.userId)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatWhen(assignment.startsAt)}
                      {sheet.revision > 1 ? ` · revision ${sheet.revision}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={sheet.attendanceStatus} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Worked">{formatMinutes(sheet.workedMinutes)}</Detail>
                    <Detail label="Break">{formatMinutes(sheet.breakMinutes)}</Detail>
                    <Detail label="Billable">{formatMinutes(sheet.billableMinutes)}</Detail>
                    <Detail label="Amount">
                      <strong>{formatNaira(sheet.amountKobo)}</strong>
                    </Detail>
                  </DetailGrid>

                  {/* Bands are recorded and carry no premium yet: allowances
                      are module 11, and the 3.1 revenue decision is unmade. */}
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>Night {formatMinutes(sheet.nightMinutes)}</span>
                    <span>Overtime {formatMinutes(sheet.overtimeMinutes)}</span>
                    <span>Holiday {formatMinutes(sheet.holidayMinutes)}</span>
                    <span>On call {formatMinutes(sheet.onCallMinutes)}</span>
                    <span>at {formatNaira(sheet.hourlyRateKobo)}/hour</span>
                  </div>

                  {revisions.length > 0 ? (
                    <details className="rounded-md border px-3 py-2">
                      <summary className="cursor-pointer text-sm text-muted-foreground">
                        <History className="mr-1 inline size-3.5" />
                        {revisions.length} earlier version
                        {revisions.length === 1 ? '' : 's'}, kept
                      </summary>
                      <div className="mt-2 space-y-2">
                        {revisions.map((revision) => (
                          <div key={revision.revision} className="text-xs">
                            <p className="font-medium">
                              Revision {revision.revision} ·{' '}
                              {formatNaira(revision.previous.amountKobo as number)} ·{' '}
                              {formatMinutes(revision.previous.billableMinutes as number)}
                            </p>
                            <p className="text-muted-foreground">{revision.reason}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}

                  {submitted ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`notes-${assignment.id}`}>
                          Reason{' '}
                          <span className="font-normal text-muted-foreground">
                            — required to reject
                          </span>
                        </Label>
                        <Textarea
                          id={`notes-${assignment.id}`}
                          rows={2}
                          placeholder="What is wrong with these hours."
                          value={notes[assignment.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({
                              ...current,
                              [assignment.id]: event.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="success"
                          loading={
                            review.isPending && review.variables?.assignmentId === assignment.id
                          }
                          onClick={() =>
                            review.mutate({ assignmentId: assignment.id, decision: 'approve' })
                          }
                        >
                          Approve {formatNaira(sheet.amountKobo)}
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={note.length < MIN_NOTE || review.isPending}
                          onClick={() =>
                            review.mutate({ assignmentId: assignment.id, decision: 'reject' })
                          }
                        >
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCorrecting(assignment.id);
                            setBreakMinutes(String(sheet.breakMinutes));
                            setOnCallMinutes(String(sheet.onCallMinutes));
                            setCorrectionReason('');
                          }}
                        >
                          Correct the hours
                        </Button>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={correcting !== null} onOpenChange={(next: boolean) => !next && setCorrecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct the hours</DialogTitle>
            <DialogDescription>
              The figures as they stand are written into a revision before anything moves. Nothing
              is overwritten — a correction keeps the value it replaces, with your name and reason
              against it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="correct-break">Unpaid break (minutes)</Label>
              <Input
                id="correct-break"
                type="number"
                min={0}
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correct-oncall">On call (minutes)</Label>
              <Input
                id="correct-oncall"
                type="number"
                min={0}
                value={onCallMinutes}
                onChange={(event) => setOnCallMinutes(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="correct-reason">Why</Label>
            <Textarea
              id="correct-reason"
              rows={2}
              placeholder="Where the corrected figures came from."
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrecting(null)}>
              Cancel
            </Button>
            <Button
              disabled={correctionReason.trim().length < MIN_NOTE}
              loading={correct.isPending}
              onClick={() => correcting && correct.mutate(correcting)}
            >
              Correct it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
