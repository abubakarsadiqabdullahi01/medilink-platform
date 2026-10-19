'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { formatDate } from '@/components/app/format';

type SourceList = 'MDCN_QUACK_LIST' | 'MDCN_SANCTIONS' | 'INTERNAL';

interface Entry {
  id: string;
  sourceList: SourceList;
  fullName: string;
  folioNumber: string | null;
  reason: string | null;
  listedAt: string;
}

const LISTS: { value: SourceList; label: string }[] = [
  { value: 'MDCN_QUACK_LIST', label: 'MDCN list of people practising without registration' },
  { value: 'MDCN_SANCTIONS', label: 'MDCN sanctions' },
  { value: 'INTERNAL', label: 'Barred by Medilink' },
];
const listLabel = (value: SourceList) => LISTS.find((row) => row.value === value)?.label ?? value;

/**
 * One line per person, fields separated by `|`: name | folio number (may be
 * empty) | reason | date listed (YYYY-MM-DD). The shape of a notice copied from a
 * table, which is how this list actually arrives.
 */
function parsePasted(text: string, sourceList: SourceList) {
  const entries: {
    fullName: string;
    sourceList: SourceList;
    folioNumber?: string;
    reason: string;
    listedAt: string;
  }[] = [];
  const problems: string[] = [];

  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const [fullName, folio, reason, listedAt] = line.split('|').map((part) => part.trim());
      if (!fullName || !reason || !listedAt) {
        problems.push(`Line ${index + 1}: needs a name, a reason and a date, separated by |.`);
        return;
      }
      entries.push({
        fullName,
        sourceList,
        ...(folio ? { folioNumber: folio } : {}),
        reason,
        listedAt,
      });
    });

  return { entries, problems };
}

/**
 * The sanctioned and "quack" lists practitioners are screened against.
 *
 * Medilink does not receive these lists from anybody: they are typed or pasted in
 * from the regulator's published notices. Until somebody does, screening reports
 * every practitioner clear, and the page says so at the top rather than leaving
 * an empty table to look like good news.
 */
