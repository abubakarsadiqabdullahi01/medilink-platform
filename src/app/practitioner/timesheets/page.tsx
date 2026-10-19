'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, CircleAlert, Gavel, ReceiptText } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useQueue } from '@/lib/ui/queue';
import { timesheetSteps } from '@/lib/ui/timesheet-steps';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { Money, SubmittedVsApproved } from '@/components/app/money';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { StaleNote } from '@/components/app/stale-note';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { Timeline } from '@/components/app/timeline';
import {
  formatClock,
  formatMinutes,
  formatNaira,
  formatShiftWindow,
  formatWhen,
} from '@/components/app/format';

interface Assignment {
  id: string;
  facilityId: string;
  facilityName: string;
  status: string;
  startsAt: string;
  endsAt: string;
  /** Joined by `include=timesheet`; null for a shift with nothing worked yet. */
  sheet?: { timesheet: Timesheet; revisions: Revision[] } | null;
  /** Joined by `include=attendance`: the times the ward's code recorded. */
  attendance?: {
    checkedInAt: string | null;
    checkedOutAt: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
  } | null;
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
  /** Allowances the facility's rate card adds on top of `amountKobo`. */
  premiumKobo?: number;
  revision: number;
  /** What the facility said when it sent the hours back; null unless the sheet is rejected. */
  rejectionReason?: string | null;
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

/** Sheets that can be sent, or sent again. */
const SENDABLE = ['CHECKED_OUT', 'MANUALLY_CORRECTED', 'REJECTED'];
/** Sheets the facility has decided, and so can be disputed. */
const DECIDED = ['APPROVED', 'REJECTED'];
/** Decided sheets shown before "show all": months of history must not bury the one that needs sending. */
const RECENT_DECIDED = 8;

/** "45m" under an hour, "8h 30m" over: formatMinutes alone would say "0h 45m". */
const duration = (minutes: number) => (minutes < 60 ? `${minutes}m` : formatMinutes(minutes));

const clockRange = (sheet: Assignment['attendance']) =>
  sheet?.checkedInAt && sheet.checkedOutAt
    ? `${formatClock(sheet.checkedInAt)} to ${formatClock(sheet.checkedOutAt)}`
    : null;

/** A section a card can fold away, with the whole row — not just the chevron — as the target. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-md border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        {summary}
      </summary>
      <div className="space-y-3 border-t px-3 py-3">{children}</div>
    </details>
  );
}

/**
 * The practitioner's side of a timesheet: send it, then live with what the facility decides — or
 * dispute it.
 *
 * What needs doing comes first. A sheet that is worked and not sent is the one thing on this page
 * that costs the practitioner money by waiting, so "Ready to send" is the first section and months
 * of decided sheets sit below it, a few at a time. Sending is a review, not a click: the hours and
 * the figure are read back with what the facility will do with them, because once sent they are
 * the facility's to decide.
 *
 * Disputing is offered on the same card as the outcome rather than buried in a help page. A
 * decision you cannot contest from where you read it is one most people will not contest at all.
 */
export default function MyTimesheetsPage() {
  const queryClient = useQueryClient();

  const shifts = useQueue<Assignment>(
    ['my-assignments-for-timesheets'],
    // The timesheet, its revisions and the attendance times arrive with each shift: one request
    // for the page, where it used to be one more for every shift ever worked.
    '/api/v1/assignments?scopeType=SELF&include=timesheet,attendance',
    (body) => (body as { assignments?: Assignment[] }).assignments ?? [],
  );

  const [sending, setSending] = useState<Assignment | null>(null);
  const [disputing, setDisputing] = useState<Assignment | null>(null);
  const [category, setCategory] = useState('HOURS');
  const [reason, setReason] = useState('');
  const [showAllDecided, setShowAllDecided] = useState(false);

  const submit = useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/api/v1/assignments/${assignmentId}/timesheet/submit`),
    onSuccess: () => {
      toast.success('Submitted', { description: 'The facility decides next.' });
      void queryClient.invalidateQueries({ queryKey: ['my-assignments-for-timesheets'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
      setSending(null);
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

  const sheets = (shifts.data ?? []).filter((row) => row.sheet);
  const latestFirst = (a: Assignment, b: Assignment) =>
    new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
  const status = (row: Assignment) => row.sheet!.timesheet.attendanceStatus;

  const toSend = sheets.filter((row) => SENDABLE.includes(status(row))).sort(latestFirst);
  const withFacility = sheets.filter((row) => status(row) === 'SUBMITTED').sort(latestFirst);
  const decided = sheets
    .filter((row) => !SENDABLE.includes(status(row)) && status(row) !== 'SUBMITTED')
    .sort(latestFirst);
  const visibleDecided = showAllDecided ? decided : decided.slice(0, RECENT_DECIDED);
  const readyCount = sheets.filter((row) =>
    ['CHECKED_OUT', 'MANUALLY_CORRECTED'].includes(status(row)),
  ).length;

  const sheetCard = (assignment: Assignment) => {
    const sheet = assignment.sheet!.timesheet;
    const revisions = assignment.sheet!.revisions;
    const canSubmit = SENDABLE.includes(sheet.attendanceStatus);
    const canDispute = DECIDED.includes(sheet.attendanceStatus);
    const range = clockRange(assignment.attendance);

    // What was on the sheet before anybody changed it: the earliest revision's "previous".
    const first = revisions[0]?.previous;
    const before =
      first && typeof first.amountKobo === 'number' && typeof first.billableMinutes === 'number'
        ? { amountKobo: first.amountKobo, billableMinutes: first.billableMinutes }
        : null;

    return (
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{formatWhen(assignment.startsAt)}</p>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {assignment.facilityName}
                {sheet.revision > 1 ? ` · revision ${sheet.revision}` : ''}
              </p>
            </div>
            <StatusBadge status={sheet.attendanceStatus} />
          </div>

          {/* The text message says only that hours were sent back; this is where the reason is
              read, next to the button that sends them again. */}
          {sheet.attendanceStatus === 'REJECTED' ? (
            <Alert variant="warning">
              <CircleAlert />
              <AlertDescription>
                <strong className="font-medium">The facility sent these hours back.</strong>{' '}
                {sheet.rejectionReason
                  ? `They said: ${sheet.rejectionReason}`
                  : 'They did not say why. Check the hours, correct what is wrong and send them again.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {range ? (
              <div className="col-span-2 min-w-0">
                <dt className="text-sm text-muted-foreground">On shift</dt>
                <dd className="tabular">
                  {range}
                  <span className="text-muted-foreground">
                    {sheet.breakMinutes > 0
                      ? ` · ${duration(sheet.breakMinutes)} unpaid break`
                      : ''}
                  </span>
                </dd>
              </div>
            ) : null}
            <div className="min-w-0">
              <dt className="text-sm text-muted-foreground">Worked</dt>
              <dd className="tabular">{duration(sheet.workedMinutes)}</dd>
            </div>
            {/* Not "you are owed": this is the timesheet at the base rate, and what is actually
                credited is priced against the facility's rate card when the shift is invoiced. */}
            <div className="min-w-0">
              <dt className="text-sm text-muted-foreground">At the agreed rate</dt>
              <dd>
                <Money kobo={sheet.amountKobo} strong />
              </dd>
            </div>
          </dl>

          {before && sheet.attendanceStatus === 'APPROVED' ? (
            <SubmittedVsApproved
              label="Amount at the agreed rate"
              submitted={before.amountKobo}
              approved={sheet.amountKobo}
              format={formatNaira}
            />
          ) : null}

          <Disclosure summary="How this was worked out">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Billable</dt>
                <dd className="tabular">{duration(sheet.billableMinutes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rate</dt>
                <dd className="tabular">{formatNaira(sheet.hourlyRateKobo)}/hour</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Night hours</dt>
                <dd className="tabular">{duration(sheet.nightMinutes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Holiday hours</dt>
                <dd className="tabular">{duration(sheet.holidayMinutes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Overtime</dt>
                <dd className="tabular">{duration(sheet.overtimeMinutes)}</dd>
              </div>
            </dl>
            {sheet.premiumKobo ? (
              <p className="text-sm text-muted-foreground">
                The facility&apos;s rate card adds {formatNaira(sheet.premiumKobo)} for night,
                holiday or overtime hours on this shift.
              </p>
            ) : null}
            {/* Said plainly, because a practitioner reading a night figure will reasonably
                expect it to be worth more. */}
            {sheet.nightMinutes > 0 || sheet.holidayMinutes > 0 ? (
              <p className="text-sm text-muted-foreground">
                Night and holiday hours are priced against the facility&rsquo;s rate card when the
                shift is invoiced. A facility that has not set one pays them at the ordinary rate.
              </p>
            ) : null}
          </Disclosure>

          <Disclosure summary="Where this has got to">
            <Timeline
              label="Progress of this timesheet"
              steps={timesheetSteps({
                status: sheet.attendanceStatus,
                checkedOutAt: assignment.attendance?.checkedOutAt,
                submittedAt: assignment.attendance?.submittedAt,
                reviewedAt: assignment.attendance?.reviewedAt,
                rejectionReason: sheet.rejectionReason,
              })}
            />
          </Disclosure>

          {revisions.length > 0 ? (
            <Disclosure
              summary={`${revisions.length} earlier version${revisions.length === 1 ? '' : 's'}, kept`}
            >
              {revisions.map((revision) => (
                <div key={revision.revision} className="text-sm">
                  <p className="tabular font-medium">
                    Was {formatNaira(revision.previous.amountKobo as number)} ·{' '}
                    {formatMinutes(revision.previous.billableMinutes as number)}
                  </p>
                  <p className="text-muted-foreground [overflow-wrap:anywhere]">
                    {revision.reason}
                  </p>
                </div>
              ))}
            </Disclosure>
          ) : null}

          {canSubmit || canDispute ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              {canSubmit ? (
                <Button
                  className="sm:flex-1"
                  onClick={() => setSending(assignment)}
                  aria-label={`Submit ${formatNaira(sheet.amountKobo)} for ${formatShiftWindow(assignment.startsAt, assignment.endsAt)}`}
                >
                  Submit {formatNaira(sheet.amountKobo)}
                </Button>
              ) : null}
              {canDispute ? (
                <Button
                  variant="outline"
                  className="sm:flex-1"
                  onClick={() => {
                    setDisputing(assignment);
                    setReason('');
                    setCategory('HOURS');
                  }}
                >
                  <Gavel />
                  Dispute this
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  };

  const section = (id: string, heading: string, rows: Assignment[], note?: string) =>
    rows.length === 0 ? null : (
      <section aria-labelledby={id}>
        <h2 id={id} className="mb-1 text-base font-semibold">
          {heading}
        </h2>
        {note ? (
          <p className="mb-3 text-sm text-muted-foreground">{note}</p>
        ) : (
          <div className="mb-3" />
        )}
        <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => (
            <Fragment key={row.id}>{sheetCard(row)}</Fragment>
          ))}
        </div>
      </section>
    );

  return (
    <>
      <PageHeader
        title="Timesheets"
        description="What each shift came to, at the rate agreed when it was offered. Submit yours and the facility approves or asks you to correct it."
      />

      {readyCount > 0 ? (
        <Alert className="mb-6" variant="info">
          <ReceiptText />
          <AlertDescription>
            {readyCount} shift{readyCount === 1 ? '' : 's'} ready to submit. Nothing is paid until
            you do.
          </AlertDescription>
        </Alert>
      ) : null}

      <StaleNote
        show={shifts.isError && Boolean(shifts.data)}
        onRetry={() => void shifts.refetch()}
        retrying={shifts.isFetching}
        what="your timesheets"
      />

      {shifts.isPending ? (
        <ListSkeleton rows={2} label="Loading your timesheets" />
      ) : shifts.isError && !shifts.data ? (
        <ErrorState
          error={shifts.error}
          onRetry={() => void shifts.refetch()}
          retrying={shifts.isFetching}
        />
      ) : sheets.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title="No timesheets yet"
          description="One is worked out for you as soon as you check out of a shift."
        />
      ) : (
        <div className="space-y-8">
          {section('to-send', 'Ready to send', toSend, 'Worked, and waiting for you.')}
          {section('with-facility', 'With the facility', withFacility, 'Sent. They decide next.')}
          {section('decided', 'Decided', visibleDecided)}
          {decided.length > RECENT_DECIDED ? (
            <Button variant="outline" onClick={() => setShowAllDecided((value) => !value)}>
              {showAllDecided
                ? 'Show only the most recent'
                : `Show all ${decided.length} decided timesheets`}
            </Button>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={sending !== null}
        onOpenChange={(next) => !next && setSending(null)}
        title="Send these hours to the facility"
        object={
          sending
            ? `${sending.facilityName} · ${formatShiftWindow(sending.startsAt, sending.endsAt)}`
            : ''
        }
        consequence="The facility sees these hours and approves them or sends them back with a reason. Nothing is paid until they approve and the shift is invoiced."
        reversible={false}
        confirmLabel="Send to the facility"
        cancelLabel="Not yet"
        loading={submit.isPending}
        onConfirm={() => sending && submit.mutate(sending.id)}
      >
        {sending ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
              <div className="col-span-2">
                <dt className="text-muted-foreground">Checked in and out</dt>
                <dd className="tabular font-medium">
                  {clockRange(sending.attendance) ?? 'Recorded by the facility'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Worked</dt>
                <dd className="tabular font-medium">
                  {duration(sending.sheet!.timesheet.workedMinutes)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Unpaid break</dt>
                <dd className="tabular font-medium">
                  {sending.sheet!.timesheet.breakMinutes > 0
                    ? duration(sending.sheet!.timesheet.breakMinutes)
                    : 'None'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">At the agreed rate</dt>
                <dd>
                  <Money kobo={sending.sheet!.timesheet.amountKobo} strong />
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              The hours are worked out again from your check-in and check-out when you send them, so
              the figure the facility sees is what the record says at that moment. Once sent you
              cannot change them yourself; if the facility sends them back you can send them again.
            </p>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={disputing !== null}
        onOpenChange={(next) => !next && setDisputing(null)}
        title="Dispute this shift"
        object={
          disputing
            ? `${disputing.facilityName} · ${formatShiftWindow(disputing.startsAt, disputing.endsAt)}`
            : ''
        }
        consequence="An officer at the platform decides, not the facility. You have fourteen days from their decision, and the shift is held until yours is resolved."
        reversible={false}
        confirmLabel="Open the dispute"
        cancelLabel="Not now"
        loading={dispute.isPending}
        confirmDisabled={reason.trim().length < MIN_REASON}
        onConfirm={() => disputing && dispute.mutate(disputing)}
      >
        <Field label="What is wrong" required>
          {(a11y) => (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger {...a11y}>
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
          )}
        </Field>
        <Field
          label="In your words"
          required
          hint={
            reason.trim().length < MIN_REASON
              ? `What happened, and what the record should say instead. ${MIN_REASON - reason.trim().length} more characters needed.`
              : 'What happened, and what the record should say instead.'
          }
        >
          <Textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
