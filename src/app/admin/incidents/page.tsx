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
  type Tone,
} from '@/components/ui/primitives';

interface Incident {
  id: string;
  facilityId: string;
  assignmentId: string | null;
  subjectUserId: string | null;
  severity: string;
  category: string;
  summary: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
}

const OUTCOMES = [
  ['SYSTEM_ISSUE', 'System issue'],
  ['NO_ACTION', 'No action'],
  ['ADVICE_GIVEN', 'Advice given'],
  ['TRAINING_REQUIRED', 'Training required'],
  ['PRACTITIONER_SUSPENDED', 'Suspend practitioner'],
  ['REFERRED_TO_REGULATOR', 'Refer to regulator'],
] as const;

function severityTone(severity: string): Tone {
  if (severity === 'DEATH' || severity === 'SEVERE') return 'bad';
  if (severity === 'MODERATE') return 'warn';
  return 'neutral';
}

/**
 * Clinical incidents — module 15.
 *
 * `SYSTEM_ISSUE` is first in the outcome list, as it is in the enum, and that
 * ordering is the point: it is the commonest true answer to a clinical
 * incident and the one a blame-first process never reaches. Suspension is
 * near the bottom because it should be the unusual answer, not the default
 * the cursor lands on.
 */
export default function IncidentsPage() {
  const queue = useQueue<Incident>(
    '/api/v1/incidents/queue',
    (body: never) => (body as { incidents?: Incident[] }).incidents ?? [],
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Record<string, string>>({});

  async function review(id: string) {
    await queue.act(() => api.post(`/api/v1/incidents/${id}/review`));
  }

  async function close(id: string) {
    await queue.act(() =>
      api.post(`/api/v1/incidents/${id}/close`, {
        outcome: outcome[id] ?? 'SYSTEM_ISSUE',
        notes: notes[id]?.trim(),
      }),
    );
  }

  return (
    <>
      <PageHeader
        title="Clinical incidents"
        description="Most serious first. A report is not an accusation — most of these end as a system issue, and that is the answer worth reaching."
      />

      <ErrorNote error={queue.error} />

      {queue.loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : queue.rows.length === 0 ? (
        <Empty>Nothing open.</Empty>
      ) : (
        <div className="space-y-4">
          {queue.rows.map((row) => {
            const needsReview = ['SEVERE', 'DEATH'].includes(row.severity);
            const unopened = row.status === 'REPORTED';

            return (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>
                      <Badge>{row.category}</Badge>
                      <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                    </div>
                    <p className="text-sm">{row.summary}</p>
                    <p className="mt-2 text-xs text-muted">
                      Occurred {when(row.occurredAt)} · reported {when(row.reportedAt)} ·
                      {row.subjectUserId
                        ? ` names practitioner ${row.subjectUserId.slice(0, 8)}`
                        : ' names no practitioner'}
                    </p>
                  </div>
                </div>

                {needsReview && unopened ? (
                  <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                    <p className="mb-2">
                      A {row.severity.toLowerCase()} incident cannot be closed until somebody has
                      opened it.
                    </p>
                    <Button onClick={() => review(row.id)} disabled={queue.busy}>
                      Take this case
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <select
                      className={inputClass}
                      value={outcome[row.id] ?? 'SYSTEM_ISSUE'}
                      onChange={(event) =>
                        setOutcome((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    >
                      {OUTCOMES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>

                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="What was found and what follows. Required."
                      value={notes[row.id] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    />

                    {outcome[row.id] === 'PRACTITIONER_SUSPENDED' ? (
                      <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        This suspends the practitioner immediately. They stop matching everywhere
                        and their current session stops working on the next request.
                      </p>
                    ) : null}

                    <div className="flex gap-2">
                      {unopened ? (
                        <Button variant="secondary" onClick={() => review(row.id)} disabled={queue.busy}>
                          Take this case
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => close(row.id)}
                        disabled={queue.busy || (notes[row.id]?.trim().length ?? 0) < 20}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
