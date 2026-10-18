'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Circle,
  CircleAlert,
  CircleCheck,
  Clock,
  Inbox,
  ReceiptText,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import {
  BLOCKER_GUIDE,
  useEligibility,
  usePractitionerSetup,
  type ApplicationState,
  type CredentialSubmission,
} from '@/lib/ui/practitioner';
import { nameOf, useReference } from '@/lib/ui/reference';
import {
  daysPhrase,
  deriveShifts,
  expiringCredentials,
  openOffers,
  type TodayAssignment,
  type TodayInvitation,
} from '@/lib/ui/practitioner-today';
import { lagosDate } from '@/lib/lagos-date';
import { useNow } from '@/lib/ui/now';
import { useSession } from '@/lib/ui/session';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AttentionList,
  DashboardSection,
  MetricGrid,
  MetricTile,
  type AttentionItem,
} from '@/components/app/dashboard';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { ReturnedNotice } from '@/app/practitioner/profile/returned-notice';
import { MyInvitations } from '@/components/app/my-invitations';
import {
  formatClock,
  formatDate,
  formatNaira,
  formatNairaTight,
  formatShiftWindow,
  formatShortDate,
  formatWhen,
} from '@/components/app/format';

/**
 * What a practitioner needs to know on opening the app, in the order they need it.
 *
 * It used to be ordered by what the *system* knows — setup, then eligibility reasons — so a nurse
 * with a shift in an hour and an offer expiring at noon scrolled past a paragraph about her
 * profile to reach them. It is ordered by what *she* came for:
 *
 *   1. one primary action, chosen by what is most pressing
 *   2. what needs her (check in, an offer, hours to send, a credential running out)
 *   3. four figures: offers, hours, expected pay, paid
 *   4. today and next, and the offers themselves
 *   5. her readiness: why she can or cannot be offered work, and her availability
 *
 * Everything on the page is read from the one `/api/v1/dashboard/practitioner` request. Nothing
 * here asks the server anything of its own unless that request failed, in which case each section
 * falls back to the request it always had.
 */

interface Availability {
  slots: { id: string; kind: string; dayOfWeek: number | null }[];
  blocks: { id: string; startsAt: string; endsAt: string; reason: string }[];
}

interface Earnings {
  owedKobo: number;
  heldKobo: number;
  awaitingKobo: number;
  inFlightKobo: number;
  paidKobo: number;
  lastPaidAt: string | null;
}

/** What `/api/v1/dashboard/practitioner` returns; a section is absent if withheld. */
interface OverviewBundle {
  profile?: unknown;
  eligibility?: unknown;
  availability?: Availability;
  submissions?: CredentialSubmission[];
  invitations?: TodayInvitation[];
  assignments?: TodayAssignment[];
  earnings?: Earnings;
}

export default function PractitionerHome() {
  const session = useSession();
  const queryClient = useQueryClient();

  // One request for everything below. Each section keeps its own query key — the profile page,
  // the offers queue and the rest read the same ones — so the answer is written under those keys
  // and the hooks find it fresh instead of each asking again.
  const bundle = useQuery({
    queryKey: ['practitioner-overview'],
    queryFn: async () => {
      const data = await api.get<OverviewBundle>('/api/v1/dashboard/practitioner');
      seedOverview(queryClient, data);
      return data;
    },
    retry: false,
  });

  const firstName = session.user.fullName.split(' ')[0];

  return (
    <>
      <Home bundle={bundle} firstName={firstName} />
    </>
  );
}

/** Writes each section where the hooks that normally fetch it will look. */
function seedOverview(queryClient: QueryClient, data: OverviewBundle) {
  const seed: [string, unknown][] = [
    ['profile', data.profile],
    ['eligibility', data.eligibility],
    ['availability', data.availability],
    ['my-credentials', data.submissions],
    ['invitations', data.invitations],
    ['my-assignments', data.assignments],
  ];
  for (const [key, value] of seed) {
    if (value !== undefined) queryClient.setQueryData([key], value);
  }
}

