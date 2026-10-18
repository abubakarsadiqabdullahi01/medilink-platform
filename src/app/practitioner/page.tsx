'use client';

import Link from 'next/link';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Circle,
  CircleAlert,
  CircleCheck,
  Clock,
  Inbox,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import {
  BLOCKER_GUIDE,
  useEligibility,
  usePractitionerSetup,
  type ApplicationState,
} from '@/lib/ui/practitioner';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { ReturnedNotice } from '@/app/practitioner/profile/returned-notice';
import { PageHeader } from '@/components/app/page-shell';
import { MyInvitations } from '@/components/app/my-invitations';
import { formatWhen } from '@/components/app/format';

interface Assignment {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
}

interface Invitation {
  id: string;
  status: string;
  expiresAt: string;
}

/**
 * What a practitioner needs to know on opening the app.
 *
 * Eligibility comes first and in plain words, because it is the answer to the
 * only question that matters to somebody who is not getting offered work: the
 * blockers are the reasons, and hiding them behind "ineligible" would make
 * support the only way to find out.
 */
export default function PractitionerHome() {
  const session = useSession();
  const queryClient = useQueryClient();

  // One request for everything below. Each section keeps its own query key —
  // the profile page, the offers queue and the rest read the same ones — so the
  // answer is written under those keys and the hooks find it fresh instead of
  // each asking again. If this fails, or a section was withheld, the hooks ask
  // for themselves, so the overview degrades to the old behaviour and no
  // further.
  const bundle = useQuery({
    queryKey: ['practitioner-overview'],
    queryFn: async () => {
      const data = await api.get<OverviewBundle>('/api/v1/dashboard/practitioner');
      seedOverview(queryClient, data);
      return data;
    },
    retry: false,
  });

  if (bundle.isPending) {
    return (
      <>
        <PageHeader
          title={`Hello, ${session.user.fullName.split(' ')[0]}`}
          description="Whether you can be offered work, what is waiting on an answer, and where you are next due."
        />
        <div className="space-y-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </>
    );
  }

  return <Overview />;
}

