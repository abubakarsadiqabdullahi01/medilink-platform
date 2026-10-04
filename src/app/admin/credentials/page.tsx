'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileCheck2, Search, TriangleAlert, UserRound } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueueAction } from '@/lib/ui/queue';
import { useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { DocumentDialog } from '@/components/app/document-dialog';
import {
  Detail,
  DetailGrid,
  EmptyState,
  PageHeader,
  QueueSkeleton,
} from '@/components/app/page-shell';
import { formatAgo, formatDate } from '@/components/app/format';

interface Submission {
  id: string;
  userId: string;
  credentialTypeId: string;
  status: string;
  reference: string | null;
  expiresAt: string | null;
  createdAt: string;
  reviewNotes: string | null;
  practitionerName: string;
  practitionerPhone: string;
  practitionerPhotoUrl: string | null;
  credentialTypeName: string;
  documentObjectKey: string | null;
}

// [value, label] rather than a derived label: MORE_INFO_REQUESTED reads badly
// lower-cased, and the mismatched INFO_REQUESTED this replaced was sending a
// status the schema does not accept — every tab past Pending was a 422.
const STATUSES = [
  ['PENDING', 'Pending'],
  ['MORE_INFO_REQUESTED', 'Info requested'],
  ['VERIFIED', 'Verified'],
  ['REJECTED', 'Rejected'],
  ['EXPIRED', 'Expired'],
] as const;

const PAGE_SIZE = 20;

/**
 * Credential review — step 5.2.
 *
 * Three outcomes, not two. Rejecting a nurse because a photograph was blurred
 * is how a platform loses a nurse, and "ask for more" is the middle answer
 * that keeps the submission open instead of making them start again.
 *
 * Status tabs over an unpaginated, unsearchable list, the same gap the
 * facilities and unhonoured queues had — no way to find one practitioner
 * among many, and nothing past the first fifty. The API already carried
 * `credentialTypeId`, `limit` and `cursor`; `search` was the one addition
 * needed on top of what facilities' fix already established as the pattern.
 */
export default function CredentialsPage() {
  const reference = useReference();

  const [status, setStatus] = useState<string>('PENDING');
  const [credentialTypeId, setCredentialTypeId] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queueKey = ['credentials', status, credentialTypeId, applied];
  const queue = useQuery({
    queryKey: [...queueKey, cursor],
    queryFn: () => {
      const parts = [
        'scopeType=PLATFORM',
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        credentialTypeId !== 'all' ? `credentialTypeId=${credentialTypeId}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ submissions?: Submission[]; nextCursor?: string | null }>(
        `/api/v1/credentials?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.submissions ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const filtered = credentialTypeId !== 'all' || Boolean(applied);

  const [notes, setNotes] = useState<Record<string, string>>({});

  const review = useQueueAction<{
    id: string;
    decision: 'approve' | 'reject' | 'request_info';
  }>({
    queueKey,
    run: ({ id, decision }) =>
      api.post(`/api/v1/credentials/${id}/review`, {
        decision,
        reviewNotes: notes[id]?.trim() || undefined,
      }),
    success: ({ decision }) =>
      decision === 'approve'
        ? 'Credential verified'
        : decision === 'reject'
          ? 'Credential rejected'
          : 'More information requested',
  });

  return (
    <>
      <PageHeader
        title="Credentials"
        description="A practitioner stays ineligible until every mandatory credential for their category is verified — so this queue is the one that decides who can be matched."
      />

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          startOver();
        }}
        className="mb-5"
      >
        <TabsList>
          {STATUSES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
              startOver();
            }}
          >
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label htmlFor="credential-search">Search by practitioner</Label>
              <Input
                id="credential-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Adaeze, or 0803 123 4567"
              />
            </div>

            <div className="min-w-[200px] space-y-1.5">
              <Label>Credential</Label>
              <Select
                value={credentialTypeId}
                onValueChange={(value) => {
                  setCredentialTypeId(value);
                  startOver();
                }}
              >
                <SelectTrigger>
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
            </div>

            <Button type="submit" loading={queue.isFetching}>
              <Search />
              Search
            </Button>

            {filtered ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setApplied('');
                  setCredentialTypeId('all');
                  startOver();
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>

          {!queue.isPending && rows.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">{rows.length} on this page</p>
          ) : null}
        </CardContent>
      </Card>

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This queue could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 />}
          title={
            filtered
              ? 'Nothing matches that'
              : status === 'PENDING'
                ? 'Nothing waiting'
                : `No ${humanise(status).toLowerCase()} submissions`
          }
          description={
            filtered
              ? 'Try part of a name, a phone number, or a different credential.'
              : status === 'PENDING'
                ? 'Every submission has been reviewed. New ones appear here the moment a practitioner uploads.'
                : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const note = notes[row.id]?.trim() ?? '';
            const open = row.status === 'PENDING' || row.status === 'MORE_INFO_REQUESTED';

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* The face belongs next to the name on the queue that
                        decides whether this person can work. */}
                    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
                      {row.practitionerPhotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.practitionerPhotoUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.practitionerName}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {row.practitionerPhone}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={row.status} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <p className="text-sm font-medium">{row.credentialTypeName}</p>

                  <DetailGrid>
                    <Detail label="Reference">{row.reference ?? 'None given'}</Detail>
                    <Detail label="Document">
                      {row.documentObjectKey ? 'Attached' : 'None attached'}
                    </Detail>
                    <Detail label="Expires">{formatDate(row.expiresAt)}</Detail>
                    <Detail label="Submitted">
                      {formatDate(row.createdAt)} · {formatAgo(row.createdAt)}
                    </Detail>
                  </DetailGrid>

                  {row.documentObjectKey ? (
                    <DocumentDialog
                      title={row.credentialTypeName}
                      description={` · submitted ${formatAgo(row.createdAt)}`}
                      fetchUrl={() =>
                        api.post<{ url: string }>(`/api/v1/credentials/${row.id}/document-url`, {
                          scopeType: 'PLATFORM',
                        })
                      }
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Nothing was uploaded with this one — the reference number is all there is to
                      check.
                    </p>
                  )}

                  {row.reviewNotes ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Last note
                      </p>
                      <p className="mt-1">{row.reviewNotes}</p>
                    </div>
                  ) : null}

                  {open ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`notes-${row.id}`}>
                          Reason{' '}
                          <span className="font-normal text-muted-foreground">
                            — required to reject or to ask for more
                          </span>
                        </Label>
                        <Textarea
                          id={`notes-${row.id}`}
                          rows={2}
                          placeholder="What is wrong, or what is missing."
                          value={notes[row.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="success"
                          loading={review.isPending && review.variables?.id === row.id}
                          onClick={() => review.mutate({ id: row.id, decision: 'approve' })}
                        >
                          Verify
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!note || review.isPending}
                          onClick={() => review.mutate({ id: row.id, decision: 'request_info' })}
                        >
                          Ask for more
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!note || review.isPending}
                          onClick={() => review.mutate({ id: row.id, decision: 'reject' })}
                        >
                          Reject
                        </Button>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
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
            Previous
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
            Next
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </>
  );
}
