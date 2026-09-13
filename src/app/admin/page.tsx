'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { Card, PageHeader } from '@/components/ui/primitives';

/**
 * What is waiting.
 *
 * Each tile counts one queue, and a tile only appears if the viewer holds the
 * permission to work it — the same rule the navigation follows. Counting is
 * done by fetching the list and taking its length rather than by a count
 * endpoint, because none of these queues is ever long enough for that to
 * matter and a second endpoint per queue is a second thing to keep true.
 */
interface Tile {
  href: string;
  label: string;
  permission: string;
  path: string;
  pick: (body: never) => unknown[];
  hint: string;
}

const TILES: Tile[] = [
  {
    href: '/admin/credentials',
    label: 'Credentials awaiting review',
    permission: 'credential.review',
    path: '/api/v1/credentials?scopeType=PLATFORM&status=PENDING',
    pick: (body: never) => (body as { submissions?: unknown[] }).submissions ?? [],
    hint: 'A practitioner cannot be matched until these are verified.',
  },
  {
    href: '/admin/facilities',
    label: 'Facilities awaiting verification',
    permission: 'facility.verify',
    path: '/api/v1/facilities?scopeType=PLATFORM&status=PENDING',
    pick: (body: never) => (body as { facilities?: unknown[] }).facilities ?? [],
    hint: 'An unverified facility cannot publish a shift.',
  },
  {
    href: '/admin/incidents',
    label: 'Clinical incidents open',
    permission: 'incident.manage',
    path: '/api/v1/incidents/queue',
    pick: (body: never) => (body as { incidents?: unknown[] }).incidents ?? [],
    hint: 'Most serious first. A death outranks a near miss from March.',
  },
  {
    href: '/admin/disputes',
    label: 'Disputes to adjudicate',
    permission: 'dispute.manage',
    path: '/api/v1/disputes',
    pick: (body: never) => (body as { disputes?: unknown[] }).disputes ?? [],
    hint: 'A shift the two sides disagree about.',
  },
  {
    href: '/admin/unhonoured',
    label: 'Unhonoured shifts awaiting fault',
    permission: 'sanction.apply',
    path: '/api/v1/unhonoured',
    pick: (body: never) => (body as { unhonoured?: unknown[] }).unhonoured ?? [],
    hint: 'Nothing closes on its own. A person decides every one.',
  },
  {
    href: '/admin/suggestions',
    label: 'Suggestions not yet triaged',
    permission: 'suggestion.triage',
    path: '/api/v1/suggestions?status=NEW',
    pick: (body: never) => (body as { suggestions?: unknown[] }).suggestions ?? [],
    hint: 'What the pilot is telling you.',
  },
];

function Count({ tile }: { tile: Tile }) {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(tile.path)
      .then((body) => {
        if (!cancelled) setCount(tile.pick(body as never).length);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tile]);

  return (
    <Link href={tile.href}>
      <Card className="h-full transition hover:border-primary">
        <p className="text-sm font-medium">{tile.label}</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {failed ? '—' : count === null ? '·' : count}
        </p>
        <p className="mt-2 text-xs text-muted">{tile.hint}</p>
      </Card>
    </Link>
  );
}

export default function OverviewPage() {
  const session = useSession();
  const mine = TILES.filter((tile) => session.permissions.includes(tile.permission));

  return (
    <>
      <PageHeader
        title={`Good day, ${session.user.fullName.split(' ')[0]}`}
        description="Everything below is waiting on a person. Nothing in Medilink closes itself."
      />

      {mine.length === 0 ? (
        <Card>
          <p className="text-sm">
            This account holds no queue permissions. That is not a mistake in the console — the
            grants decide what appears here, and yours cover nothing on this page.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map((tile) => (
            <Count key={tile.href} tile={tile} />
          ))}
        </div>
      )}
    </>
  );
}
