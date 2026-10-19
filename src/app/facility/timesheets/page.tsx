'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ReceiptText } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { useFacilityId } from '@/lib/ui/facility';
import { lagosLocalToInstant } from '@/lib/lagos-date';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { Money } from '@/components/app/money';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { Timeline, type TimelineStep } from '@/components/app/timeline';
import {
  formatClock,
  formatMinutes,
  formatNaira,
  formatShiftWindow,
  formatWhen,
  toLocalInput,
} from '@/components/app/format';
import type { Attendance } from '../roster/attendance-panel';
import { changedHours, earlierFigures, spansDays, type RevisionView } from './timesheet-view';

interface Assignment {
  id: string;
  userId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  practitionerName: string;
  practitionerPhone: string;
  /** Joined by `include=attendance`: the times the ward and the practitioner agreed on. */
  attendance?: Attendance | null;
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

type Revision = RevisionView & { actorId: string };

/** One timesheet on this page, with the shift it belongs to. */
interface Row {
  assignment: Assignment;
  sheet: Timesheet;
  revisions: Revision[];
}

const MIN_NOTE = 10;
/** A time typed into a correction is one that has happened, give or take a watch (ATT-04). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** What each state that is not yet decidable is waiting for, in the ward's words. */
const WAITING_FOR_PRACTITIONER = new Set(['CHECKED_OUT', 'MANUALLY_CORRECTED', 'REJECTED']);

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
 * Each row carries what a decision turns on — the shift as scheduled, the times as recorded, the
 * hours, and the figure that will be billed — and the buttons that decide it. Approving commits
 * money and cannot be taken back from here; rejecting sends the hours back and is not. Both ask,
 * naming the practitioner and the shift, and say what happens next. Everything else (the night
 * and overtime split, the allowances, the earlier versions) is one tap away in "Details" rather
 * than printed on every row.
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
  const pager = useCursorPager();

