'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
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

  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get<{ invitations: Invitation[] }>('/api/v1/invitations'),
    retry: false,
  });

  const assignments = useQuery({
    queryKey: ['my-assignments'],
    queryFn: () =>
      api.get<{ assignments: Assignment[] }>('/api/v1/assignments?scopeType=SELF&status=CONFIRMED'),
    retry: false,
  });

  const open = (invitations.data?.invitations ?? []).filter((row) => row.status === 'INVITED');
  const next = [...(assignments.data?.assignments ?? [])]
    .filter((row) => new Date(row.endsAt) > new Date())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];

  return (
    <>
      <PageHeader title={`Hello, ${session.user.fullName.split(' ')[0]}`} />

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
                  <ul className="mt-2 space-y-1">
                    {eligibility.data.blockers.map((blocker) => (
                      <li key={blocker} className="text-sm">
                        · {humanise(blocker)}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/practitioner/credentials"
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3')}
                  >
                    Sort this out
                  </Link>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Offers waiting</CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.isPending ? (
              <Skeleton className="h-9 w-12" />
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
