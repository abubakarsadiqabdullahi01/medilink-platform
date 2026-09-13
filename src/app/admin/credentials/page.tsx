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

interface Submission {
  id: string;
  userId: string;
  credentialTypeId: string;
  status: string;
  reference: string | null;
  expiresAt: string | null;
  createdAt: string;
  reviewNotes: string | null;
}

/**
 * Credential review — step 5.2.
 *
 * Three outcomes, not two: approve, reject, or ask for more information.
 * Rejecting a nurse because the photograph was blurred is how a platform
 * loses a nurse, and `request_info` is the middle answer that keeps the
 * submission open.
 *
 * Notes are mandatory for both of the latter, which the API enforces and
 * the button disables for — the same rule stated twice, deliberately, so
 * nobody discovers it only after typing nothing.
 */
export default function CredentialsPage() {
  const queue = useQueue<Submission>(
    '/api/v1/credentials?scopeType=PLATFORM&status=PENDING',
    (body: never) => (body as { submissions?: Submission[] }).submissions ?? [],
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function review(id: string, decision: 'approve' | 'reject' | 'request_info') {
    const ok = await queue.act(() =>
      api.post(`/api/v1/credentials/${id}/review`, {
        decision,
        reviewNotes: notes[id]?.trim() || undefined,
      }),
    );
    if (ok) setNotes((current) => ({ ...current, [id]: '' }));
  }

  return (
    <>
      <PageHeader
        title="Credentials"
        description="Pending submissions. A practitioner stays ineligible until every mandatory credential for their category is verified."
      />

      <ErrorNote error={queue.error} />

      {queue.loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : queue.rows.length === 0 ? (
        <Empty>Nothing waiting. Every submission has been reviewed.</Empty>
      ) : (
        <div className="space-y-4">
          {queue.rows.map((row) => (
            <Card key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{row.reference ?? 'No reference given'}</p>
                  <p className="mt-1 text-xs text-muted">
                    Practitioner {row.userId.slice(0, 8)} · submitted {when(row.createdAt)}
                    {row.expiresAt ? ` · expires ${when(row.expiresAt)}` : ''}
                  </p>
                </div>
                <Badge tone={toneFor(row.status)}>{row.status}</Badge>
              </div>

              <textarea
                className={`${inputClass} mt-4`}
                rows={2}
                placeholder="Why — required to reject or to ask for more."
                value={notes[row.id] ?? ''}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                }
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => review(row.id, 'approve')} disabled={queue.busy}>
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => review(row.id, 'request_info')}
                  disabled={queue.busy || !notes[row.id]?.trim()}
                >
                  Ask for more
                </Button>
                <Button
                  variant="danger"
                  onClick={() => review(row.id, 'reject')}
                  disabled={queue.busy || !notes[row.id]?.trim()}
                >
                  Reject
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