export default function SanctionsPage() {
  const queryClient = useQueryClient();
  const [applied, setApplied] = useState('');
  const [search, setSearch] = useState('');

  const list = useQuery({
    queryKey: ['sanctions', applied],
    queryFn: () =>
      api.get<{ entries: Entry[] }>(
        `/api/v1/sanctions${applied ? `?search=${encodeURIComponent(applied)}` : ''}`,
      ),
    placeholderData: (previous) => previous,
  });

  const [sourceList, setSourceList] = useState<SourceList>('MDCN_QUACK_LIST');
  const [fullName, setFullName] = useState('');
  const [folio, setFolio] = useState('');
  const [reason, setReason] = useState('');
  const [listedAt, setListedAt] = useState('');
  const [pasted, setPasted] = useState('');
  const parsed = parsePasted(pasted, sourceList);

  // What is about to be added, held while the officer reads it back and confirms.
  const [adding, setAdding] = useState<ReturnType<typeof parsePasted>['entries'] | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const add = useMutation({
    mutationFn: (entries: ReturnType<typeof parsePasted>['entries']) =>
      api.post<{ added: number; skipped: number; flagged: number }>('/api/v1/sanctions', {
        entries,
      }),
    onSuccess: (result) => {
      toast.success(
        `${result.added} added${result.skipped ? `, ${result.skipped} already there` : ''}`,
        {
          description: `Everybody has been screened against the list. ${result.flagged} ${
            result.flagged === 1 ? 'practitioner is' : 'practitioners are'
          } flagged.`,
        },
      );
      setAdding(null);
      setFullName('');
      setFolio('');
      setReason('');
      setListedAt('');
      setPasted('');
      void queryClient.invalidateQueries({ queryKey: ['sanctions'] });
    },
  });

  const remove = useMutation({
    mutationFn: (entry: Entry) =>
      api.post(`/api/v1/sanctions/${entry.id}/remove`, { reason: removeReason.trim() }),
    onSuccess: () => {
      toast.success('Removed', { description: 'Everybody has been screened again.' });
      setRemoving(null);
      setRemoveReason('');
      void queryClient.invalidateQueries({ queryKey: ['sanctions'] });
    },
  });

  const single = {
    fullName,
    sourceList,
    ...(folio.trim() ? { folioNumber: folio.trim() } : {}),
    reason,
    listedAt,
  };
  const singleReady =
    fullName.trim().length >= 3 &&
    reason.trim().length >= 3 &&
    /^\d{4}-\d{2}-\d{2}$/.test(listedAt);

  const entries = list.data?.entries ?? [];
  const activeCount = applied ? 1 : 0;

  const columns: Column<Entry>[] = [
    {
      id: 'name',
      header: 'Name',
      role: 'identity',
      cell: (entry) => (
        <span className="block">
          <span className="block font-medium">{entry.fullName}</span>
          {entry.folioNumber ? (
            <span className="block font-mono text-sm font-normal text-muted-foreground">
              {entry.folioNumber}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      // Words, wrapping: the longest list name is nine words, and as a badge in the status slot of
      // a phone card it took the whole width and left the person's name one letter wide.
      id: 'list',
      header: 'List',
      cell: (entry) => listLabel(entry.sourceList),
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (entry) => <span className="text-muted-foreground">{entry.reason ?? '—'}</span>,
    },
    { id: 'listed', header: 'Listed', cell: (entry) => formatDate(entry.listedAt) },
  ];

  return (
    <>
      <ConfirmDialog
        open={adding !== null}
        onOpenChange={(next) => {
          if (!next) {
            setAdding(null);
            add.reset();
          }
        }}
        title={adding && adding.length > 1 ? `Add ${adding.length} entries` : 'Add to the list'}
        object={
          adding ? (
            <>
              {adding.length === 1 ? adding[0]!.fullName : `${adding.length} people`}
              <span className="block font-normal text-muted-foreground">
                {listLabel(sourceList)}
              </span>
            </>
          ) : (
            ''
          )
        }
        consequence={
          <>
            {adding && adding.length > 1 ? 'They are' : 'It is'} added at once, and everybody is
            screened against the list straight away rather than at the next daily check. A
            practitioner who matches is flagged and blocked until a compliance officer answers it.
            {adding && adding.length > 1 ? ' All of them go in, or none do.' : ''}
          </>
        }
        reversible={{
          tone: 'open',
          label: 'Each entry can be removed again.',
          detail: 'Removing needs a reason, and everybody is screened again.',
        }}
        confirmLabel={
          adding && adding.length > 1 ? `Add ${adding.length} entries` : 'Add to the list'
        }
        cancelLabel="Not yet"
        loading={add.isPending}
        error={add.error ? errorMessage(add.error) : null}
        onConfirm={() => adding && add.mutate(adding)}
      >
        {adding && adding.length > 1 ? (
          <div>
            <p className="text-sm font-medium text-muted-foreground">The first few, as read</p>
            <ul className="mt-1 space-y-1 text-base">
              {adding.slice(0, 5).map((entry, index) => (
                <li key={`${entry.fullName}-${index}`} className="[overflow-wrap:anywhere]">
                  {entry.fullName}
                  <span className="text-muted-foreground"> · {entry.listedAt}</span>
                </li>
              ))}
            </ul>
            {adding.length > 5 ? (
              <p className="mt-1 text-sm text-muted-foreground">and {adding.length - 5} more.</p>
            ) : null}
          </div>
        ) : adding?.[0] ? (
          <dl className="grid grid-cols-1 gap-2 text-base sm:grid-cols-2">
            {adding[0].folioNumber ? (
              <div>
                <dt className="text-sm text-muted-foreground">Folio number</dt>
                <dd className="font-mono">{adding[0].folioNumber}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-sm text-muted-foreground">Listed</dt>
              <dd>{adding[0].listedAt}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Reason or notice</dt>
              <dd className="[overflow-wrap:anywhere]">{adding[0].reason}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveReason('');
            remove.reset();
          }
        }}
        title="Remove from the list"
        object={
          removing ? (
            <>
              {removing.fullName}
              <span className="block font-normal text-muted-foreground">
                {listLabel(removing.sourceList)}
              </span>
            </>
          ) : (
            ''
          )
        }
        consequence={
          <>
            Anybody this entry flagged is clear again unless another entry still matches them.
            Everybody is screened again at once. The reason is kept with your name.
          </>
        }
        reversible={{
          tone: 'open',
          label: 'It can be added again.',
          detail: 'Everybody is screened against it again when it is.',
        }}
        destructive
        confirmLabel="Remove"
        cancelLabel="Keep it on the list"
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        confirmDisabled={removeReason.trim().length < 5}
        onConfirm={() => removing && remove.mutate(removing)}
      >
        <Field label="Why is it being removed?" hint="At least 5 characters." required>
          <Textarea
            value={removeReason}
            maxLength={500}
            rows={3}
            onChange={(event) => setRemoveReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>

      <PageHeader
        title="Sanctions list"
        description="The people practitioners are screened against: the regulator's list of those practising without registration, its sanctions, and anybody Medilink has barred. A match blocks a practitioner until a compliance officer answers it."
      />

      <div className="space-y-6">
        {list.isSuccess && list.data.entries.length === 0 && !applied ? (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription>
              <strong>The list is empty, so screening reports every practitioner clear.</strong>{' '}
              Medilink does not receive these lists from anybody. Add them from the
              regulator&rsquo;s published notices below.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add to the list</CardTitle>
            <CardDescription>
              Everybody is screened against the list as soon as it changes, not at the next daily
              check. You will read what is being added before it is.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Which list" className="max-w-md">
              {(a11y) => (
                <Select
                  value={sourceList}
                  onValueChange={(value) => setSourceList(value as SourceList)}
                >
                  <SelectTrigger {...a11y}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTS.map((row) => (
                      <SelectItem key={row.value} value={row.value}>
                        {row.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (singleReady) setAdding([single]);
              }}
            >
              <Field label="Full name" required>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field label="Folio number" optional>
                <Input value={folio} onChange={(e) => setFolio(e.target.value)} />
              </Field>
              <Field label="Reason or notice reference" required>
                <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Field label="Date listed" required>
                <Input type="date" value={listedAt} onChange={(e) => setListedAt(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!singleReady}>
                  Review before adding
                </Button>
              </div>
            </form>

            <div className="space-y-3 border-t pt-5">
              <Field
                label="Or paste a notice"
                hint="One person per line: name | folio number (may be empty) | reason | date listed (YYYY-MM-DD). Added to the list chosen above, up to 500 at a time, all or none."
                error={
                  parsed.problems.length > 0
                    ? parsed.problems.slice(0, 5).join(' ') +
                      (parsed.problems.length > 5 ? ` And ${parsed.problems.length - 5} more.` : '')
                    : undefined
                }
              >
                <Textarea
                  rows={5}
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="Amina Yusuf | MDCN/12345 | MDCN notice, March 2026 | 2026-03-01"
                />
              </Field>
              <Button
                variant="outline"
                disabled={parsed.entries.length === 0 || parsed.problems.length > 0}
                onClick={() => setAdding(parsed.entries)}
              >
                Review {parsed.entries.length || ''}{' '}
                {parsed.entries.length === 1 ? 'entry' : 'entries'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <section aria-labelledby="on-the-list">
          <h2 id="on-the-list" className="mb-3 text-lg font-semibold">
            On the list
          </h2>

          <FilterBar
            searchLabel="Search the list"
            searchPlaceholder="Name or folio number"
            searchValue={search}
            onSearchChange={setSearch}
            onSubmit={() => setApplied(search.trim())}
            activeCount={activeCount}
            onClear={() => {
              setSearch('');
              setApplied('');
            }}
            busy={list.isFetching && !list.isPending}
            summary={!list.isPending && entries.length > 0 ? `${entries.length} shown` : undefined}
          />

          {list.isPending ? (
            <TableSkeleton label="Loading the list" columns={4} />
          ) : list.isError && !list.data ? (
            <ErrorState
              error={list.error}
              onRetry={() => void list.refetch()}
              retrying={list.isFetching}
            />
          ) : entries.length === 0 ? (
            applied ? (
              <FilteredEmpty
                noun="entries"
                activeCount={activeCount}
                onClear={() => {
                  setSearch('');
                  setApplied('');
                }}
              />
            ) : (
              <EmptyState title="Nobody is on the list" compact />
            )
          ) : (
            <DataTable
              caption="People on the sanctions list"
              rows={entries}
              columns={columns}
              getKey={(entry) => entry.id}
              actionHeader="Entry"
              action={(entry) => (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${entry.fullName}`}
                  onClick={() => {
                    setRemoveReason('');
                    setRemoving(entry);
                  }}
                >
                  Remove
                </Button>
              )}
            />
          )}
        </section>
      </div>
    </>
  );
}