function todayInLagos(): string {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

function Home({
  bundle,
  firstName,
}: {
  bundle: ReturnType<typeof useQuery<OverviewBundle>>;
  firstName: string | undefined;
}) {
  const queryClient = useQueryClient();
  const reference = useReference();
  const eligibility = useEligibility();
  const setup = usePractitionerSetup();

  // Only if the one request failed: the same two reads this page made before it existed.
  const invitationsFallback = useQuery({
    queryKey: ['invitations'],
    queryFn: async () =>
      (await api.get<{ invitations?: TodayInvitation[] }>('/api/v1/invitations')).invitations ?? [],
    retry: false,
    enabled: bundle.isError,
  });
  const assignmentsFallback = useQuery({
    queryKey: ['my-assignments'],
    queryFn: async () =>
      (
        await api.get<{ assignments?: TodayAssignment[] }>(
          '/api/v1/assignments?scopeType=SELF&status=CONFIRMED&include=attendance',
        )
      ).assignments ?? [],
    retry: false,
    enabled: bundle.isError,
  });

  const settled = !bundle.isPending;
  const invitations = bundle.data?.invitations ?? invitationsFallback.data;
  const assignments = bundle.data?.assignments ?? assignmentsFallback.data;
  const availability =
    bundle.data?.availability ??
    (queryClient.getQueryData(['availability']) as Availability | undefined);
  const earnings = bundle.data?.earnings;
  const credentials = bundle.data?.submissions ?? setup.submissions;

  const now = useNow();
  const shifts = useMemo(() => deriveShifts(assignments ?? [], now), [assignments, now]);
  const offers = useMemo(() => openOffers(invitations ?? [], now), [invitations, now]);
  const running = useMemo(() => expiringCredentials(credentials, now), [credentials, now]);

  const reasons = (eligibility.data?.blockers ?? []).map((blocker) => ({
    blocker,
    guide: BLOCKER_GUIDE[blocker] ?? { says: humanise(blocker) },
  }));
  const yours = reasons.filter((reason) => reason.guide.href);
  const ours = reasons.filter((reason) => !reason.guide.href);

  const attention = buildAttention({
    shifts,
    offers,
    running,
    setup,
    yours: yours.length,
    ours: ours.length,
    credentialName: (id) => nameOf(reference.data?.credentialTypes, id),
    now,
  });

  const primary = choosePrimary({ shifts, offers, setup });

  const failed = bundle.isError && !assignments && !invitations;

  return (
    <>
      <PageHeader
        title={`Hello, ${firstName}`}
        description={todayInLagos()}
        action={
          settled && primary ? (
            <Link href={primary.href} className={buttonVariants({ size: 'lg' })}>
              {primary.label}
              <ArrowRight />
            </Link>
          ) : null
        }
      />

      <div className="space-y-8">
        <MyInvitations className="" />

        {setup.ready && setup.state === 'CHANGES_NEEDED' ? (
          <ReturnedNotice rejected={setup.rejected} />
        ) : null}

        {failed ? (
          <ErrorState
            error={bundle.error}
            onRetry={() => void bundle.refetch()}
            retrying={bundle.isFetching}
            compact
          />
        ) : null}

        <AttentionList
          items={attention}
          loading={!settled && !setup.ready}
          emptyTitle="You are up to date"
          emptyDetail={
            shifts.next
              ? 'Nothing is waiting on you. Your next shift is below.'
              : 'Nothing is waiting on you. Offers appear here when a facility picks you for a shift.'
          }
        />

        <MetricGrid compact>
          <MetricTile
            compact
            label="Offers waiting"
            value={offers.length}
            hint={offers[0] ? answerBy(offers[0].expiresAt, now) : 'Nothing to answer'}
            href="/practitioner/offers"
            tone={offers.length > 0 ? 'warning' : 'neutral'}
            icon={Inbox}
            loading={!settled}
            error={!settled ? false : invitations === undefined}
          />
          <MetricTile
            compact
            label="Hours to send"
            value={shifts.readyToSubmit.length + shifts.needsCorrection.length}
            hint={
              shifts.readyToSubmit.length + shifts.needsCorrection.length > 0
                ? 'Nothing is paid until you send them'
                : shifts.withFacility.length > 0
                  ? `${shifts.withFacility.length} with the facility`
                  : 'Nothing to send'
            }
            href="/practitioner/timesheets"
            tone={
              shifts.readyToSubmit.length + shifts.needsCorrection.length > 0
                ? 'warning'
                : 'neutral'
            }
            icon={ReceiptText}
            loading={!settled}
            error={!settled ? false : assignments === undefined}
          />
          {earnings || (settled && bundle.isError) ? (
            <>
              <MetricTile
                compact
                label="Expected"
                value={earnings ? formatNairaTight(earnings.owedKobo + earnings.inFlightKobo) : '—'}
                hint={
                  earnings
                    ? earnings.owedKobo + earnings.inFlightKobo === 0
                      ? 'Nothing owed right now'
                      : `${formatNairaTight(earnings.owedKobo)} owed · ${formatNairaTight(earnings.inFlightKobo)} on its way`
                    : undefined
                }
                href="/practitioner/earnings"
                className="max-sm:col-span-full"
                icon={Wallet}
                loading={!settled}
                error={settled && !earnings}
              />
              <MetricTile
                compact
                label="Paid so far"
                value={earnings ? formatNairaTight(earnings.paidKobo) : '—'}
                hint={
                  earnings
                    ? earnings.lastPaidAt
                      ? `Last payment ${formatDate(earnings.lastPaidAt)}`
                      : 'No payment yet'
                    : undefined
                }
                href="/practitioner/earnings"
                className="max-sm:col-span-full"
                icon={CircleCheck}
                loading={!settled}
                error={settled && !earnings}
              />
            </>
          ) : null}
        </MetricGrid>

        <div className="grid items-start gap-8 xl:grid-cols-2">
          <DashboardSection
            id="shifts-heading"
            title="Today and next"
            description="Your confirmed shifts, Lagos time."
            href="/practitioner/shifts"
            hrefLabel="All my shifts"
          >
            {!settled ? (
              <Skeleton className="h-28 w-full" />
            ) : assignments === undefined ? (
              <ErrorState error={bundle.error} onRetry={() => void bundle.refetch()} compact />
            ) : (
              <ShiftList shifts={shifts} now={now} />
            )}
          </DashboardSection>

          <DashboardSection
            id="offers-heading"
            title="Offers to answer"
            description="The soonest to lapse first."
            href="/practitioner/offers"
            hrefLabel="All offers"
          >
            {!settled ? (
              <Skeleton className="h-28 w-full" />
            ) : invitations === undefined ? (
              <ErrorState error={bundle.error} onRetry={() => void bundle.refetch()} compact />
            ) : (
              <OfferList
                offers={offers.slice(0, 3)}
                total={offers.length}
                professionName={(id) => nameOf(reference.data?.professionalCategories, id)}
                referenceReady={reference.isSuccess}
                now={now}
              />
            )}
          </DashboardSection>
        </div>

        <div id="readiness" className="grid scroll-mt-24 items-start gap-8 xl:grid-cols-2">
          <DashboardSection id="readiness-heading" title="Can you be offered shifts?">
            {setup.ready && setup.state !== 'APPROVED' && setup.state !== 'CHANGES_NEEDED' ? (
              <div className="mb-4">
                <SetupCard
                  steps={setup.steps}
                  doneCount={setup.doneCount}
                  hasProfile={setup.hasProfile}
                  state={setup.state}
                  submittedAt={setup.submittedForReviewAt}
                />
              </div>
            ) : null}
            <Eligibility
              pending={eligibility.isPending}
              error={eligibility.isError && !eligibility.data ? eligibility.error : null}
              onRetry={() => void eligibility.refetch()}
              eligible={eligibility.data?.eligible ?? false}
              known={Boolean(eligibility.data)}
              yours={yours}
              ours={ours}
            />
          </DashboardSection>

          <DashboardSection
            id="availability-heading"
            title="Your availability"
            href="/practitioner/profile?tab=availability"
            hrefLabel="Change it"
          >
            <AvailabilityCard availability={availability} settled={settled} now={now} />
          </DashboardSection>
        </div>
      </div>
    </>
  );
}

/** "Answer by 21:13 today", "…tomorrow", "…on 21 Oct": the clock first, then the day in words. */
function answerBy(iso: string, now: Date): string {
  const day = lagosDate(new Date(iso));
  const today = lagosDate(now);
  const tomorrow = lagosDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const when =
    day === today ? 'today' : day === tomorrow ? 'tomorrow' : `on ${formatShortDate(iso)}`;
  return `Answer by ${formatClock(iso)} ${when}`;
}

/** The one thing the page asks of a person first. */
function choosePrimary({
  shifts,
  offers,
  setup,
}: {
  shifts: ReturnType<typeof deriveShifts>;
  offers: TodayInvitation[];
  setup: ReturnType<typeof usePractitionerSetup>;
}): { href: string; label: string } | null {
  if (shifts.checkInDue.length > 0) return { href: '/practitioner/shifts', label: 'Check in' };
  if (offers.length > 0) {
    return {
      href: '/practitioner/offers',
      label: offers.length === 1 ? 'Answer your offer' : `Answer ${offers.length} offers`,
    };
  }
  if (shifts.readyToSubmit.length > 0 || shifts.needsCorrection.length > 0) {
    return { href: '/practitioner/timesheets', label: 'Send your hours' };
  }
  if (
    setup.ready &&
    (setup.state === 'DRAFT' || setup.state === 'READY' || setup.state === 'CHANGES_NEEDED')
  ) {
    return {
      href: '/practitioner/profile',
      label:
        setup.state === 'READY'
          ? 'Review and submit'
          : setup.hasProfile
            ? 'Continue setup'
            : 'Start setup',
    };
  }
  if (setup.ready)
    return { href: '/practitioner/profile?tab=availability', label: 'Update my availability' };
  return null;
}

function buildAttention({
  shifts,
  offers,
  running,
  setup,
  yours,
  ours,
  credentialName,
  now,
}: {
  shifts: ReturnType<typeof deriveShifts>;
  offers: TodayInvitation[];
  running: ReturnType<typeof expiringCredentials>;
  setup: ReturnType<typeof usePractitionerSetup>;
  yours: number;
  ours: number;
  credentialName: (id: string) => string;
  now: Date;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const shift of shifts.checkInDue.slice(0, 2)) {
    const started = new Date(shift.startsAt) <= now;
    items.push({
      id: `checkin-${shift.id}`,
      tone: 'danger',
      title: `Check in for your shift at ${shift.facilityName}`,
      detail: `${formatShiftWindow(shift.startsAt, shift.endsAt)}. ${
        started
          ? 'It has started: ask the ward for the code.'
          : 'The ward reads you the code at the desk.'
      }`,
      href: '/practitioner/shifts',
      action: 'Check in',
    });
  }

  for (const shift of shifts.endedUnattended.slice(0, 2)) {
    items.push({
      id: `unattended-${shift.id}`,
      tone: 'danger',
      title: `Nobody checked you in at ${shift.facilityName}`,
      detail: `${formatShiftWindow(shift.startsAt, shift.endsAt)}. If you were there, or something stopped you, say so.`,
      href: '/practitioner/shifts',
      action: 'Explain',
    });
  }

  if (offers.length > 0) {
    const soonest = offers[0]!;
    items.push({
      id: 'offers',
      tone: 'warning',
      title:
        offers.length === 1
          ? 'An offer is waiting for your answer'
          : `${offers.length} offers are waiting for your answer`,
      detail: `${soonest.facilityName}. ${answerBy(soonest.expiresAt, now)}.`,
      href: '/practitioner/offers',
      action: 'Answer',
    });
  }

  const toSend = shifts.readyToSubmit.length;
  if (toSend > 0) {
    items.push({
      id: 'hours',
      tone: 'warning',
      title: toSend === 1 ? 'Send the hours for 1 shift' : `Send the hours for ${toSend} shifts`,
      detail: 'Nothing is paid until the facility has approved them.',
      href: '/practitioner/timesheets',
      action: 'Send hours',
    });
  }

  if (shifts.needsCorrection.length > 0) {
    items.push({
      id: 'correct',
      tone: 'warning',
      title:
        shifts.needsCorrection.length === 1
          ? 'A facility asked you to correct your hours'
          : `${shifts.needsCorrection.length} facilities asked you to correct your hours`,
      detail: 'Open the timesheet to see what they said.',
      href: '/practitioner/timesheets',
      action: 'Correct',
    });
  }

  for (const credential of running.slice(0, 3)) {
    items.push({
      id: `credential-${credential.id}`,
      tone: credential.expired ? 'danger' : 'warning',
      title: credential.expired
        ? `${credentialName(credential.credentialTypeId)} has expired`
        : `${credentialName(credential.credentialTypeId)} expires ${daysPhrase(credential.daysLeft)}`,
      detail: credential.expired
        ? 'It no longer counts. Send the current one to be offered shifts again.'
        : `Valid until ${formatDate(credential.at)}. Send the renewal before it lapses so you are not left out of matching.`,
      href: '/practitioner/profile?tab=credentials',
      action: credential.expired ? 'Send current' : 'Renew',
    });
  }

  if (setup.ready) {
    if (setup.state === 'DRAFT' || setup.state === 'READY') {
      items.push({
        id: 'setup',
        tone: 'info',
        title:
          setup.state === 'READY'
            ? 'Everything is in — submit it for approval'
            : 'Finish setting up your profile',
        detail:
          setup.state === 'READY'
            ? 'An officer does not start reviewing until you submit.'
            : `${setup.doneCount} of ${setup.steps.length} steps done.`,
        href: '/practitioner/profile',
        action: setup.state === 'READY' ? 'Submit' : 'Continue',
      });
    } else if (setup.state === 'WAITING') {
      items.push({
        id: 'waiting',
        tone: 'info',
        title: 'Your application is with an officer',
        detail: `Submitted ${formatWhen(setup.submittedForReviewAt)}. There is nothing more for you to do.`,
        href: '/practitioner/profile',
        action: 'View',
      });
    } else if (setup.state === 'APPROVED' && yours > 0) {
      items.push({
        id: 'yours',
        tone: 'warning',
        title: 'Something of yours is stopping offers',
        detail: yours === 1 ? 'One thing is yours to do.' : `${yours} things are yours to do.`,
        href: '#readiness',
        action: 'See what',
      });
    }
    if (
      setup.state !== 'DRAFT' &&
      setup.state !== 'READY' &&
      setup.state !== 'WAITING' &&
      !setup.eligible &&
      ours > 0 &&
      yours === 0
    ) {
      items.push({
        id: 'ours',
        tone: 'info',
        title: 'Waiting on Medilink',
        detail:
          ours === 1
            ? 'One check is Medilink’s to complete.'
            : `${ours} checks are Medilink’s to complete.`,
        href: '#readiness',
        action: 'See which',
      });
    }
  }

  return items;
}

function ShiftList({ shifts, now }: { shifts: ReturnType<typeof deriveShifts>; now: Date }) {
  const rows = [
    ...shifts.inProgress,
    ...shifts.upcoming.filter((row) => !shifts.inProgress.some((live) => live.id === row.id)),
  ].slice(0, 3);

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={<CalendarDays />}
        title="No confirmed shifts"
        description="When a facility confirms you for a shift it appears here. Keeping your availability current is what gets you offered them."
      />
    );
  }

  return (
    <Card>
      <ul className="divide-y">
        {rows.map((row) => {
          const live = shifts.inProgress.some((shift) => shift.id === row.id);
          const due = shifts.checkInDue.some((shift) => shift.id === row.id);
          const started = new Date(row.startsAt) <= now;
          return (
            <li key={row.id}>
              <Link
                href="/practitioner/shifts"
                className="flex min-h-16 items-start justify-between gap-3 p-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-medium leading-snug">
                    {formatShiftWindow(row.startsAt, row.endsAt)}
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                    {row.facilityName} · {humanise(row.shiftType)} ·{' '}
                    {formatNaira(row.hourlyRateKobo)}/hour
                  </span>
                </span>
                <span className="shrink-0">
                  {live && !due ? (
                    <Badge variant="info">
                      <CalendarCheck aria-hidden="true" /> In progress
                    </Badge>
                  ) : due ? (
                    <Badge variant="warning">
                      <Clock aria-hidden="true" /> {started ? 'Check in now' : 'Check-in open'}
                    </Badge>
                  ) : (
                    <StatusBadge status="CONFIRMED" />
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function OfferList({
  offers,
  total,
  professionName,
  referenceReady,
  now,
}: {
  offers: TodayInvitation[];
  total: number;
  professionName: (id: string) => string;
  referenceReady: boolean;
  now: Date;
}) {
  if (offers.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Inbox />}
        title="Nothing to answer"
        description="Offers arrive here, and by notification, when a facility picks you. You choose; nothing is booked until you accept and the facility confirms."
      />
    );
  }
  return (
    <Card>
      <ul className="divide-y">
        {offers.map((offer) => (
          <li key={offer.id}>
            <Link
              href="/practitioner/offers"
              className="flex min-h-16 items-start justify-between gap-3 p-4 transition-colors first:rounded-t-xl hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="block font-medium leading-snug">
                  {offer.facilityName}
                  {referenceReady ? ` · ${professionName(offer.professionalCategoryId)}` : ''}
                </span>
                <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                  {formatShiftWindow(offer.startsAt, offer.endsAt)} ·{' '}
                  {formatNaira(offer.hourlyRateKobo)}/hour
                </span>
                <span className="mt-1 block text-sm font-medium">
                  {answerBy(offer.expiresAt, now)}
                </span>
              </span>
              {offer.urgency === 'URGENT' ? (
                <Badge variant="destructive" className="shrink-0">
                  <TriangleAlert aria-hidden="true" /> Urgent
                </Badge>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      {total > offers.length ? (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">
          {total - offers.length} more on the offers page.
        </p>
      ) : null}
    </Card>
  );
}

function Eligibility({
  pending,
  error,
  onRetry,
  eligible,
  known,
  yours,
  ours,
}: {
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  eligible: boolean;
  known: boolean;
  yours: { blocker: string; guide: { says: string; href?: string; action?: string } }[];
  ours: { blocker: string; guide: { says: string } }[];
}) {
  if (pending) return <Skeleton className="h-24 w-full" />;

  // Silence here used to be the failure mode: the card simply vanished, and an absent blocker
  // list reads as "nothing is wrong with my account" — the opposite of what a failed fetch means.
  if (!known)
    return <ErrorState error={error ?? new TypeError('offline')} onRetry={onRetry} compact />;

  if (eligible) {
    return (
      <Card className="border-success/40">
        <CardContent className="flex items-start gap-3 pt-6">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="font-medium">You can be offered shifts</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything the platform requires is in place.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-warning/40">
      <CardContent className="flex items-start gap-3 pt-6">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 space-y-4">
          <div>
            <p className="font-medium">You cannot be offered shifts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">These are the reasons, in full.</p>
          </div>

          {yours.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Yours to do</h3>
              <ul className="mt-2 space-y-2">
                {yours.map(({ blocker, guide }) => (
                  <li key={blocker} className="text-base leading-relaxed">
                    {guide.says}{' '}
                    {guide.href && guide.action ? (
                      <Link
                        href={guide.href}
                        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
                      >
                        {guide.action}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {ours.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Waiting on Medilink</h3>
              <ul className="mt-2 space-y-2">
                {ours.map(({ blocker, guide }) => (
                  <li key={blocker} className="text-base leading-relaxed text-muted-foreground">
                    {guide.says}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing in this list is waiting on you.
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function AvailabilityCard({
  availability,
  settled,
  now,
}: {
  availability: Availability | undefined;
  settled: boolean;
  now: Date;
}) {
  if (!settled && !availability) return <Skeleton className="h-24 w-full" />;
  if (!availability) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Your availability could not be loaded. Open the page to see it.
        </CardContent>
      </Card>
    );
  }

  const days = [
    ...new Set(
      availability.slots
        .filter((slot) => slot.kind === 'WEEKLY' || slot.dayOfWeek !== null)
        .map((slot) => slot.dayOfWeek),
    ),
  ]
    .filter((day): day is number => day !== null)
    .sort((a, b) => a - b);
  const away = availability.blocks
    .filter((block) => new Date(block.endsAt) > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        {days.length > 0 ? (
          <p className="flex items-start gap-2">
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <span>
              <span className="font-medium">
                Set for {days.length === 1 ? 'one day' : `${days.length} days`} a week.
              </span>{' '}
              <span className="text-muted-foreground">
                {days.map((day) => WEEKDAYS[day]!.slice(0, 3)).join(', ')}.
              </span>
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2">
            <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="font-medium">No weekly pattern yet.</span>{' '}
              <span className="text-muted-foreground">
                With nothing to check a shift against, no offers can reach you.
              </span>
            </span>
          </p>
        )}
        {away ? (
          <p className="text-sm text-muted-foreground">
            Away {formatDate(away.startsAt)} – {formatDate(away.endsAt)}
            {away.reason ? `: ${away.reason.replace(/[.\s]+$/, '')}` : ''}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Where their application stands, and the one thing to do about it.
 *
 * Three states, because "your setup" means three different things to somebody: something of theirs
 * is missing (go and add it — each missing item is its own link, straight to where it is added);
 * everything is in but they have not said so (nobody has been told, and the card says that); and
 * sent (waiting).
 */
function SetupCard({
  steps,
  doneCount,
  hasProfile,
  state,
  submittedAt,
}: {
  steps: { key: string; label: string; done: boolean; href: string }[];
  doneCount: number;
  hasProfile: boolean;
  state: ApplicationState;
  submittedAt: string | null;
}) {
  const next = steps.find((step) => !step.done);

  if (state === 'WAITING') {
    return (
      <Card className="border-info/30 bg-info/5">
        <CardContent className="flex items-start gap-3 pt-6">
          <Clock className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">Waiting for approval</p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              You submitted {formatWhen(submittedAt)}. An officer is checking your identity,
              professional registration and documents. There is nothing more for you to do right now
              — you will be offered shifts as soon as it is done.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const ready = state === 'READY';

  return (
    <Card className="border-primary/30 bg-accent/30">
      <CardContent className="space-y-4 pt-6">
        <div className="min-w-0">
          <p className="font-medium">
            {ready
              ? 'Everything is in — submit it for approval'
              : hasProfile
                ? 'Finish setting up your profile'
                : 'Create your profile to get started'}
          </p>
          <p className="mt-1 max-w-xl text-base leading-relaxed text-muted-foreground">
            {ready
              ? 'An officer does not start reviewing until you submit. It takes one tap.'
              : `${doneCount} of ${steps.length} steps done${next ? `. Next up: ${next.label.toLowerCase()}.` : '.'}`}
          </p>
        </div>

        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-valuetext={`${doneCount} of ${steps.length} steps done`}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width]',
              ready ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        {/* Each unfinished item goes straight to where it is finished; done and not done differ in
            words as well as in the mark. */}
        <ul className="space-y-1">
          {steps.map((step) => (
            <li key={step.key}>
              {step.done ? (
                <span className="flex min-h-11 items-center gap-2">
                  <CircleCheck className="size-5 text-success" aria-hidden="true" />
                  {step.label}
                  <span className="sr-only"> — done</span>
                </span>
              ) : (
                <Link
                  href={step.href}
                  className="flex min-h-11 items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
                >
                  <Circle className="size-5" aria-hidden="true" />
                  {step.label}
                  <span className="sr-only"> — not done yet</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
