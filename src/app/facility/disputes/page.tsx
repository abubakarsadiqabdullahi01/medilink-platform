'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileUp, Gavel } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState, FilteredEmpty, ListSkeleton, TableSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatAgo, formatWhen } from '@/components/app/format';

interface Case {
  id: string;
  category: string;
  reason: string;
  status: string;
  outcome: string | null;
  resolutionNotes: string | null;
  raisedParty: string;
  createdAt: string;
  practitionerName: string;
  shiftStartsAt: string;
  raisedByFacility: boolean;
}

interface Evidence {
  id: string;
  note: string | null;
  createdAt: string;
  attachedBySide: 'PRACTITIONER' | 'FACILITY';
  bySide: boolean;
}

const LIVE = ['OPEN', 'UNDER_REVIEW'];
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_BYTES = 10 * 1024 * 1024;

const STATUS_FILTERS = [
  ['all', 'Every case'],
  ['live', 'Still open'],
  ['RESOLVED', 'Decided'],
  ['WITHDRAWN', 'Withdrawn'],
] as const;

/**
 * Disputes over this facility's shifts.
 *
 * A case is an argument between the facility and a practitioner about a shift,
 * decided by somebody at Medilink. The facility was one of its two sides in the
 * rules and in nothing else: no screen, and every route a party needs asked for
 * the practitioner's own standing. Here the facility reads the case, sees what the
 * practitioner attached, adds its own and, if it raised the case, takes it back.
 * What it cannot do is edit or remove evidence, or decide anything.
 *
 * The list is every case the facility is a side of, the open ones first. The API has no
 * filters, so "Still open" and the rest narrow what is already here, which is why there is no
 * search: a facility does not have so many disputes that it needs one.
 */
