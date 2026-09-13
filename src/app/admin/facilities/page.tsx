'use client';

import { useState } from 'react';
import { api } from '@/lib/ui/api';
import { useQueue } from '@/lib/ui/queue';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  PageHeader,
  inputClass,
  toneFor,
  when,
} from '@/components/ui/primitives';

interface Facility {
  id: string;
  name: string;
  cacNumber: string;
  status: string;
  addressLine: string;
  contactPhone: string;
  licenceNumber: string | null;
  licenceExpiresAt: string | null;
  createdAt: string;
}

/**
 * Facility verification — step 5.10.
 *
 * The status filter is a real filter rather than a tab: a verified facility
 * is not something anyone works, and putting it in the same list as the ones
 * that need attention is how a queue becomes a report nobody reads.
 */
const FILTERS = ['PENDING', 'VERIFIED', 'REJECTED'] as const;

export default function FacilitiesPage() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('PENDING');
  const queue = useQueue<Facility>(
    `/api/v1/facilities?scopeType=PLATFORM&status=${status}`,
    (body: never) => (body as { facilities?: Facility[] }).facilities ?? [],
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function verify(id: string, decision: 'approve' | 'reject') {
    await queue.act(() =>
      api.post(`/api/v1/facilities/${id}/verify`, {
        decision,
        reviewNotes: notes[id]?.trim() || undefined,
      }),
    );
  }

  return (
    <>
      <PageHeader
        title="Facilities"
        description="A facility cannot publish a shift until it is verified, and changing the licence of a verified one sends it back here."
      />

      <div className="mb-4 flex gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            onClick={() => setStatus(value)}
            className={`rounded px-3 py-1 text-sm ${
              status === value ? 'bg-primary text-primary-foreground' : 'border bg-surface'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <ErrorNote error={queue.error} />

      {queue.loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : queue.rows.length === 0 ? (
        <Empty>No {status.toLowerCase()} facilities.</Empty>
      ) : (
        <div className="space-y-4">
          {queue.rows.map((row) => (
            <Card key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{row.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {row.cacNumber} · {row.addressLine} · {row.contactPhone}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Licence {row.licenceNumber ?? 'not given'}
                    {row.licenceExpiresAt ? `, expires ${when(row.licenceExpiresAt)}` : ''} ·
                    created {when(row.createdAt)}
                  </p>
                </div>
                <Badge tone={toneFor(row.status)}>{row.status}</Badge>
              </div>

              {row.status === 'PENDING' ? (
                <>
                  <textarea
                    className={`${inputClass} mt-4`}
                    rows={2}
                    placeholder="Why — required to reject."
                    value={notes[row.id] ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                  />
                  <div className="mt-3 flex gap-2">
                    <Button onClick={() => verify(row.id, 'approve')} disabled={queue.busy}>
                      Verify
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => verify(row.id, 'reject')}
                      disabled={queue.busy || !notes[row.id]?.trim()}
                    >
                      Reject
                    </Button>
                  </div>
                </>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
