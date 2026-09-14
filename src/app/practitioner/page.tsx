'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Inbox, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { formatWhen } from '@/components/app/format';

interface Eligibility {
  eligible: boolean;
  blockers: string[];
}

interface BlockerGuide {
  says: string;
  href?: string;
  action?: string;
}

/**
 * What each blocker actually means, and who can clear it.
 *
 * Half of these are not the practitioner's to fix: identity and professional
 * registration are recorded by a compliance officer, on purpose — "a
 * practitioner does not verify their own identity, which is the whole point".
 * This card used to list every blocker and then offer one "Sort this out"
 * button pointing at credentials, which could resolve neither. Somebody
 * following it found a page with nothing on it for them and no way to tell
 * whether they had missed a step or were simply waiting.
 *
 * So: what is yours to do carries a link, what is ours says so plainly.
 */
const BLOCKER_GUIDE: Record<string, BlockerGuide> = {
  profile_incomplete: {
    says: 'Your profile is missing something the matcher needs.',
    href: '/practitioner/profile',
    action: 'Finish your profile',
  },
  credential_missing: {
    says: 'A credential your profession requires has not been submitted yet.',
    href: '/practitioner/credentials',
    action: 'Submit it',
  },
  credential_expired: {
    says: 'One of your credentials has expired, so it no longer counts.',
    href: '/practitioner/credentials',
    action: 'Submit the current one',
  },
  identity_unverified: {
    says: 'Your NIN has not been recorded yet. A compliance officer does that once they have seen your identity slip.',
  },
  identity_name_mismatch: {
    says: 'The name on your NIN does not match the name on this account. Medilink has to settle which is right before you can be matched.',
  },
  registration_missing: {
    says: 'Your professional registration is not on record. An officer records it against your licence.',
  },
  registration_not_active: {
    says: 'The registration on record is not currently active. If you have renewed your licence, tell Medilink so it can be re-recorded.',
  },
  registration_evidence_stale: {
    says: 'Your registration was last confirmed too long ago and is due a re-check by Medilink.',
  },
  screening_not_clear: {
    says: 'A screening check is still open. Medilink resolves this one.',
  },
  account_not_usable: {
    says: 'This account is not active, which stops everything else. Medilink has to lift that first.',
  },
};

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

  const eligibility = useQuery({
    queryKey: ['eligibility'],
    queryFn: () => api.get<Eligibility>('/api/v1/practitioners/eligibility?scopeType=SELF'),
    retry: false,
  });

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

      {eligibility.isPending ? (
        <Skeleton className="mb-6 h-24 w-full" />
      ) : eligibility.data ? (
        <Card
          className={cn(
            'mb-6',
            eligibility.data.eligible ? 'border-success/40' : 'border-warning/40',
          )}
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

                  {yours.length > 0 ? (
                    <div className="mt-4">
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
                    <div className="mt-4">
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
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        // Silence here used to be the failure mode: the card simply vanished,
        // and an absent blocker list reads as "nothing is wrong with my
        // account" — the opposite of what a failed fetch means.
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert />
          <AlertDescription>
            Your eligibility could not be loaded, so this page cannot say whether you can be offered
            shifts. Nothing about your account has changed — try again in a moment.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Offers waiting</CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.isPending ? (
              <Skeleton className="h-9 w-12" />
            ) : invitations.isError ? (
              <p className="text-sm text-destructive">Could not load</p>
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
              <p className="text-sm text-destructive">Could not load</p>
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
    </>
  );
}
