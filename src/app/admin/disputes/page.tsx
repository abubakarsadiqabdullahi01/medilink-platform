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

interface Dispute {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  raisedParty: string;
  category: string;
  reason: string;
  status: string;
  createdAt: string;
}

/**
 * Disputes — module 14.
 *
 * Both outcomes carry a consequence worth stating on the button rather than
 * leaving to be discovered: upholding sends the figures back to be decided
 * again, and dismissing puts the shift back exactly where it was. An
 * adjudicator who does not know which is which will pick wrong.
 */
export default function DisputesPage() {
  const queue = useQueue<Dispute>(
    '/api/v1/disputes',
    (body: never) => (body as { disputes?: Dispute[] }).disputes ?? [],
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function resolve(id: string, outcome: 'UPHELD' | 'DISMISSED') {
    await queue.act(() =>
      api.post(`/api/v1/disputes/${id}/resolve`, { outcome, notes: notes[id]?.trim() }),
    );
  }

  async function take(id: string) {
    await queue.act(() => api.post(`/api/v1/disputes/${id}/review`));
  }

  return (
    <>
      <PageHeader
        title="Disputes"
        description="A shift the two sides disagree about, after it was decided. Upholding sends the figures back to be decided again; dismissing restores the record exactly as it was."
      />

      <ErrorNote error={queue.error} />

      {queue.loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : queue.rows.length === 0 ? (
        <Empty>No live cases.</Empty>
      ) : (
        <div className="space-y-4">
          {queue.rows.map((row) => (
            <Card key={row.id}>
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge tone={row.raisedParty === 'PRACTITIONER' ? 'neutral' : 'warn'}>
                  raised by {row.raisedParty.toLowerCase()}
                </Badge>
                <Badge>{row.category}</Badge>
                <Badge tone={toneFor(row.status)}>{row.status}</Badge>
              </div>

              <p className="text-sm">{row.reason}</p>
              <p className="mt-2 text-xs text-muted">
                Shift {row.assignmentId.slice(0, 8)} · practitioner {row.userId.slice(0, 8)} ·
                opened {when(row.createdAt)}
              </p>

              <textarea
                className={`${inputClass} mt-4`}
                rows={2}
                placeholder="What was found. Required, and both sides will read it."
                value={notes[row.id] ?? ''}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                }
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {row.status === 'OPEN' ? (
                  <Button variant="secondary" onClick={() => take(row.id)} disabled={queue.busy}>
                    Take this case
                  </Button>
                ) : null}
                <Button
                  onClick={() => resolve(row.id, 'UPHELD')}
                  disabled={queue.busy || (notes[row.id]?.trim().length ?? 0) < 20}
                >
                  Uphold — send the figures back
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => resolve(row.id, 'DISMISSED')}
                  disabled={queue.busy || (notes[row.id]?.trim().length ?? 0) < 20}
                >
                  Dismiss — restore the record
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
