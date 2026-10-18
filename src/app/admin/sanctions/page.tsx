'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
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
  { value: 'MDCN_QUACK_LIST', label: "MDCN list of people practising without registration" },
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
      api.get<{ entries: Entry[] }>(`/api/v1/sanctions${applied ? `?search=${encodeURIComponent(applied)}` : ''}`),
  });

  const [sourceList, setSourceList] = useState<SourceList>('MDCN_QUACK_LIST');
  const [fullName, setFullName] = useState('');
  const [folio, setFolio] = useState('');
  const [reason, setReason] = useState('');
  const [listedAt, setListedAt] = useState('');
  const [pasted, setPasted] = useState('');
  const parsed = parsePasted(pasted, sourceList);

  const [removing, setRemoving] = useState<Entry | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const add = useMutation({
    mutationFn: (entries: ReturnType<typeof parsePasted>['entries']) =>
      api.post<{ added: number; skipped: number; flagged: number }>('/api/v1/sanctions', { entries }),
    onSuccess: (result) => {
      toast.success(`${result.added} added${result.skipped ? `, ${result.skipped} already there` : ''}`, {
        description: `Everybody has been screened against the list. ${result.flagged} ${
          result.flagged === 1 ? 'practitioner is' : 'practitioners are'
        } flagged.`,
      });
      setFullName('');
      setFolio('');
      setReason('');
      setListedAt('');
      setPasted('');
      void queryClient.invalidateQueries({ queryKey: ['sanctions'] });
    },
    onError: (error) => toast.error('Could not add it', { description: errorMessage(error) }),
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
    onError: (error) => toast.error('Could not remove it', { description: errorMessage(error) }),
  });

  const single = {
    fullName,
    sourceList,
    ...(folio.trim() ? { folioNumber: folio.trim() } : {}),
    reason,
    listedAt,
  };
  const singleReady = fullName.trim().length >= 3 && reason.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(listedAt);

  return (
    <>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.fullName}</DialogTitle>
            <DialogDescription>
              Anybody this entry flagged is clear again unless another entry still matches them.
              The reason is kept with your name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="remove-reason">Why is it being removed?</Label>
            <Textarea
              id="remove-reason"
              value={removeReason}
              maxLength={500}
              onChange={(event) => setRemoveReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={removeReason.trim().length < 5}
              loading={remove.isPending}
              onClick={() => removing && remove.mutate(removing)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              Medilink does not receive these lists from anybody. Add them from the regulator&rsquo;s
              published notices below.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Add to the list</CardTitle>
            <CardDescription className="text-xs">
              Everybody is screened against the list as soon as it changes, not at the next daily
              check.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="sanction-source-list">Which list</Label>
              <Select value={sourceList} onValueChange={(value) => setSourceList(value as SourceList)}>
                <SelectTrigger id="sanction-source-list">
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
            </div>

            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (singleReady) add.mutate([single]);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="sanction-name">Full name</Label>
                <Input id="sanction-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sanction-folio">Folio number (if given)</Label>
                <Input id="sanction-folio" value={folio} onChange={(e) => setFolio(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sanction-reason">Reason or notice reference</Label>
                <Input id="sanction-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sanction-date">Date listed</Label>
                <Input id="sanction-date" type="date" value={listedAt} onChange={(e) => setListedAt(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!singleReady} loading={add.isPending && add.variables?.length === 1}>
                  Add
                </Button>
              </div>
            </form>

            <div className="space-y-1.5 border-t pt-5">
              <Label htmlFor="sanction-paste">Or paste a notice</Label>
              <p className="text-xs text-muted-foreground">
                One person per line: name | folio number (may be empty) | reason | date listed
                (YYYY-MM-DD). Added to the list chosen above, up to 500 at a time, all or none.
              </p>
              <Textarea
                id="sanction-paste"
                rows={5}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="Amina Yusuf | MDCN/12345 | MDCN notice, March 2026 | 2026-03-01"
              />
              {parsed.problems.length > 0 ? (
                <ul className="text-xs text-destructive-text">
                  {parsed.problems.slice(0, 5).map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
              <Button
                variant="outline"
                disabled={parsed.entries.length === 0 || parsed.problems.length > 0}
                loading={add.isPending && (add.variables?.length ?? 0) !== 1}
                onClick={() => add.mutate(parsed.entries)}
              >
                Add {parsed.entries.length || ''} {parsed.entries.length === 1 ? 'entry' : 'entries'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">On the list</CardTitle>
            <form
              className="flex max-w-md gap-2 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                setApplied(search.trim());
              }}
            >
              <Input
                aria-label="Search the list by name or folio number"
                placeholder="Search by name or folio number"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
          </CardHeader>
          <CardContent>
            {list.isPending ? (
              <QueueSkeleton rows={3} />
            ) : list.isError ? (
              <ErrorState
                error={list.error}
                onRetry={() => void list.refetch()}
                retrying={list.isFetching}
                compact
              />
            ) : list.data.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {applied ? 'Nobody on the list matches that.' : 'Nobody is on the list.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>List</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Listed</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm">
                        <p className="font-medium">{entry.fullName}</p>
                        {entry.folioNumber ? (
                          <p className="font-mono text-xs text-muted-foreground">{entry.folioNumber}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{listLabel(entry.sourceList)}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">{entry.reason}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(entry.listedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${entry.fullName}`}
                          onClick={() => setRemoving(entry)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
