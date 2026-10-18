'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Send, Users } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { useFacilityId } from '@/lib/ui/facility';
import { useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { useSession } from '@/lib/ui/session';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatMinutes, formatNaira, formatShiftWindow } from '@/components/app/format';
import { NewShiftDialog } from './new-shift-dialog';

interface ServiceRequest {
  id: string;
  facilityId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  cadreLevelId: string | null;
  supervisionAvailable: boolean;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  confirmedCount?: number;
  hourlyRateKobo: number;
  urgency: string;
  status: string;
  cancellationTerms: string;
  notes: string | null;
}

const STATUSES = ['PUBLISHED', 'FILLED', 'DRAFT', 'CANCELLED', 'EXPIRED'] as const;
const PAGE_SIZE = 20;

const NOTHING_HERE: Record<string, { title: string; description?: string }> = {
  PUBLISHED: {
    title: 'No published shifts',
    description: 'Publish one and it becomes available to match against.',
  },
  FILLED: {
    title: 'No filled shifts',
    description: 'A shift appears here once every place on it has a confirmed practitioner.',
  },
  DRAFT: {
    title: 'No drafts',
    description:
      'A draft is a shift that was saved but could not be published. If one is left behind, it is listed here so you can try again.',
  },
  CANCELLED: { title: 'No cancelled shifts' },
  EXPIRED: {
    title: 'No expired shifts',
    description: 'A shift expires when its start time passes before every place is filled.',
  },
};

/**
 * Module 6 — service requests, from the facility's side.
 *
 * The screen a scheduler scans every morning: one row per shift, with what it is, when it is,
 * what it pays, how many places are filled and what to do next. On a wide screen that is a table;
 * on a phone each row becomes a card that keeps the same five facts and the next step, rather
 * than a table scrolled sideways. The row still links out to the shift's own page for the parts
 * a list has no room for — notes, the full cancellation terms, who has been invited.
 *
 * Publishing an existing draft is its own action here: a draft left behind by a failed publish
 * (the facility was not verified yet, the rate floor moved, the start time had passed by the
 * time the button was clicked) has no other way forward than being rebuilt. The publish endpoint
 * already takes an existing draft; this exposes it — behind a confirmation, because publishing
 * is what makes a shift visible to practitioners.
 *
 * Cancelling is the one irreversible thing on the page, so it names the shift, says how many
 * people it affects and what they are told, and needs a reason.
 */
