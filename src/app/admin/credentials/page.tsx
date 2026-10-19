'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCheck2 } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { QUEUES } from '@/lib/ui/ops-today';
import { useReference } from '@/lib/ui/reference';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { QueueAge, ageTone } from '@/components/app/queue-age';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { expiryOf, formatDate } from '@/components/app/format';
import { CREDENTIAL_STATUSES, canDecide, type CredentialStatus } from './credential-status';
import { PractitionerFace, ReviewPanel, type QueueSubmission } from './review-panel';

const PAGE_SIZE = 20;

/** How long a submission may wait before it is "getting old", then "overdue" — as on the dashboard. */
const THRESHOLDS = QUEUES.find((queue) => queue.key === 'credentials')!.thresholds;

/**
 * Credential review — step 5.2, and the pattern every operations queue follows.
 *
 * One row per submission, oldest waiting first (the order the API returns them in, and the one a
 * queue is cleared in). Each row says who, what, how long it has waited and where it stands, and
 * has exactly one next step: **Review**, which opens the submission beside the queue with the
 * document a click away and the decision below it. On a phone the rows are cards carrying the same
 * five facts, and the filters sit behind one button that says how many are applied.
 *
 * Three outcomes, not two. Rejecting a nurse because a photograph was blurred is how a platform
 * loses a nurse, and "ask for more" is the middle answer that keeps the submission open instead of
 * making them start again. Each outcome asks before it acts, and says what it will do.
 *
 * A failed load is an error with a retry, never an empty list: "nothing waiting" and "could not
 * load" must not look alike to somebody whose job is to clear the queue.
 */
export default function CredentialsPage() {
  const reference = useReference();

  const [status, setStatus] = useState<CredentialStatus>('PENDING');
  const [credentialTypeId, setCredentialTypeId] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [reviewing, setReviewing] = useState<QueueSubmission | null>(null);

  const pager = useCursorPager();

  const queueKey = ['credentials', status, credentialTypeId, applied];
  const queue = useQuery({
    queryKey: [...queueKey, pager.cursor],
    queryFn: () => {
      const parts = [
        'scopeType=PLATFORM',
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        credentialTypeId !== 'all' ? `credentialTypeId=${credentialTypeId}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ submissions?: QueueSubmission[]; nextCursor?: string | null }>(
        `/api/v1/credentials?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.submissions ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const activeCount = (credentialTypeId !== 'all' ? 1 : 0) + (applied ? 1 : 0);
  const statusLabel = CREDENTIAL_STATUSES.find(([value]) => value === status)?.[1] ?? status;

  function clearFilters() {
    setSearch('');
    setApplied('');
    setCredentialTypeId('all');
    pager.startOver();
  }

  const waiting = status === 'PENDING';
  const columns: Column<QueueSubmission>[] = [
    {
      id: 'practitioner',
      header: 'Practitioner',
      role: 'identity',
      cell: (row) => (
        <span className="flex items-center gap-3">
          {/* The face belongs next to the name on the queue that decides whether this person can work. */}
          <PractitionerFace row={row} />
          <span className="min-w-0">
            <span className="block">{row.practitionerName}</span>
            <span className="block font-mono text-sm font-normal text-muted-foreground">
              {row.practitionerPhone}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: 'credential',
      header: 'Credential',
      cell: (row) => (
        <>
          <span className="block">{row.credentialTypeName}</span>
          <span className="block text-sm text-muted-foreground">
            {row.documentObjectKey ? 'Document attached' : 'No document'}
            {row.referenceNumber ? ` · ref ${row.referenceNumber}` : ''}
          </span>
        </>
      ),
    },
    {
      id: 'age',
      header: waiting ? 'Waiting' : 'Submitted',
      cell: (row) =>
        waiting ? (
          <QueueAge since={row.createdAt} label="" thresholds={THRESHOLDS} />
        ) : (
          formatDate(row.createdAt)
        ),
    },
    ...(status === 'VERIFIED' || status === 'EXPIRED'
      ? [
          {
            id: 'expires',
            header: 'Expires',
            cell: (row: QueueSubmission) => expiryOf(row)?.text ?? '—',
          } satisfies Column<QueueSubmission>,
        ]
      : []),
    {
      id: 'status',
      header: 'Status',
      role: 'status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Credentials"
        description="A practitioner stays ineligible until every mandatory credential for their category is verified — so this queue is the one that decides who can be matched."
      />

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value as CredentialStatus);
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Submission status">
          {CREDENTIAL_STATUSES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        searchLabel="Search by practitioner"
        searchPlaceholder="Adaeze, or 0803 123 4567"
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
        <Field label="Credential" className="md:min-w-[14rem]">
          {(a11y) => (
            <Select
              value={credentialTypeId}
              onValueChange={(value) => {
                setCredentialTypeId(value);
                pager.startOver();
              }}
            >
              <SelectTrigger {...a11y}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any credential</SelectItem>
                {(reference.data?.credentialTypes ?? []).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </FilterBar>

      {queue.isPending ? (
        <TableSkeleton label="Loading submissions" columns={5} />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="submissions" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<FileCheck2 />}
            title={waiting ? 'Nothing is waiting' : `No ${statusLabel.toLowerCase()} submissions`}
            description={
              waiting
                ? 'Every submission has been reviewed. New ones appear here the moment a practitioner uploads.'
                : undefined
            }
          />
        )
      ) : (
        <>
          {queue.isError ? (
            <p
              role="alert"
              className="mb-3 flex flex-wrap items-center gap-3 text-sm font-medium text-destructive-text"
            >
              Could not refresh this list, so it may be out of date.
              <Button
                variant="outline"
                size="sm"
                loading={queue.isFetching}
                onClick={() => void queue.refetch()}
              >
                Try again
              </Button>
            </p>
          ) : null}
          <DataTable
            caption={`${statusLabel} credential submissions`}
            rows={rows}
            columns={columns}
            getKey={(row) => row.id}
            actionHeader="Next step"
            rowTone={(row) => {
              if (!canDecide(row.status)) return undefined;
              const tone = ageTone(row.createdAt, new Date(), THRESHOLDS);
              return tone === 'overdue' ? 'danger' : tone === 'ageing' ? 'warning' : undefined;
            }}
            action={(row) => (
              <Button
                size="sm"
                variant={canDecide(row.status) ? 'default' : 'outline'}
                aria-label={`${canDecide(row.status) ? 'Review' : 'Open'} ${row.credentialTypeName} for ${row.practitionerName}`}
                onClick={() => setReviewing(row)}
              >
                {canDecide(row.status) ? 'Review' : 'Open'}
              </Button>
            )}
          />
        </>
      )}

      <Pager
        pageIndex={pager.pageIndex}
        hasNext={Boolean(nextCursor)}
        busy={queue.isFetching}
        onPrevious={pager.goPrevious}
        onNext={() => pager.goNext(nextCursor)}
      />

      <ReviewPanel row={reviewing} thresholds={THRESHOLDS} onClose={() => setReviewing(null)} />
    </>
  );
}
