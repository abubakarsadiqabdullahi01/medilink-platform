'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, History, ReceiptText, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import {
  Detail,
  DetailGrid,
  EmptyState,
  PageHeader,
  QueueSkeleton,
} from '@/components/app/page-shell';
import { formatMinutes, formatNaira, formatWhen, toLocalInput } from '@/components/app/format';

interface Assignment {
  id: string;
  userId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  practitionerName: string;
  practitionerPhone: string;
  /** Joined by `include=timesheet`; null for a shift with nothing worked yet. */
  sheet?: { timesheet: Timesheet; revisions: Revision[] } | null;
}

const PAGE_SIZE = 50;

const TABS = [
  { key: 'CONFIRMED', label: 'Awaiting decision' },
  { key: 'COMPLETED', label: 'Approved' },
] as const;

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
  /** The hours at the base rate. */
  amountKobo: number;
  /** What the shift will be billed, allowances included: what Approve commits to. */
  billedKobo: number;
  premiumKobo: number;
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
 *
 * Approving a timesheet is what finally moves its assignment to `COMPLETED`
 * — and this page used to read the roster at `status=CONFIRMED` only, so the
 * moment a decision was made, the row it belonged to vanished with no way
 * back to it. The "approved" tab reads the same roster at `status=COMPLETED`
 * instead, purely read-only, so what was decided stays reachable.
 *
 * A free-text search asks the reader to already know a name or number to
 * type. A facility's roster is small enough to just list, so the picker
 * below is built from whoever is actually on the page rather than typed.
 */
