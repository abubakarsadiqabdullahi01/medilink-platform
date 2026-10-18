'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText, X } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { keys, timing } from '@/lib/ui/query-keys';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ErrorState } from '@/components/app/states';
import { actionLabel, formatWhen, recordLabel, shortId } from '@/components/app/format';
import { AUDIT_AREA_LABELS, AUDIT_AREA_VALUES } from '@/modules/audit-compliance/domain/audit-areas';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  scopeType: string;
  scopeId: string | null;
  reason: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

/**
 * Lagos, not UTC.
 *
 * A date input gives a bare `2026-09-15`, which the API coerces to midnight
 * UTC — one o'clock in the morning here. Sending it raw meant "to: today"
 * quietly cut the day at 01:00 WAT and hid almost everything that had
 * happened in it, which on an audit trail is the kind of gap somebody draws a
 * conclusion from. The offset is written out because every other time on this
 * screen is displayed in it.
 */
function dayStart(date: string): string {
  return `${date}T00:00:00+01:00`;
}

function dayEnd(date: string): string {
  return `${date}T23:59:59.999+01:00`;
}

/**
 * The audit trail — module 17. Read-only, and there is no filter by actor.
 *
 * The trail exists to answer "what happened to this record". A console that
 * made it easy to answer "what has this person been doing all week" is a
 * surveillance tool wearing a compliance badge, and the omission is the
 * design rather than a missing feature — see `domain/audit-areas.ts`.
 *
 * Area, a date range and a single record narrow by what happened, when, and
 * to what — never by who. Every row names its actor, because that is the
 * question an audit row exists to answer; what is withheld is the ability to
 * pivot the whole trail onto one person, which is the different thing.
 *
 * What was missing was paging: this used to fetch `limit=100` once and stop,
 * which on a trail past its first hundred rows silently hid everything older
 * than that with no way to reach it.
 */
export default function AuditPage() {
  const [area, setArea] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /** One record's whole story, which is the question the trail exists for. */
  const [record, setRecord] = useState('');

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queue = useQuery({
    queryKey: keys.audit.page({ area, from, to, record, cursor }),
    queryFn: () => {
      const parts = [
        'scopeType=PLATFORM',
        `limit=${PAGE_SIZE}`,
        area !== 'all' ? `area=${area}` : '',
        record ? `entityId=${record}` : '',
        from ? `from=${encodeURIComponent(dayStart(from))}` : '',
        to ? `to=${encodeURIComponent(dayEnd(to))}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ entries?: AuditEntry[]; nextCursor?: string | null }>(
        `/api/v1/audit?${parts.join('&')}`,
      );
    },
    // Append-only: a row already read can never change, so staleness costs
    // nothing but the newest few.
    staleTime: timing.stable,
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.entries ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const filtered = area !== 'all' || Boolean(from) || Boolean(to) || Boolean(record);

  function clearAll() {
    setArea('all');
    setFrom('');
    setTo('');
    setRecord('');
    startOver();
  }

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every state change, with who made it and why. Nothing here can be edited or deleted — including by the people who can read it."
      />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] space-y-1.5">
              <Label htmlFor="audit-area">Area</Label>
              <Select
                value={area}
                onValueChange={(value) => {
                  setArea(value);
                  startOver();
                }}
              >
                <SelectTrigger id="audit-area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every area</SelectItem>
                  {AUDIT_AREA_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {AUDIT_AREA_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-from">From</Label>
              <Input
                id="audit-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  startOver();
                }}
                className="w-40"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-to">To</Label>
              <Input
                id="audit-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  startOver();
                }}
                className="w-40"
              />
            </div>

            {filtered ? (
              <Button
                type="button"
                variant="ghost"
                onClick={clearAll}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {!queue.isPending && rows.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">{rows.length} on this page</p>
          ) : null}
        </CardContent>
      </Card>

      {record ? (
        <Alert variant="info" className="mb-5">
          <ScrollText />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Everything recorded against <span className="font-mono">{shortId(record)}</span>.
            </span>
            <Button type="button" size="sm" variant="outline" onClick={clearAll}>
              <X />
              Show the whole trail
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {queue.isPending ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ) : queue.isError ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={filtered ? 'Nothing matches that' : 'Nothing recorded at platform scope yet'}
          description={filtered ? 'Try a different area or date range.' : undefined}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">When</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Record</TableHead>
                <TableHead className="w-[160px]">Who</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatWhen(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    {/* Humanised, with the exact action on hover: a reader
                        scans sentences, an investigator quoting a row wants
                        the string the code actually wrote. */}
                    <Badge variant="secondary" title={row.action}>
                      {actionLabel(row.action)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="block text-muted-foreground">
                      {recordLabel(row.entityType)}
                    </span>
                    {row.entityId ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRecord(row.entityId as string);
                          startOver();
                        }}
                        title="Show everything recorded against this record"
                        className="font-mono underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {shortId(row.entityId)}
                      </button>
                    ) : (
                      <span className="font-mono">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {/* Named, because "who did this" is the question the
                        column exists to answer and `76576520` does not answer
                        it. Naming an actor is not the same as being able to
                        list one: there is still no filter by person, which is
                        where the surveillance concern actually lives.

                        No actor at all is a real answer — a sweep is not a
                        person, and a name against a finding nobody made would
                        be worse than a blank. An id with no name left is an
                        account since erased; the uuid stays rather than the
                        row losing its answer. */}
                    {row.actorName ? (
                      <span className="truncate">{row.actorName}</span>
                    ) : row.actorId ? (
                      <span className="font-mono" title="This account no longer exists">
                        {shortId(row.actorId)}
                      </span>
                    ) : (
                      <span className="italic text-muted-foreground">system</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-xs">{row.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {rows.length > 0 && (pageIndex > 0 || nextCursor) ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pageIndex === 0 || queue.isFetching}
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
          >
            <ChevronLeft />
            Newer
          </Button>

          <p className="tabular text-xs text-muted-foreground">
            Page {pageIndex + 1}
            {queue.isFetching ? ' · loading' : ''}
          </p>

          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor || queue.isFetching}
            onClick={() => {
              if (!nextCursor) return;
              setCursors((current) => {
                const next = current.slice(0, pageIndex + 1);
                next.push(nextCursor);
                return next;
              });
              setPageIndex((index) => index + 1);
            }}
          >
            Older
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </>
  );
}
