'use client';

import { ScrollText, TriangleAlert } from 'lucide-react';
import { useQueue } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { formatWhen, shortId } from '@/components/app/format';

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
 * The audit trail — module 17. Read-only, and there is no filter by actor.
 *
 * The trail exists to answer "what happened to this record". A console that
 * made it easy to answer "what has this person been doing all week" is a
 * surveillance tool wearing a compliance badge, and the omission is the
 * design rather than a missing feature.
 */
export default function AuditPage() {
  const queue = useQueue<AuditEntry>(
    ['audit'],
    '/api/v1/audit?scopeType=PLATFORM&limit=100',
    (body) => (body as { entries?: AuditEntry[] }).entries ?? [],
  );

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every state change, with who made it and why. Nothing here can be edited or deleted — including by the people who can read it."
      />

      {queue.isPending ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>The trail could not be loaded.</AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="Nothing recorded at platform scope yet" />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
                <TableHead className="w-[110px]">Actor</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatWhen(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-[0.7rem]">
                      {row.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="block text-muted-foreground">{row.entityType}</span>
                    <span className="font-mono">{shortId(row.entityId)}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {/* No actor is a real answer: a sweep is not a person, and
                        a name against a finding nobody made would be worse
                        than a blank. */}
                    {row.actorId ? (
                      shortId(row.actorId)
                    ) : (
                      <span className="font-sans italic text-muted-foreground">system</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-xs">{row.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
