'use client';

import { useQueue } from '@/lib/ui/queue';
import { Badge, Card, Empty, ErrorNote, PageHeader, when } from '@/components/ui/primitives';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  scopeType: string;
  scopeId: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * The audit trail — module 17.
 *
 * Read-only, and there is no filter by actor here on purpose. The trail
 * exists to answer "what happened to this record", and a console that made it
 * easy to answer "what has this person been doing all week" is a surveillance
 * tool wearing a compliance badge. Scope and entity are the axes it is meant
 * to be read on.
 */
export default function AuditPage() {
  const queue = useQueue<AuditEntry>(
    '/api/v1/audit?scopeType=PLATFORM&limit=100',
    (body: never) => (body as { entries?: AuditEntry[] }).entries ?? [],
  );

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every state change in the platform, with who made it and why. Nothing here can be edited or deleted, including by the people who can read it."
      />

      <ErrorNote error={queue.error} />

      {queue.loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : queue.rows.length === 0 ? (
        <Empty>Nothing recorded at platform scope yet.</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-border/20">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Record</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {queue.rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">
                    {when(row.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge>{row.action}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <span className="text-muted">{row.entityType}</span>
                    <br />
                    {row.entityId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {/* No actor is a real answer: a sweep is not a person. */}
                    {row.actorId ? row.actorId.slice(0, 8) : <span className="text-muted">system</span>}
                  </td>
                  <td className="max-w-xs px-4 py-2 text-xs">{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
