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
  when,
} from '@/components/ui/primitives';

interface Unhonoured {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  status: string;
  fault: string | null;
  shiftEndedAt: string;
  detectedAt: string;
}

const FAULTS = [
  ['PRACTITIONER', 'The practitioner', 'Records a no-show against them. This is the only outcome that affects their reliability.'],
  ['FACILITY', 'The facility', 'The ward was shut, nobody was told, the shift never existed. Costs the practitioner nothing.'],
  ['NEITHER', 'Neither', 'A flood, a death in the family, something nobody could have prevented. A real answer, not a way of avoiding the question.'],
] as const;

/**
 * Unhonoured shifts — step 7.7.
 *
 * The sweep flags; a person decides. The three options carry their
 * consequences in the interface because only one of them marks somebody's
 * record, and an officer clicking through a queue should not have to
 * remember which.
 */
export default function UnhonouredPage() {
  const queue = useQueue<Unhonoured>(
    '/api/v1/unhonoured',
    (body: never) => (body as { unhonoured?: Unhonoured[] }).unhonoured ?? [],
  );
  const [fault, setFault] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});

  async function decide(assignmentId: string) {
    await queue.act(() =>
      api.post(`/api/v1/assignments/${assignmentId}/fault`, {
        fault: fault[assignmentId],
        reason: reason[assignmentId]?.trim(),
      }),
    );
  }

  return (
    <>
      <PageHeader
        title="Unhonoured shifts"
        description="A shift that ended with no sign of anybody attending. An absence has a dozen innocent explanations and the platform cannot tell them apart — so nothing here closes until you say whose fault it was."
      />

      <ErrorNote error={queue.error} />

      {queue.loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : queue.rows.length === 0 ? (
        <Empty>Nothing awaiting a decision.</Empty>
      ) : (
        <div className="space-y-4">
          {queue.rows.map((row) => {
            const chosen = fault[row.assignmentId];
            const note = reason[row.assignmentId]?.trim() ?? '';

            return (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">Shift {row.assignmentId.slice(0, 8)}</p>
                    <p className="mt-1 text-xs text-muted">
                      Practitioner {row.userId.slice(0, 8)} · ended {when(row.shiftEndedAt)} ·
                      flagged {when(row.detectedAt)}
                    </p>
                  </div>
                  <Badge tone="warn">{row.status}</Badge>
                </div>

                <fieldset className="mt-4 space-y-2">
                  <legend className="mb-1 text-sm font-medium">Whose fault was it?</legend>
                  {FAULTS.map(([value, label, consequence]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer gap-3 rounded border p-3 text-sm ${
                        chosen === value ? 'border-primary bg-primary/5' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name={`fault-${row.id}`}
                        checked={chosen === value}
                        onChange={() =>
                          setFault((current) => ({ ...current, [row.assignmentId]: value }))
                        }
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">{label}</span>
                        <span className="mt-0.5 block text-xs text-muted">{consequence}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                <textarea
                  className={`${inputClass} mt-3`}
                  rows={2}
                  placeholder="What you found. Required."
                  value={reason[row.assignmentId] ?? ''}
                  onChange={(event) =>
                    setReason((current) => ({ ...current, [row.assignmentId]: event.target.value }))
                  }
                />

                <div className="mt-3">
                  <Button
                    onClick={() => decide(row.assignmentId)}
                    disabled={queue.busy || !chosen || note.length < 10}
                  >
                    Record the decision
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