export default function FacilityDisputesPage() {
  const facilityId = useFacilityId();
  const [open, setOpen] = useState<Case | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const cases = useQuery({
    queryKey: ['facility-disputes', facilityId],
    queryFn: () => api.get<{ disputes: Case[] }>(`/api/v1/disputes?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });
  const all = cases.data?.disputes ?? [];
  const live = all.filter((row) => LIVE.includes(row.status));
  const rows = all
    .filter((row) =>
      filter === 'all'
        ? true
        : filter === 'live'
          ? LIVE.includes(row.status)
          : row.status === filter,
    )
    // Open cases are the ones waiting on somebody, so they come first; the order within each
    // group is the one the server gave.
    .sort((a, b) => Number(LIVE.includes(b.status)) - Number(LIVE.includes(a.status)));

  const activeCount = filter === 'all' ? 0 : 1;

  const columns: Column<Case>[] = [
    {
      id: 'case',
      header: 'Case',
      role: 'identity',
      cell: (row) => (
        <>
          {humanise(row.category)} · {row.practitionerName}
        </>
      ),
    },
    {
      id: 'shift',
      header: 'Shift',
      cell: (row) => formatWhen(row.shiftStartsAt),
    },
    {
      id: 'raised',
      header: 'Raised',
      cell: (row) => (
        <>
          {formatAgo(row.createdAt)} by {row.raisedByFacility ? 'you' : 'the practitioner'}
        </>
      ),
    },
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
        title="Disputes"
        description="Cases over your shifts, from either side. A person at Medilink decides each one; until then you can read it, add what you have, and take back one you raised."
      />

      {!facilityId || cases.isPending ? (
        <TableSkeleton label="Loading disputes" columns={4} rows={3} />
      ) : cases.isError && !cases.data ? (
        <ErrorState
          error={cases.error}
          onRetry={() => void cases.refetch()}
          retrying={cases.isFetching}
        />
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Gavel />}
          title="No disputes"
          description="A case appears here when you or a practitioner raise one over a shift."
        />
      ) : (
        <>
          {live.length > 0 ? (
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                {live.length} {live.length === 1 ? 'case is' : 'cases are'} still open. The money
                for a shift in dispute is held back from the practitioner until it is decided.
              </AlertDescription>
            </Alert>
          ) : null}

          <FilterBar
            activeCount={activeCount}
            onClear={() => setFilter('all')}
            busy={cases.isFetching}
            summary={`${rows.length} of ${all.length} ${all.length === 1 ? 'case' : 'cases'}`}
          >
            <Field label="Show" className="md:min-w-[12rem]">
              {(a11y) => (
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger {...a11y}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </FilterBar>

          {rows.length === 0 ? (
            <FilteredEmpty
              noun="cases"
              activeCount={activeCount}
              onClear={() => setFilter('all')}
            />
          ) : (
            <DataTable
              caption="Disputes over your shifts"
              rows={rows}
              columns={columns}
              getKey={(row) => row.id}
              actionHeader="Next step"
              action={(row) => (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Open case: ${humanise(row.category)}, ${row.practitionerName}`}
                  onClick={() => setOpen(row)}
                >
                  Open
                </Button>
              )}
            />
          )}
        </>
      )}

      {open && facilityId ? (
        <CaseDialog facilityId={facilityId} row={open} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function CaseDialog({
  facilityId,
  row,
  onClose,
}: {
  facilityId: string;
  row: Case;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const detail = useQuery({
    queryKey: ['facility-dispute', row.id],
    queryFn: () =>
      api.get<{ dispute: Case; side: string; evidence: Evidence[] }>(
        `/api/v1/disputes/${row.id}?facilityId=${facilityId}`,
      ),
  });
  const evidence = detail.data?.evidence ?? [];
  const live = LIVE.includes(row.status);
  const caseLabel = `${humanise(row.category)} · ${row.practitionerName}`;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['facility-dispute', row.id] });
    void queryClient.invalidateQueries({ queryKey: ['facility-disputes'] });
  }

  const attach = useMutation({
    mutationFn: async (file: File) => {
      const ticket = await api.post<{ objectKey: string; uploadUrl: string }>(
        `/api/v1/disputes/${row.id}/evidence/upload-url`,
        { facilityId, filename: file.name, contentType: file.type, sizeBytes: file.size },
      );
      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!response.ok) throw new Error(`Storage refused the upload (${response.status}).`);
      await api.post(`/api/v1/disputes/${row.id}/evidence`, {
        facilityId,
        objectKey: ticket.objectKey,
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Added to the case', { description: 'It cannot be removed, by either side.' });
      setNote('');
      refresh();
    },
    onError: (error) => toast.error('Could not add it', { description: errorMessage(error) }),
  });

  const withdraw = useMutation({
    mutationFn: () => api.post(`/api/v1/disputes/${row.id}/withdraw`, { facilityId }),
    onSuccess: () => {
      toast.success('Withdrawn', { description: 'The case stays on record, marked withdrawn.' });
      refresh();
      setWithdrawing(false);
      onClose();
    },
    onError: (error) => toast.error('Could not withdraw it', { description: errorMessage(error) }),
  });

  async function openEvidence(item: Evidence) {
    try {
      const { url } = await api.post<{ url: string }>(
        `/api/v1/disputes/${row.id}/evidence/${item.id}/url`,
        { facilityId },
      );
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      toast.error('Could not open it', { description: errorMessage(error) });
    }
  }

  function choose(file: File | undefined) {
    setProblem(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type))
      return setProblem('Use a PDF, or a JPEG, PNG, WebP or HEIC image.');
    if (file.size > MAX_BYTES) return setProblem('That file is larger than 10 MB.');
    attach.mutate(file);
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <>
      <Dialog open onOpenChange={(next) => (next || withdrawing ? null : onClose())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{caseLabel}</DialogTitle>
            <DialogDescription>
              Shift {formatWhen(row.shiftStartsAt)} · raised by{' '}
              {row.raisedByFacility ? 'you' : 'the practitioner'} ·{' '}
              <StatusBadge status={row.status} />
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <section aria-labelledby="case-raised">
              <h3 id="case-raised" className="text-sm font-semibold text-muted-foreground">
                What was raised
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed">{row.reason}</p>
            </section>

            {row.status === 'RESOLVED' ? (
              <Alert variant={row.outcome === 'UPHELD' ? 'warning' : 'info'}>
                <AlertDescription>
                  <strong>Decided: {row.outcome === 'UPHELD' ? 'upheld' : 'dismissed'}.</strong>{' '}
                  {row.resolutionNotes}
                </AlertDescription>
              </Alert>
            ) : null}

            <section aria-labelledby="case-evidence">
              <h3 id="case-evidence" className="text-sm font-semibold text-muted-foreground">
                Evidence
              </h3>
              {detail.isPending ? (
                <div className="mt-2">
                  <ListSkeleton rows={1} label="Loading the evidence" />
                </div>
              ) : detail.isError && !detail.data ? (
                // Not "nothing attached": the list did not load, so nobody knows what is there.
                <div className="mt-2">
                  <ErrorState
                    error={detail.error}
                    onRetry={() => void detail.refetch()}
                    retrying={detail.isFetching}
                    compact
                  />
                </div>
              ) : evidence.length === 0 ? (
                <p className="mt-1 text-base text-muted-foreground">
                  Nothing has been attached yet.
                </p>
              ) : (
                <ul className="mt-2 divide-y rounded-md border">
                  {evidence.map((item) => {
                    const who = item.bySide
                      ? 'You'
                      : item.attachedBySide === 'PRACTITIONER'
                        ? 'The practitioner'
                        : 'Your colleague';
                    return (
                      <li
                        key={item.id}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-base">
                            {who}
                            <span className="text-muted-foreground">
                              {' '}
                              · {formatAgo(item.createdAt)}
                            </span>
                          </p>
                          {item.note ? (
                            <p className="text-base text-muted-foreground [overflow-wrap:anywhere]">
                              {item.note}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Open the file from ${who.toLowerCase()}, ${formatAgo(item.createdAt)}`}
                          onClick={() => void openEvidence(item)}
                        >
                          Open
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {live ? (
              <section aria-label="Add evidence" className="space-y-3 border-t pt-4">
                <Field
                  label="Add evidence"
                  optional
                  hint="What the file shows. PDF or image, up to 10 MB. Once added it stays: neither side can remove evidence."
                >
                  <Input
                    placeholder="What it shows"
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPTED.join(',')}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => choose(event.target.files?.[0])}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    loading={attach.isPending}
                    onClick={() => fileInput.current?.click()}
                  >
                    <FileUp />
                    Choose a file and add it
                  </Button>
                  {row.raisedByFacility ? (
                    <Button
                      variant="outline"
                      className="text-destructive-text"
                      onClick={() => {
                        withdraw.reset();
                        setWithdrawing(true);
                      }}
                    >
                      Withdraw this case
                    </Button>
                  ) : null}
                </div>
                {problem ? (
                  <p role="alert" className="text-sm font-medium text-destructive-text">
                    {problem}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        title="Withdraw this case"
        object={`${caseLabel} · shift ${formatWhen(row.shiftStartsAt)}`}
        consequence={
          <>
            You are taking back a case you raised. It is closed as withdrawn and stays on the
            record, with the evidence both sides attached. The shift goes back to where it was
            before the case, and payment held back for it is no longer held because of this case.
          </>
        }
        reversible={false}
        destructive
        confirmLabel="Withdraw the case"
        cancelLabel="Keep the case open"
        loading={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
      >
        {withdraw.isError ? (
          <Alert variant="destructive">
            <AlertDescription className="space-y-1">
              <p className="font-medium">The case was not withdrawn.</p>
              <p>{errorMessage(withdraw.error)}</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
