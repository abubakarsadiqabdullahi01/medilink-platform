'use client';

import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  FileCheck2,
  FileClock,
  Gavel,
  MessageSquareText,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-shell';

/**
 * What is waiting, and how urgently.
 *
 * Counts come from fetching each list and taking its length rather than from
 * count endpoints. None of these queues is ever long enough for that to cost
 * anything, and a count endpoint per queue is a second thing that can
 * disagree with the queue it counts.
 */
interface Tile {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  path: string;
  pick: (body: unknown) => unknown[];
  hint: string;
}

const TILES: Tile[] = [
  {
    href: '/admin/credentials',
    label: 'Credentials to review',
    icon: FileCheck2,
    permission: 'credential.review',
    path: '/api/v1/credentials?scopeType=PLATFORM&status=PENDING',
    pick: (body) => (body as { submissions?: unknown[] }).submissions ?? [],
    hint: 'A practitioner is ineligible until every mandatory credential is verified.',
  },
  {
    href: '/admin/facilities',
    label: 'Facilities to verify',
    icon: Building2,
    permission: 'facility.verify',
    path: '/api/v1/facilities?scopeType=PLATFORM&status=PENDING',
    pick: (body) => (body as { facilities?: unknown[] }).facilities ?? [],
    hint: 'An unverified facility cannot publish a shift.',
  },
  {
    href: '/admin/incidents',
    label: 'Clinical incidents open',
    icon: Stethoscope,
    permission: 'incident.manage',
    path: '/api/v1/incidents/queue',
    pick: (body) => (body as { incidents?: unknown[] }).incidents ?? [],
    hint: 'Most serious first. A death outranks a near miss from March.',
  },
  {
    href: '/admin/disputes',
    label: 'Disputes to adjudicate',
    icon: Gavel,
    permission: 'dispute.manage',
    path: '/api/v1/disputes',
    pick: (body) => (body as { disputes?: unknown[] }).disputes ?? [],
    hint: 'A decided shift the two sides disagree about.',
  },
  {
    href: '/admin/unhonoured',
    label: 'Shifts awaiting fault',
    icon: FileClock,
    permission: 'sanction.apply',
    path: '/api/v1/unhonoured',
    pick: (body) => (body as { unhonoured?: unknown[] }).unhonoured ?? [],
    hint: 'A sweep flags these. Only a person can close one.',
  },
  {
    href: '/admin/suggestions',
    label: 'Suggestions untriaged',
    icon: MessageSquareText,
    permission: 'suggestion.triage',
    path: '/api/v1/suggestions?status=NEW',
    pick: (body) => (body as { suggestions?: unknown[] }).suggestions ?? [],
    hint: 'What the pilot is telling you, decline reasons included.',
  },
];

export default function DashboardPage() {
  const session = useSession();
  const mine = TILES.filter((tile) => session.permissions.includes(tile.permission));

  const results = useQueries({
    queries: mine.map((tile) => ({
      queryKey: ['tile', tile.path],
      queryFn: async () => tile.pick(await api.get(tile.path)).length,
    })),
  });

  const firstName = session.user.fullName.split(' ')[0];
  const total = results.reduce((sum, result) => sum + (result.data ?? 0), 0);
  const settled = results.every((result) => !result.isPending);

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName}`}
        description={
          settled && total === 0
            ? 'Nothing is waiting on you. Every queue you can work is clear.'
            : 'Everything below is waiting on a person. Nothing in Medilink closes itself.'
        }
      />

      {mine.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This account holds no queue permissions, so there is nothing to show here. That is the
            grants deciding what you see, not a page failing to load.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map((tile, index) => {
            const result = results[index];
            const count = result?.data ?? 0;
            const Icon = tile.icon;

            return (
              <Link key={tile.href} href={tile.href} className="group">
                <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                        <Icon className="size-4" />
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>

                    <p className="mt-4 text-sm font-medium">{tile.label}</p>

                    {result?.isPending ? (
                      <Skeleton className="mt-2 h-9 w-12" />
                    ) : result?.isError ? (
                      <p className="mt-2 text-sm text-destructive">Could not load</p>
                    ) : (
                      <p
                        className={
                          count > 0
                            ? 'tabular mt-1 text-3xl font-semibold'
                            : 'tabular mt-1 text-3xl font-semibold text-muted-foreground'
                        }
                      >
                        {count}
                      </p>
                    )}

                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {tile.hint}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