/** What `/api/v1/dashboard/practitioner` returns; a section is absent if withheld. */
interface OverviewBundle {
  profile?: unknown;
  eligibility?: unknown;
  availability?: unknown;
  submissions?: unknown;
  invitations?: unknown;
  assignments?: unknown;
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

function Overview() {
  const session = useSession();

  // Same query key as the setup hook reads, so this is one request, not two —
  // and it is used directly because a failed fetch has to stay distinguishable
  // from "no blockers".
  const eligibility = useEligibility();
  const setup = usePractitionerSetup();

  /**
   * These unwrap the envelope before caching, and that is load-bearing rather
   * than tidy: `['invitations']` is also read by the offers queue, which
   * caches the list itself. Two shapes under one key meant whichever page
   * rendered first won the cache, and the other got a value it could not
   * use — arriving as `.filter is not a function` on the *second* page, which
   * is the page that looks broken. One key, one shape.
   */
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => {
      const body = await api.get<{ invitations?: Invitation[] }>('/api/v1/invitations');
      return body.invitations ?? [];
    },
    retry: false,
  });

  const assignments = useQuery({
    queryKey: ['my-assignments'],
    queryFn: async () => {
      const body = await api.get<{ assignments?: Assignment[] }>(
        '/api/v1/assignments?scopeType=SELF&status=CONFIRMED',
      );
      return body.assignments ?? [];
    },
    retry: false,
  });

  const reasons = (eligibility.data?.blockers ?? []).map((blocker) => ({
    blocker,
    guide: BLOCKER_GUIDE[blocker] ?? { says: humanise(blocker) },
  }));
  const yours = reasons.filter((reason) => reason.guide.href);
  const ours = reasons.filter((reason) => !reason.guide.href);

  const open = (invitations.data ?? []).filter((row) => row.status === 'INVITED');
  const next = [...(assignments.data ?? [])]
    .filter((row) => new Date(row.endsAt) > new Date())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];

  return (
    <>
      <PageHeader
        title={`Hello, ${session.user.fullName.split(' ')[0]}`}
        description="Whether you can be offered work, what is waiting on an answer, and where you are next due."
      />

      <MyInvitations />

      {/* Width becomes columns, not longer lines: status on the left, the two
          figures beside it, and on a phone they simply stack. */}
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {setup.ready && setup.state === 'CHANGES_NEEDED' ? (
            <ReturnedNotice rejected={setup.rejected} />
          ) : null}

          {setup.ready && setup.state !== 'APPROVED' && setup.state !== 'CHANGES_NEEDED' ? (
            <SetupCard
              steps={setup.steps}
              doneCount={setup.doneCount}
              hasProfile={setup.hasProfile}
              state={setup.state}
              submittedAt={setup.submittedForReviewAt}
            />
          ) : null}

          {eligibility.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : eligibility.data ? (
            <Card
              className={cn(eligibility.data.eligible ? 'border-success/40' : 'border-warning/40')}
            >
              <CardContent className="flex items-start gap-3 pt-6">
                {eligibility.data.eligible ? (
                  <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {eligibility.data.eligible
                      ? 'You can be offered shifts'
                      : 'You cannot be offered shifts yet'}
                  </p>
                  {eligibility.data.eligible ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Everything the platform requires is in place.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-muted-foreground">
                        These are the reasons, in full. Nothing is being withheld.
                      </p>

                      <div className="mt-4 grid gap-x-10 gap-y-4 2xl:grid-cols-2">
                        {yours.length > 0 ? (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Yours to do
                            </p>
                            <ul className="mt-2 space-y-2">
                              {yours.map(({ blocker, guide }) => (
                                <li key={blocker} className="text-sm leading-relaxed">
                                  {guide.says}{' '}
                                  {guide.href && guide.action ? (
                                    <Link
                                      href={guide.href}
                                      className="font-medium text-primary underline-offset-4 hover:underline"
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
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Waiting on Medilink
                            </p>
                            <ul className="mt-2 space-y-2">
                              {ours.map(({ blocker, guide }) => (
                                <li
                                  key={blocker}
                                  className="text-sm leading-relaxed text-muted-foreground"
                                >
                                  {guide.says}
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Nothing in this second list is waiting on you.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            // Silence here used to be the failure mode: the card simply vanished,
            // and an absent blocker list reads as "nothing is wrong with my
            // account" — the opposite of what a failed fetch means.
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>
                Your eligibility could not be loaded, so this page cannot say whether you can be
                offered shifts. Nothing about your account has changed — try again in a moment.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Offers waiting</CardTitle>
            </CardHeader>
            <CardContent>
              {invitations.isPending ? (
                <Skeleton className="h-9 w-12" />
              ) : invitations.isError ? (
                <p className="text-sm text-destructive-text">Could not load</p>
              ) : (
                <>
                  <p className="tabular text-3xl font-semibold">{open.length}</p>
                  {open.length > 0 ? (
                    <Link
                      href="/practitioner/offers"
                      className={cn(buttonVariants({ size: 'sm' }), 'mt-3')}
                    >
                      <Inbox />
                      Answer them
                    </Link>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Nothing to answer.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Next shift</CardTitle>
            </CardHeader>
            <CardContent>
              {assignments.isPending ? (
                <Skeleton className="h-9 w-40" />
              ) : assignments.isError ? (
                <p className="text-sm text-destructive-text">Could not load</p>
              ) : next ? (
                <>
                  <p className="font-medium">{formatWhen(next.startsAt)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    until {formatWhen(next.endsAt)}
                  </p>
                  <StatusBadge status={next.status} className="mt-3" />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing confirmed.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * Where their application stands, and the one thing to do about it.
 *
 * It sits above the eligibility reasons rather than inside them because it is
 * what a practitioner can act on in one click: the reasons explain *why*
 * nothing is arriving, this is the fix — or, once they have done their part,
 * the plain statement that it is somebody else's turn.
 *
 * Three states, because "your setup" means three different things to somebody:
 * something of theirs is missing (go and add it — each missing item is its own
 * link, straight to where it is added); everything is in but they have not said
 * so (nobody has been told, and the card says that); and sent (waiting).
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
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              You submitted {formatWhen(submittedAt)}. An officer is checking your identity,
              professional registration and documents. There is nothing more for you to do right now
              — you will be offered shifts as soon as it is done.
            </p>
            <Link
              href="/practitioner/profile"
              className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              View my profile
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const ready = state === 'READY';

  return (
    <Card className="border-primary/30 bg-accent/30">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium">
              {ready
                ? 'Everything is in — submit it for approval'
                : hasProfile
                  ? 'Finish setting up your profile'
                  : 'Create your profile to get started'}
            </p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {ready
                ? 'An officer does not start reviewing until you submit. It takes one click.'
                : `${doneCount} of ${steps.length} steps done${next ? `. Next up: ${next.label.toLowerCase()}.` : '.'}`}
            </p>
          </div>
          <Link href="/practitioner/profile" className={buttonVariants()}>
            {ready ? 'Review and submit' : hasProfile ? 'Continue setup' : 'Start setup'}
            <ArrowRight />
          </Link>
        </div>

        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width]',
              ready ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        {/* Each unfinished item goes straight to where it is finished. */}
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {steps.map((step) => (
            <li key={step.key}>
              {step.done ? (
                <span className="flex items-center gap-1.5">
                  <CircleCheck className="size-4 text-success" aria-hidden="true" />
                  {step.label}
                </span>
              ) : (
                <Link
                  href={step.href}
                  className="flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  <Circle className="size-4" aria-hidden="true" />
                  {step.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