  const roster = useQuery({
    queryKey: ['roster-for-timesheets', facilityId, tab, from, to, pager.cursor],
    queryFn: () => {
      const parts = [
        'scopeType=FACILITY',
        `scopeId=${facilityId}`,
        `status=${tab}`,
        // The timesheet and its revisions arrive with each row, and so do the recorded times:
        // one request for the page, not one per shift.
        'include=timesheet,attendance,contact',
        `limit=${PAGE_SIZE}`,
        from ? `from=${from}` : '',
        to ? `to=${to}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ assignments?: Assignment[]; nextCursor?: string | null }>(
        `/api/v1/assignments?${parts.join('&')}`,
      );
    },
    enabled: Boolean(facilityId),
    select: (body) => ({ rows: body.assignments ?? [], nextCursor: body.nextCursor ?? null }),
    // Rows stay on screen while a filter or page is fetched, but never from the other tab.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === tab ? previous : undefined,
  });

  const nextCursor = roster.data?.nextCursor ?? null;

  // A shift with no timesheet yet is the normal case for a confirmed one, and is
  // simply left out; the rest already carry theirs.
  const withSheets = useMemo<Row[]>(
    () =>
      (roster.data?.rows ?? [])
        .filter((row) => row.sheet)
        .map((row) => ({
          assignment: row,
          sheet: row.sheet!.timesheet,
          revisions: row.sheet!.revisions,
        })),
    [roster.data],
  );

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

  const rows =
    practitionerId === 'all'
      ? withSheets
      : withSheets.filter((entry) => entry.assignment.userId === practitionerId);

  const activeCount = (practitionerId !== 'all' ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);

  function clearFilters() {
    setPractitionerId('all');
    setFrom('');
    setTo('');
    pager.startOver();
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['roster-for-timesheets'] });
    void queryClient.invalidateQueries({ queryKey: ['tile'] });
  }

  // --- Deciding ---------------------------------------------------------------------------
  // Held by id, not by row, so the dialog always shows the figures as they are on file now: if a
  // refetch after a refused approval brings a new revision, the dialog says so instead of
  // describing a sheet that no longer exists.
  const [deciding, setDeciding] = useState<{ kind: 'approve' | 'reject'; id: string } | null>(null);
  const [note, setNote] = useState('');
  const decidingRow = deciding
    ? withSheets.find((entry) => entry.assignment.id === deciding.id)
    : undefined;

  function startDeciding(kind: 'approve' | 'reject', id: string) {
    setNote('');
    setDeciding({ kind, id });
  }

  const review = useMutation({
    mutationFn: ({
      assignmentId,
      decision,
      seenRevision,
      reviewNotes,
    }: {
      assignmentId: string;
      decision: 'approve' | 'reject';
      /** The revision on screen, so an approval is of the figures that were shown. */
      seenRevision?: number;
      reviewNotes?: string;
    }) =>
      api.post(`/api/v1/assignments/${assignmentId}/timesheet/review`, {
        facilityId,
        decision,
        reviewNotes: reviewNotes?.trim() || undefined,
        seenRevision,
      }),
    onSuccess: (_data, variables) => {
      toast.success(
        variables.decision === 'approve'
          ? 'Approved — the shift is now completed'
          : 'Rejected, with your reason on the record',
      );
      refresh();
    },
    onError: (error) => {
      // Whatever went wrong, the figures on screen may no longer be the ones on file (they were
      // worked out again when the calendar changed): show the ones that are.
      refresh();
      toast.error('That did not work', { description: errorMessage(error) });
    },
  });

  // --- Correcting -------------------------------------------------------------------------
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
  const [timesState, setTimesState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const correctingRow = correcting
    ? withSheets.find((entry) => entry.assignment.id === correcting)
    : undefined;

  async function openCorrection(
    assignmentId: string,
    sheet: { breakMinutes: number; onCallMinutes: number },
  ) {
    setCorrecting(assignmentId);
    setBreakMinutes(String(sheet.breakMinutes));
    setOnCallMinutes(String(sheet.onCallMinutes));
    setCorrectionReason('');
    setCheckedIn('');
    setCheckedOut('');
    setRecordedTimes({ in: '', out: '' });
    setTimesState('loading');
    try {
      const body = await api.get<{
        attendance: { checkedInAt: string | null; checkedOutAt: string | null };
      }>(`/api/v1/assignments/${assignmentId}/attendance?scopeType=FACILITY&scopeId=${facilityId}`);
      const times = {
        in: toLocalInput(body.attendance.checkedInAt),
        out: toLocalInput(body.attendance.checkedOutAt),
      };
      setRecordedTimes(times);
      setCheckedIn(times.in);
      setCheckedOut(times.out);
      setTimesState('ready');
    } catch {
      // Without the recorded times the fields stay empty and nothing is sent
      // for them; break and on call still correct as before. Said, not silent.
      setTimesState('failed');
    }
  }

  const correct = useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/api/v1/assignments/${assignmentId}/timesheet/correct`, {
        facilityId,
        breakMinutes: Number(breakMinutes || '0'),
        onCallMinutes: Number(onCallMinutes || '0'),
        checkedInAt:
          checkedIn && checkedIn !== recordedTimes.in
            ? lagosLocalToInstant(checkedIn).toISOString()
            : undefined,
        checkedOutAt:
          checkedOut && checkedOut !== recordedTimes.out
            ? lagosLocalToInstant(checkedOut).toISOString()
            : undefined,
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

  const limit = Date.now() + FUTURE_TOLERANCE_MS;
  const inMs = checkedIn ? lagosLocalToInstant(checkedIn).getTime() : null;
  const outMs = checkedOut ? lagosLocalToInstant(checkedOut).getTime() : null;
  const inError =
    checkedIn && checkedIn !== recordedTimes.in && inMs !== null && inMs > limit
      ? 'That time has not happened yet.'
      : undefined;
  const outError =
    checkedOut && checkedOut !== recordedTimes.out && outMs !== null && outMs > limit
      ? 'That time has not happened yet.'
      : inMs !== null && outMs !== null && outMs <= inMs
        ? 'Checked out must be after checked in.'
        : undefined;
  const wholeMinutes = (value: string) => {
    const number = Number(value || '0');
    return Number.isInteger(number) && number >= 0;
  };
  const breakError = wholeMinutes(breakMinutes)
    ? undefined
    : 'Enter a whole number of minutes, or 0.';
  const onCallError = wholeMinutes(onCallMinutes)
    ? undefined
    : 'Enter a whole number of minutes, or 0.';
  const canCorrect =
    correctionReason.trim().length >= MIN_NOTE &&
    !inError &&
    !outError &&
    !breakError &&
    !onCallError &&
    timesState !== 'loading';

  // --- Details ----------------------------------------------------------------------------
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailRow = detailId
    ? withSheets.find((entry) => entry.assignment.id === detailId)
    : undefined;

  const describe = ({ assignment }: Row) =>
    `${assignment.practitionerName}, ${formatShiftWindow(assignment.startsAt, assignment.endsAt)}`;

  // --- The list ---------------------------------------------------------------------------
  const columns: Column<Row>[] = [
    {
      id: 'practitioner',
      header: 'Practitioner',
      role: 'identity',
      cell: ({ assignment, sheet }) => (
        <>
          <span className="block font-medium">{assignment.practitionerName}</span>
          {assignment.practitionerPhone ? (
            <span className="block font-mono text-sm font-normal text-muted-foreground">
              {assignment.practitionerPhone}
            </span>
          ) : null}
          {sheet.revision > 1 ? (
            <span className="block text-sm font-normal text-muted-foreground">
              Version {sheet.revision}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'shift',
      header: 'Shift as scheduled',
      cell: ({ assignment }) => formatShiftWindow(assignment.startsAt, assignment.endsAt),
    },
    {
      id: 'recorded',
      header: 'Checked in and out',
      cell: ({ assignment }) => {
        const record = assignment.attendance;
        if (!record?.checkedInAt && !record?.checkedOutAt) {
          return <span className="text-muted-foreground">No times recorded</span>;
        }
        return (
          <span className="tabular">
            {record?.checkedInAt ? formatClock(record.checkedInAt) : '—'}
            {' – '}
            {record?.checkedOutAt ? formatClock(record.checkedOutAt) : 'not out'}
            {spansDays(record?.checkedInAt ?? null, record?.checkedOutAt ?? null)
              ? ' (next day)'
              : ''}
          </span>
        );
      },
    },
    {
      id: 'hours',
      header: 'Hours',
      cell: ({ sheet, revisions }) => {
        const changed = changedHours(sheet, revisions);
        return (
          <>
            <span className="block">{formatMinutes(sheet.workedMinutes)} worked</span>
            <span className="block text-sm text-muted-foreground">
              {formatMinutes(sheet.billableMinutes)} billable
              {sheet.breakMinutes > 0 ? ` · ${sheet.breakMinutes} min break` : ''}
            </span>
            {changed ? (
              <span className="block text-sm text-muted-foreground">
                First worked out as {formatMinutes(changed.from)}
              </span>
            ) : null}
          </>
        );
      },
    },
    {
      id: 'billed',
      header: 'To be billed',
      align: 'right',
      numeric: true,
      cell: ({ sheet }) => (
        <>
          <Money kobo={sheet.billedKobo} strong />
          {sheet.premiumKobo > 0 ? (
            <span className="block text-sm font-normal text-muted-foreground">
              {formatNaira(sheet.amountKobo)} + {formatNaira(sheet.premiumKobo)} allowances
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      role: 'status',
      cell: ({ sheet }) => <StatusBadge status={sheet.attendanceStatus} />,
    },
  ];

  const actions = (row: Row): ReactNode => {
    const { assignment, sheet } = row;
    const submitted = sheet.attendanceStatus === 'SUBMITTED';
    return (
      <div className="flex flex-col gap-2 md:min-w-[11rem]">
        {submitted ? (
          <>
            <Button
              variant="success"
              aria-label={`Approve ${formatNaira(sheet.billedKobo)} for ${describe(row)}`}
              onClick={() => startDeciding('approve', assignment.id)}
            >
              Approve {formatNaira(sheet.billedKobo)}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                aria-label={`Reject the timesheet of ${describe(row)}`}
                onClick={() => startDeciding('reject', assignment.id)}
              >
                Reject
              </Button>
              <Button
                variant="outline"
                aria-label={`Correct the hours of ${describe(row)}`}
                onClick={() => void openCorrection(assignment.id, sheet)}
              >
                Correct
              </Button>
            </div>
          </>
        ) : WAITING_FOR_PRACTITIONER.has(sheet.attendanceStatus) ? (
          <p className="text-sm leading-snug text-muted-foreground md:text-right">
            Waiting for {assignment.practitionerName.split(' ')[0]} to submit it.
          </p>
        ) : null}
        <Button
          variant={submitted ? 'ghost' : 'outline'}
          aria-label={`Details of the timesheet of ${describe(row)}`}
          onClick={() => setDetailId(assignment.id)}
        >
          Details
        </Button>
      </div>
    );
  };

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
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Timesheet status">
          {TABS.map((entry) => (
            <TabsTrigger key={entry.key} value={entry.key}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        activeCount={activeCount}
        onClear={clearFilters}
        busy={roster.isFetching && !roster.isPending}
        summary={
          !roster.isPending && rows.length > 0
            ? `${rows.length} on this page${nextCursor ? ' · more on the next page' : ''}`
            : undefined
        }
      >
        <Field label="Practitioner" className="md:min-w-[14rem]">
          {(a11y) => (
            <Select value={practitionerId} onValueChange={setPractitionerId}>
              <SelectTrigger {...a11y}>
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
          )}
        </Field>
        <Field label="Starts after">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              pager.startOver();
            }}
          />
        </Field>
        <Field label="Starts before">
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              pager.startOver();
            }}
          />
        </Field>
      </FilterBar>

      {roster.isPending ? (
        <TableSkeleton label="Loading timesheets" columns={5} />
      ) : roster.isError && !roster.data ? (
        <ErrorState
          error={roster.error}
          onRetry={() => void roster.refetch()}
          retrying={roster.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="timesheets" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<ReceiptText />}
            title={tab === 'COMPLETED' ? 'Nothing approved yet' : 'No timesheets yet'}
            description={
              tab === 'COMPLETED'
                ? 'Approve one from "awaiting decision" and it appears here.'
                : 'One appears when a practitioner submits the hours for a shift they have checked out of.'
            }
          />
        )
      ) : (
        <DataTable
          caption={tab === 'COMPLETED' ? 'Approved timesheets' : 'Timesheets awaiting a decision'}
          rows={rows}
          columns={columns}
          getKey={(row) => row.assignment.id}
          action={actions}
          actionHeader="Next step"
        />
      )}

      <Pager
        pageIndex={pager.pageIndex}
        hasNext={Boolean(nextCursor)}
        busy={roster.isFetching}
        onPrevious={pager.goPrevious}
        onNext={() => pager.goNext(nextCursor)}
      />

      {/* Approve: commits to the billed figure the screen showed, and cannot be taken back here. */}
      <ConfirmDialog
        open={deciding?.kind === 'approve' && decidingRow !== undefined}
        onOpenChange={(next) => !next && setDeciding(null)}
        title="Approve this timesheet"
        object={decidingRow ? describe(decidingRow) : ''}
        consequence={
          decidingRow ? (
            <>
              You are approving{' '}
              <strong className="tabular">{formatNaira(decidingRow.sheet.billedKobo)}</strong> for{' '}
              {formatMinutes(decidingRow.sheet.billableMinutes)} billable
              {decidingRow.sheet.premiumKobo > 0 ? ', allowances included' : ''}. The shift is
              marked completed and these hours are billed to this facility. Once approved, the hours
              can change only if {decidingRow.assignment.practitionerName} raises a dispute.
            </>
          ) : null
        }
        reversible={false}
        confirmLabel="Approve timesheet"
        cancelLabel="Not yet"
        loading={review.isPending}
        onConfirm={() =>
          decidingRow &&
          review.mutate(
            {
              assignmentId: decidingRow.assignment.id,
              decision: 'approve',
              seenRevision: decidingRow.sheet.revision,
              reviewNotes: note,
            },
            { onSuccess: () => setDeciding(null) },
          )
        }
      >
        <Field label="Note" optional hint="Kept on the record with your decision.">
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </ConfirmDialog>

      {/* Reject: sends the hours back. The reason is what the practitioner has to act on. */}
      <ConfirmDialog
        open={deciding?.kind === 'reject' && decidingRow !== undefined}
        onOpenChange={(next) => !next && setDeciding(null)}
        title="Reject this timesheet"
        object={decidingRow ? describe(decidingRow) : ''}
        consequence={
          decidingRow ? (
            <>
              The hours go back to {decidingRow.assignment.practitionerName}, who is told they were
              sent back and reads your reason on their timesheet. If they correct the hours and
              submit them again, you decide again.
            </>
          ) : null
        }
        reversible={false}
        confirmLabel="Reject timesheet"
        cancelLabel="Not now"
        loading={review.isPending}
        confirmDisabled={note.trim().length < MIN_NOTE}
        onConfirm={() =>
          decidingRow &&
          review.mutate(
            { assignmentId: decidingRow.assignment.id, decision: 'reject', reviewNotes: note },
            { onSuccess: () => setDeciding(null) },
          )
        }
      >
        <Field
          label="Reason"
          required
          hint="What is wrong with these hours, so they know what to correct. At least 10 characters."
        >
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </ConfirmDialog>

      {/* Correct the hours: the figures are worked out again and the old ones kept as a revision. */}
      <Dialog
        open={correctingRow !== undefined}
        onOpenChange={(next: boolean) => !next && !correct.isPending && setCorrecting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct the hours</DialogTitle>
            <DialogDescription>
              {correctingRow ? `${describe(correctingRow)}. ` : ''}The figures as they stand are
              written into a revision before anything moves. Nothing is overwritten — a correction
              keeps the value it replaces, with your name and reason against it. A corrected
              timesheet has to be submitted again before it can be approved.
            </DialogDescription>
          </DialogHeader>

          {timesState === 'failed' ? (
            <p role="alert" className="text-sm text-destructive-text">
              The recorded check-in and check-out times could not be loaded, so they are left blank
              and will not be changed. Break and on call can still be corrected.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Checked in"
              hint={timesState === 'loading' ? 'Loading the recorded time…' : 'Lagos time'}
              error={inError}
            >
              <Input
                type="datetime-local"
                value={checkedIn}
                disabled={timesState === 'loading'}
                onChange={(event) => setCheckedIn(event.target.value)}
              />
            </Field>
            <Field
              label="Checked out"
              hint={timesState === 'loading' ? 'Loading the recorded time…' : 'Lagos time'}
              error={outError}
            >
              <Input
                type="datetime-local"
                value={checkedOut}
                disabled={timesState === 'loading'}
                onChange={(event) => setCheckedOut(event.target.value)}
              />
            </Field>
            <Field label="Unpaid break (minutes)" error={breakError}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
              />
            </Field>
            <Field label="On call (minutes)" error={onCallError}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={onCallMinutes}
                onChange={(event) => setOnCallMinutes(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Why"
            required
            hint="Where the corrected figures came from. At least 10 characters."
          >
            <Textarea
              rows={3}
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
            />
          </Field>

          <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
            <Button
              variant="outline"
              disabled={correct.isPending}
              onClick={() => setCorrecting(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!canCorrect}
              loading={correct.isPending}
              onClick={() => correcting && correct.mutate(correcting)}
            >
              Correct it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TimesheetDetails row={detailRow} onClose={() => setDetailId(null)} />
    </>
  );
}

/**
 * Everything about one timesheet that the list does not have room for: the whole split of the
 * hours, how the billed figure is made up, and — as a timeline — each version that came before
 * this one and why it was replaced.
 */
function TimesheetDetails({ row, onClose }: { row: Row | undefined; onClose: () => void }) {
  const sheet = row?.sheet;
  const record = row?.assignment.attendance;

  const history: TimelineStep[] = row
    ? [
        ...[...row.revisions]
          .sort((a, b) => a.revision - b.revision)
          .map((revision): TimelineStep => {
            const before = earlierFigures(revision);
            return {
              id: `revision-${revision.revision}`,
              title: `Version ${revision.revision}, replaced`,
              state: 'done',
              when: formatWhen(revision.createdAt),
              detail: (
                <>
                  <p className="tabular">
                    {before.billableMinutes !== null ? formatMinutes(before.billableMinutes) : '—'}{' '}
                    billable · {before.amountKobo !== null ? formatNaira(before.amountKobo) : '—'}{' '}
                    at the base rate
                    {before.checkedInAt && before.checkedOutAt
                      ? ` · ${formatClock(before.checkedInAt)}–${formatClock(before.checkedOutAt)}`
                      : ''}
                  </p>
                  <p className="text-muted-foreground">Why: {revision.reason}</p>
                </>
              ),
            };
          }),
        {
          id: 'now',
          title: `Version ${row.sheet.revision}, as it stands`,
          state: 'current',
          detail: (
            <p className="tabular">
              {formatMinutes(row.sheet.billableMinutes)} billable ·{' '}
              {formatNaira(row.sheet.amountKobo)} at the base rate
            </p>
          ),
        },
      ]
    : [];

  const figure = (label: string, value: ReactNode) => (
    <div key={label} className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="tabular text-base">{value}</dd>
    </div>
  );

  return (
    <Dialog open={row !== undefined} onOpenChange={(next: boolean) => !next && onClose()}>
      <DialogContent>
        {row && sheet ? (
          <>
            <DialogHeader>
              <DialogTitle>Timesheet details</DialogTitle>
              <DialogDescription>
                {row.assignment.practitionerName} ·{' '}
                {formatShiftWindow(row.assignment.startsAt, row.assignment.endsAt)} · Lagos time
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusBadge status={sheet.attendanceStatus} />
              <span className="tabular text-base">
                {record?.checkedInAt ? formatClock(record.checkedInAt) : '—'}
                {' – '}
                {record?.checkedOutAt ? formatClock(record.checkedOutAt) : 'not out'}
                {spansDays(record?.checkedInAt ?? null, record?.checkedOutAt ?? null)
                  ? ' (next day)'
                  : ''}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {figure('Worked', formatMinutes(sheet.workedMinutes))}
              {figure('Unpaid break', formatMinutes(sheet.breakMinutes))}
              {figure('Billable', formatMinutes(sheet.billableMinutes))}
              {figure('Rate per hour', formatNaira(sheet.hourlyRateKobo))}
              {figure('Night', formatMinutes(sheet.nightMinutes))}
              {figure('Overtime', formatMinutes(sheet.overtimeMinutes))}
              {figure('Holiday', formatMinutes(sheet.holidayMinutes))}
              {figure('On call', formatMinutes(sheet.onCallMinutes))}
            </dl>

            {/* Approving commits to the billed figure, so that is what is made up here: the hours
                at the base rate plus the allowances this facility's own rate card adds. Showing
                the base amount alone had the invoice come to more than was approved. */}
            <div className="space-y-1 rounded-lg border bg-muted/30 p-4">
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">Hours at the base rate</span>
                <Money kobo={sheet.amountKobo} />
              </p>
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Night, holiday and overtime allowances from your rate card
                </span>
                <Money kobo={sheet.premiumKobo} />
              </p>
              <p className="flex items-baseline justify-between gap-3 border-t pt-2">
                <span className="font-medium">To be billed</span>
                <Money kobo={sheet.billedKobo} strong className="text-lg" />
              </p>
            </div>

            {row.revisions.length > 0 ? (
              <section aria-labelledby="timesheet-history" className="space-y-3">
                <h3 id="timesheet-history" className="text-base font-semibold">
                  Earlier versions, kept
                </h3>
                <Timeline label="History of this timesheet" steps={history} />
              </section>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