export default function TimesheetsPage() {
  const facilityId = useFacilityId();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('CONFIRMED');
  const [practitionerId, setPractitionerId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  /**
   * Paged, the same way Shifts is. This asked for fifty rows, ignored the
   * `nextCursor` the endpoint handed back and labelled the result "50 shown" —
   * so the approved tab at a busy hospital showed the oldest fifty of a couple
   * of hundred and offered no way to reach the rest. A truncation that says
   * nothing reads exactly like a complete list.
   */
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const roster = useQuery({
    queryKey: ['roster-for-timesheets', facilityId, tab, from, to, cursor],
    queryFn: () => {
      const parts = [
        'scopeType=FACILITY',
        `scopeId=${facilityId}`,
        `status=${tab}`,
        // The timesheet and its revisions arrive with each row: one request for
        // the page, not one per shift.
        'include=timesheet',
        `limit=${PAGE_SIZE}`,
        from ? `from=${from}` : '',
        to ? `to=${to}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ assignments?: Assignment[]; nextCursor?: string | null }>(
        `/api/v1/assignments?${parts.join('&')}`,
      );
    },
    select: (body) => ({ rows: body.assignments ?? [], nextCursor: body.nextCursor ?? null }),
  });

  const rosterRows = roster.data?.rows ?? [];
  const nextCursor = roster.data?.nextCursor ?? null;

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [onCallMinutes, setOnCallMinutes] = useState('0');
  const [correctionReason, setCorrectionReason] = useState('');
  // The times as recorded, so only a time somebody actually changed is sent.
  // The dialog used to offer break and on-call only, so a check-out recorded
  // an hour early could be disputed and upheld and still not be corrected.
  const [checkedIn, setCheckedIn] = useState('');
  const [checkedOut, setCheckedOut] = useState('');
  const [recordedTimes, setRecordedTimes] = useState({ in: '', out: '' });

  async function openCorrection(assignmentId: string, sheet: { breakMinutes: number; onCallMinutes: number }) {
    setCorrecting(assignmentId);
    setBreakMinutes(String(sheet.breakMinutes));
    setOnCallMinutes(String(sheet.onCallMinutes));
    setCorrectionReason('');
    setCheckedIn('');
    setCheckedOut('');
    setRecordedTimes({ in: '', out: '' });
    try {
      const body = await api.get<{ attendance: { checkedInAt: string | null; checkedOutAt: string | null } }>(
        `/api/v1/assignments/${assignmentId}/attendance?scopeType=FACILITY&scopeId=${facilityId}`,
      );
      const times = {
        in: toLocalInput(body.attendance.checkedInAt),
        out: toLocalInput(body.attendance.checkedOutAt),
      };
      setRecordedTimes(times);
      setCheckedIn(times.in);
      setCheckedOut(times.out);
    } catch {
      // Without the recorded times the fields stay empty and nothing is sent
      // for them; break and on call still correct as before.
    }
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['roster-for-timesheets'] });
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
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['roster-for-timesheets'] });
    },
    onError: (error) => toast.error('That did not work', { description: errorMessage(error) }),
  });

  const correct = useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/api/v1/assignments/${assignmentId}/timesheet/correct`, {
        facilityId,
        breakMinutes: Number(breakMinutes || '0'),
        onCallMinutes: Number(onCallMinutes || '0'),
        checkedInAt:
          checkedIn && checkedIn !== recordedTimes.in ? new Date(checkedIn).toISOString() : undefined,
        checkedOutAt:
          checkedOut && checkedOut !== recordedTimes.out ? new Date(checkedOut).toISOString() : undefined,
        reason: correctionReason.trim(),
      }),
    onSuccess: () => {
      toast.success('Corrected', { description: 'The previous figures are kept as a revision.' });
      refresh();
      setCorrecting(null);
      setCorrectionReason('');
    },
    onError: (error) => toast.error('Could not correct it', { description: errorMessage(error) }),
  });

  // A shift with no timesheet yet is the normal case for a confirmed one, and is
  // simply left out; the rest already carry theirs.
  const withSheets = rosterRows
    .filter((row) => row.sheet)
    .map((row) => ({ assignment: row, result: { data: row.sheet! } }));

  // Only the first request: the rows arrive with their timesheets, so there is no
  // second wave to wait for and "no timesheets" can be said as soon as it is known.
  const settling = roster.isPending;

  // Built from whoever is actually on this tab's page, not typed — a
  // facility's roster is small enough to pick from rather than search.
  const practitioners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const { assignment } of withSheets) {
      if (!seen.has(assignment.userId)) seen.set(assignment.userId, assignment.practitionerName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [withSheets]);

  const visible =
    practitionerId === 'all'
      ? withSheets
      : withSheets.filter((entry) => entry.assignment.userId === practitionerId);

  const filtered = practitionerId !== 'all' || Boolean(from) || Boolean(to);

  function clearFilters() {
    setPractitionerId('all');
    setFrom('');
    setTo('');
    startOver();
  }

  return (
    <>
      <PageHeader
        title="Timesheets"
        description="What each shift came to, at the rate both sides agreed. Approving completes the assignment; rejecting needs a reason, or the practitioner has nothing to correct."
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as (typeof TABS)[number]['key']);
          setPractitionerId('all');
          startOver();
        }}
        className="mb-5"
      >
        <TabsList>
          {TABS.map((entry) => (
            <TabsTrigger key={entry.key} value={entry.key}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-[220px] space-y-1.5">
            <Label>Practitioner</Label>
            <Select value={practitionerId} onValueChange={setPractitionerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {practitioners.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timesheet-from">Starts after</Label>
            <Input
              id="timesheet-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                startOver();
              }}
              className="w-40"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timesheet-to">Starts before</Label>
            <Input
              id="timesheet-to"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                startOver();
              }}
              className="w-40"
            />
          </div>

          {filtered ? (
            <Button type="button" variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}

          {!roster.isPending && visible.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {visible.length} shown
              {nextCursor ? ' · more on the next page' : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {roster.isPending || settling ? (
        <QueueSkeleton />
      ) : roster.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>The roster could not be loaded.</AlertDescription>
        </Alert>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title={
            filtered
              ? 'Nothing matches that'
              : tab === 'COMPLETED'
                ? 'Nothing approved yet'
                : 'No timesheets yet'
          }
          description={
            filtered
              ? 'Try a different practitioner, or a wider date range.'
              : tab === 'COMPLETED'
                ? 'Approve one from "awaiting decision" and it appears here.'
                : 'One appears when a practitioner submits the hours for a shift they have checked out of.'
          }
        />
      ) : (
        <div className="space-y-4">
          {visible.map(({ assignment, result }) => {
            const sheet = result!.data!.timesheet;
            const revisions = result!.data!.revisions;
            const note = notes[assignment.id]?.trim() ?? '';
            const submitted = sheet.attendanceStatus === 'SUBMITTED';

            return (
              <Card key={assignment.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{assignment.practitionerName}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {assignment.practitionerPhone}
                    </p>
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
                    <Detail label="To be billed">
                      <strong>{formatNaira(sheet.billedKobo)}</strong>
                    </Detail>
                  </DetailGrid>

                  {/* Approving commits to the billed figure, so that is what is
                      shown: the hours at the base rate plus the allowances this
                      facility's own rate card adds. Showing the base amount
                      alone had the invoice come to more than was approved. */}
                  {sheet.premiumKobo > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {formatNaira(sheet.amountKobo)} for the hours, plus{' '}
                      {formatNaira(sheet.premiumKobo)} in night, holiday and overtime allowances from
                      your rate card.
                    </p>
                  ) : null}
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
                          Approve {formatNaira(sheet.billedKobo)}
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
                          onClick={() => void openCorrection(assignment.id, sheet)}
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

      {rosterRows.length > 0 && (pageIndex > 0 || nextCursor) ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pageIndex === 0 || roster.isFetching}
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
          >
            <ChevronLeft />
            Previous
          </Button>

          <p className="tabular text-xs text-muted-foreground">
            Page {pageIndex + 1}
            {roster.isFetching ? ' · loading' : ''}
          </p>

          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor || roster.isFetching}
            onClick={() => {
              if (!nextCursor) return;
              setCursors((current) => {
                const next = current.slice(0, pageIndex + 1);
                next.push(nextCursor);
                return next;
              });
              setPageIndex((index) => index + 1);
            }}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      ) : null}

      <Dialog
        open={correcting !== null}
        onOpenChange={(next: boolean) => !next && setCorrecting(null)}
      >
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
              <Label htmlFor="correct-in">Checked in</Label>
              <Input
                id="correct-in"
                type="datetime-local"
                value={checkedIn}
                onChange={(event) => setCheckedIn(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correct-out">Checked out</Label>
              <Input
                id="correct-out"
                type="datetime-local"
                value={checkedOut}
                onChange={(event) => setCheckedOut(event.target.value)}
              />
            </div>
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