export default function ShiftsPage() {
  const facilityId = useFacilityId();
  const reference = useReference();
  const session = useSession();

  /**
   * Shifts is reached on `service_request.read`, which several facility roles hold without
   * holding anything that changes a shift — an administrator, and an accounts officer who needs
   * it to open a timesheet. They were being shown Publish, Cancel and New shift, and every one
   * of them answered 403. The dashboard beside this page already hides what a role cannot use;
   * this is the same rule, applied where the buttons are.
   */
  const canPublish = session.permissions.includes('service_request.publish');
  const canStaff = session.permissions.includes('assignment.confirm');
  const [status, setStatus] = useState<string>('PUBLISHED');
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cancelling, setCancelling] = useState<ServiceRequest | null>(null);
  const [publishing, setPublishing] = useState<ServiceRequest | null>(null);
  const [reason, setReason] = useState('');

  const pager = useCursorPager();

  const queueKey = ['shifts', facilityId, status, categoryId, applied, from, to];
  const queue = useQuery({
    queryKey: [...queueKey, pager.cursor],
    queryFn: () => {
      const parts = [
        'scopeType=FACILITY',
        `scopeId=${facilityId}`,
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        categoryId !== 'all' ? `professionalCategoryId=${categoryId}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        from ? `from=${from}` : '',
        to ? `to=${to}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ requests?: ServiceRequest[]; nextCursor?: string | null }>(
        `/api/v1/service-requests?${parts.join('&')}`,
      );
    },
    enabled: Boolean(facilityId),
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.requests ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const activeCount =
    (categoryId !== 'all' ? 1 : 0) + (applied ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);

  function clearFilters() {
    setCategoryId('all');
    setSearch('');
    setApplied('');
    setFrom('');
    setTo('');
    pager.startOver();
  }

  const cancel = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) =>
      api.post(`/api/v1/service-requests/${id}/cancel`, { facilityId, reason: reason.trim() }),
    success: 'Shift cancelled',
  });

  // The same call "Publish a shift" makes as its second step — exposed here as its own action so
  // a draft stuck behind a since-fixed blocker (facility verification, most often) can be retried
  // without recreating it.
  const publish = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.post(`/api/v1/service-requests/${id}/publish`, { facilityId }),
    success: 'Shift published',
  });

  const roleOf = (row: ServiceRequest) =>
    nameOf(reference.data?.professionalCategories, row.professionalCategoryId);
  const hoursOf = (row: ServiceRequest) =>
    Math.round((new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()) / 60_000);
  const describe = (row: ServiceRequest) =>
    `${roleOf(row)}, ${formatShiftWindow(row.startsAt, row.endsAt)}`;

  const columns: Column<ServiceRequest>[] = [
    {
      id: 'role',
      header: 'Profession',
      role: 'identity',
      cell: (row) => (
        <Link href={`/facility/shifts/${row.id}`} className="hover:underline">
          <span className="block font-medium">{roleOf(row)}</span>
          {row.specialtyId ? (
            <span className="block text-sm font-normal text-muted-foreground">
              {nameOf(reference.data?.specialties, row.specialtyId)}
            </span>
          ) : null}
          {row.cadreLevelId ? (
            <span className="block text-sm font-normal text-muted-foreground">
              {nameOf(reference.data?.cadreLevels, row.cadreLevelId)}
              {row.supervisionAvailable ? ' · supervised' : ''}
            </span>
          ) : null}
        </Link>
      ),
    },
    {
      id: 'when',
      header: 'When',
      cell: (row) => (
        <>
          <span className="block">{formatShiftWindow(row.startsAt, row.endsAt)}</span>
          <span className="block text-sm text-muted-foreground">{formatMinutes(hoursOf(row))}</span>
        </>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant="secondary">{humanise(row.shiftType)}</Badge>
          {row.urgency !== 'ROUTINE' ? (
            <Badge variant={row.urgency === 'EMERGENCY' ? 'destructive' : 'warning'}>
              {humanise(row.urgency)}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'rate',
      header: 'Rate per hour',
      align: 'right',
      numeric: true,
      cell: (row) => formatNaira(row.hourlyRateKobo),
    },
    {
      id: 'filled',
      header: 'Places filled',
      align: 'right',
      numeric: true,
      cell: (row) => `${row.confirmedCount ?? 0} of ${row.headcount}`,
    },
    {
      id: 'status',
      header: 'Status',
      role: 'status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  const nothing = NOTHING_HERE[status] ?? { title: 'No shifts' };

  return (
    <>
      <PageHeader
        title="Shifts"
        description="A published shift can be offered to practitioners. Its terms cannot be changed after publishing — cancel it and publish another instead, so nobody accepts one thing and works another."
        action={facilityId && canPublish ? <NewShiftDialog facilityId={facilityId} /> : null}
      />

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Shift status">
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {humanise(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        searchLabel="Search notes"
        searchPlaceholder="Ward, contact, notes"
        searchValue={search}
        onSearchChange={setSearch}
        onSubmit={() => {
          setApplied(search.trim());
          pager.startOver();
        }}
        activeCount={activeCount}
        onClear={clearFilters}
        busy={queue.isFetching && !queue.isPending}
        summary={!queue.isPending && rows.length > 0 ? `${rows.length} on this page` : undefined}
      >
        <Field label="Profession" className="md:min-w-[14rem]">
          {(a11y) => (
            <Select
              value={categoryId}
              onValueChange={(value) => {
                setCategoryId(value);
                pager.startOver();
              }}
            >
              <SelectTrigger {...a11y}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every profession</SelectItem>
                {(reference.data?.professionalCategories ?? []).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Starts after">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              pager.startOver();
            }}
          />
        </Field>
        <Field label="Starts before">
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

      {queue.isPending ? (
        <TableSkeleton label="Loading shifts" columns={5} />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="shifts" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<CalendarPlus />}
            title={nothing.title}
            description={nothing.description}
          />
        )
      ) : (
        <DataTable
          caption={`${humanise(status)} shifts`}
          rows={rows}
          columns={columns}
          getKey={(row) => row.id}
          actionHeader="Next step"
          action={(row) => {
            const canCancel =
              canPublish &&
              (row.status === 'PUBLISHED' || row.status === 'DRAFT' || row.status === 'FILLED');
            return (
              <div className="flex flex-col gap-2 md:flex-row md:justify-end">
                {row.status === 'DRAFT' && canPublish ? (
                  <Button
                    size="sm"
                    aria-label={`Publish shift: ${describe(row)}`}
                    onClick={() => setPublishing(row)}
                  >
                    <Send />
                    Publish
                  </Button>
                ) : (row.status === 'PUBLISHED' || row.status === 'FILLED') && canStaff ? (
                  <Link
                    href={`/facility/shifts/${row.id}`}
                    aria-label={`Find staff for shift: ${describe(row)}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <Users />
                    Find staff
                  </Link>
                ) : (
                  <Link
                    href={`/facility/shifts/${row.id}`}
                    aria-label={`View shift: ${describe(row)}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    View
                  </Link>
                )}
                {canCancel ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Cancel shift: ${describe(row)}`}
                    className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                    onClick={() => {
                      setCancelling(row);
                      setReason('');
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            );
          }}
        />
      )}

      <Pager
        pageIndex={pager.pageIndex}
        hasNext={Boolean(nextCursor)}
        busy={queue.isFetching}
        onPrevious={pager.goPrevious}
        onNext={() => pager.goNext(nextCursor)}
      />

      <ConfirmDialog
        open={publishing !== null}
        onOpenChange={(next) => !next && setPublishing(null)}
        title="Publish this shift"
        object={publishing ? describe(publishing) : ''}
        consequence={
          publishing ? (
            <>
              It becomes visible to practitioners and can be offered to them at{' '}
              <span className="tabular font-medium">{formatNaira(publishing.hourlyRateKobo)}</span>{' '}
              an hour for{' '}
              {publishing.headcount === 1 ? 'one place' : `${publishing.headcount} places`}. Its
              terms cannot be changed once it is published.
            </>
          ) : null
        }
        reversible="You can cancel it afterwards, but not edit it."
        confirmLabel="Publish shift"
        loading={publish.isPending}
        onConfirm={() =>
          publishing &&
          publish.mutate({ id: publishing.id }, { onSuccess: () => setPublishing(null) })
        }
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(next) => !next && setCancelling(null)}
        title="Cancel this shift"
        object={
          cancelling
            ? `${describe(cancelling)} · ${cancelling.confirmedCount ?? 0} of ${cancelling.headcount} confirmed`
            : ''
        }
        consequence={
          <>
            {cancelling && (cancelling.confirmedCount ?? 0) > 0 ? (
              <>
                {cancelling.confirmedCount === 1
                  ? 'The confirmed practitioner is'
                  : `All ${cancelling.confirmedCount} confirmed practitioners are`}{' '}
                released from the shift and sent a message saying so.{' '}
              </>
            ) : null}
            Any invitation still waiting for an answer is withdrawn. Your reason is kept on the
            record; it is not sent to them.
          </>
        }
        reversible={false}
        destructive
        confirmLabel="Cancel the shift"
        cancelLabel="Keep the shift"
        loading={cancel.isPending}
        confirmDisabled={reason.trim().length < 3}
        onConfirm={() =>
          cancelling &&
          cancel.mutate({ id: cancelling.id }, { onSuccess: () => setCancelling(null) })
        }
      >
        <Field
          label="Reason"
          hint="Why the shift is no longer needed. At least 3 characters."
          required
        >
          <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
