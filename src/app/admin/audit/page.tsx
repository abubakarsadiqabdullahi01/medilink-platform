'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, X } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { keys, timing } from '@/lib/ui/query-keys';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { actionLabel, formatWhen, recordLabel, shortId } from '@/components/app/format';
import {
  AUDIT_AREA_LABELS,
  AUDIT_AREA_VALUES,
} from '@/modules/audit-compliance/domain/audit-areas';

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

  const pager = useCursorPager();

  const queue = useQuery({
    queryKey: keys.audit.page({ area, from, to, record, cursor: pager.cursor }),
    queryFn: () => {
      const parts = [
        'scopeType=PLATFORM',
        `limit=${PAGE_SIZE}`,
        area !== 'all' ? `area=${area}` : '',
        record ? `entityId=${record}` : '',
        from ? `from=${encodeURIComponent(dayStart(from))}` : '',
        to ? `to=${encodeURIComponent(dayEnd(to))}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
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
  const activeCount = (area !== 'all' ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (record ? 1 : 0);

  function clearAll() {
    setArea('all');
    setFrom('');
    setTo('');
    setRecord('');
    pager.startOver();
  }

  const columns: Column<AuditEntry>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (row) => <span className="text-muted-foreground">{formatWhen(row.createdAt)}</span>,
    },
    {
      id: 'what',
      header: 'What happened',
      role: 'identity',
      // Humanised, with the exact action on hover: a reader scans sentences, an investigator
      // quoting a row wants the string the code actually wrote.
      cell: (row) => (
        <Badge variant="secondary" title={row.action}>
          {actionLabel(row.action)}
        </Badge>
      ),
    },
    {
      id: 'record',
      header: 'Record',
      cell: (row) => (
        <>
          <span className="block text-muted-foreground">{recordLabel(row.entityType)}</span>
          {row.entityId ? (
            <button
              type="button"
              onClick={() => {
                setRecord(row.entityId as string);
                pager.startOver();
              }}
              aria-label={`Show everything recorded against this ${recordLabel(row.entityType).toLowerCase()}, ${shortId(row.entityId)}`}
              title="Show everything recorded against this record"
              className="-ml-1 inline-flex min-h-11 items-center rounded px-1 font-mono underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {shortId(row.entityId)}
            </button>
          ) : (
            <span className="font-mono">—</span>
          )}
        </>
      ),
    },
    {
      id: 'who',
      header: 'Who',
      // Named, because "who did this" is the question the column exists to answer and
      // `76576520` does not answer it. Naming an actor is not the same as being able to list
      // one: there is still no filter by person, which is where the surveillance concern
      // actually lives.
      //
      // No actor at all is a real answer — a sweep is not a person, and a name against a
      // finding nobody made would be worse than a blank. An id with no name left is an
      // account since erased; the uuid stays rather than the row losing its answer.
      cell: (row) =>
        row.actorName ? (
          <span>{row.actorName}</span>
        ) : row.actorId ? (
          <span className="font-mono" title="This account no longer exists">
            {shortId(row.actorId)}
          </span>
        ) : (
          <span className="italic text-muted-foreground">system</span>
        ),
    },
    {
      id: 'why',
      header: 'Why',
      cell: (row) => row.reason ?? '—',
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every state change, with who made it and why. Nothing here can be edited or deleted — including by the people who can read it."
      />

      <FilterBar
        activeCount={activeCount}
        onClear={clearAll}
        busy={queue.isFetching && !queue.isPending}
        summary={!queue.isPending && rows.length > 0 ? `${rows.length} on this page` : undefined}
      >
        <Field label="Area" className="md:min-w-[14rem]">
          {(a11y) => (
            <Select
              value={area}
              onValueChange={(value) => {
                setArea(value);
                pager.startOver();
              }}
            >
              <SelectTrigger {...a11y}>
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
          )}
        </Field>
        <Field label="From">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              pager.startOver();
            }}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              pager.startOver();
            }}
          />
        </Field>
      </FilterBar>

      {record ? (
        <Alert variant="info" className="mb-5">
          <ScrollText />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Everything recorded against <span className="font-mono">{shortId(record)}</span>.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setRecord('');
                pager.startOver();
              }}
            >
              <X />
              Show the whole trail
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {queue.isPending ? (
        <TableSkeleton rows={8} columns={5} label="Loading the audit trail" />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="entries" activeCount={activeCount} onClear={clearAll} />
        ) : (
          <EmptyState icon={<ScrollText />} title="Nothing recorded at platform scope yet" />
        )
      ) : (
        <DataTable
          caption="Audit trail, newest first"
          rows={rows}
          columns={columns}
          getKey={(row) => row.id}
        />
      )}

      <Pager
        pageIndex={pager.pageIndex}
        hasNext={Boolean(nextCursor)}
        busy={queue.isFetching}
        onPrevious={pager.goPrevious}
        onNext={() => pager.goNext(nextCursor)}
        previousLabel="Newer"
        nextLabel="Older"
      />
    </>
  );
}
