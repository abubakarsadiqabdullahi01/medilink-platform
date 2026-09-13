'use client';

import { useEffect, useState } from 'react';
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

interface Suggestion {
  id: string;
  source: string;
  raisedBy: string | null;
  area: string;
  body: string;
  sourceRef: string | null;
  status: string;
  response: string | null;
  createdAt: string;
}

interface AreaCount {
  area: string;
  total: number;
  open: number;
}

const STATUSES = ['NEW', 'TRIAGED', 'PLANNED', 'DONE', 'DECLINED'] as const;

/**
 * The suggestion log — step 9.5.
 *
 * The summary sits above the list because it is the more useful of the two:
 * what a pilot needs is the shape of the complaints, not each one in turn.
 * "Eleven people have said the same thing about matching" is the finding.
 */
export default function SuggestionsPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('NEW');
  const queue = useQueue<Suggestion>(
    `/api/v1/suggestions?status=${status}`,
    (body: never) => (body as { suggestions?: Suggestion[] }).suggestions ?? [],
  );
  const [areas, setAreas] = useState<AreaCount[]>([]);
  const [response, setResponse] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .get<{ areas: AreaCount[] }>('/api/v1/suggestions/summary')
      .then((body) => setAreas(body.areas))
      .catch(() => setAreas([]));
  }, [queue.rows]);

  async function triage(id: string, next: string) {
    await queue.act(() =>
      api.post(`/api/v1/suggestions/${id}/triage`, {
        status: next,
        response: response[id]?.trim() || undefined,
      }),
    );
  }

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="What people said did not work. Decline reasons land here automatically, without the practitioner's name on them."
      />

      {areas.length > 0 ? (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium">By area</p>
          <div className="flex flex-wrap gap-2">
            {areas.map((row) => (
              <span key={row.area} className="rounded border px-3 py-1 text-xs">
                {row.area} · <strong className="tabular-nums">{row.total}</strong>
                {row.open > 0 ? <span className="text-muted"> ({row.open} open)</span> : null}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((value) => (
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
        <Empty>Nothing {status.toLowerCase()}.</Empty>
      ) : (
        <div className="space-y-4">
          {queue.rows.map((row) => {
            const closed = ['DONE', 'DECLINED'].includes(row.status);
            const answer = response[row.id]?.trim() ?? '';

            return (
              <Card key={row.id}>
                <div className="mb-2 flex flex-wrap gap-2">
                  <Badge>{row.area}</Badge>
                  <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                  {row.source === 'DECLINE_REASON' ? (
                    <Badge tone="warn">from a decline</Badge>
                  ) : null}
                </div>

                <p className="text-sm">{row.body}</p>
                <p className="mt-2 text-xs text-muted">
                  {when(row.createdAt)}
                  {row.source === 'DECLINE_REASON'
                    ? ' · no author, because they were answering an invitation rather than filing this'
                    : ''}
                </p>

                {row.response ? (
                  <p className="mt-3 rounded bg-border/20 px-3 py-2 text-sm">{row.response}</p>
                ) : null}

                {closed ? null : (
                  <>
                    <textarea
                      className={`${inputClass} mt-4`}
                      rows={2}
                      placeholder="An answer — required to mark it done or declined."
                      value={response[row.id] ?? ''}
                      onChange={(event) =>
                        setResponse((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.status === 'NEW' ? (
                        <Button
                          variant="secondary"
                          onClick={() => triage(row.id, 'TRIAGED')}
                          disabled={queue.busy}
                        >
                          Triaged
                        </Button>
                      ) : null}
                      {row.status !== 'PLANNED' ? (
                        <Button
                          variant="secondary"
                          onClick={() => triage(row.id, 'PLANNED')}
                          disabled={queue.busy}
                        >
                          Planned
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => triage(row.id, 'DONE')}
                        disabled={queue.busy || answer.length < 10}
                      >
                        Done
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => triage(row.id, 'DECLINED')}
                        disabled={queue.busy || answer.length < 10}
                      >
                        Decline
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
