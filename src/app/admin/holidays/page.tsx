'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { formatDate } from '@/components/app/format';

interface Holiday {
  id: string;
  date: string;
  name: string;
  year: number;
}

interface YearCoverage {
  year: number;
  missingStatutory: string[];
  missingMoveable: string[];
}

interface Payload {
  holidays: Holiday[];
  coverage: { years: YearCoverage[]; statutoryGap: boolean };
}

/**
 * The public holidays the holiday premium is paid on.
 *
 * A shift on a date that is not here is an ordinary day, so the page leads with
 * whether this year and next are complete and says which declared holidays
 * (Eid, a substitute Monday) are still to be entered. Those are announced by the
 * Government shortly before the day and cannot be filled in ahead of it.
 */
export default function HolidaysPage() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['holidays'],
    queryFn: () => api.get<Payload>('/api/v1/holidays'),
  });

  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<{ id: string; name: string; date: string } | null>(null);

  const add = useMutation({
    mutationFn: () => api.post('/api/v1/holidays', { date, name: name.trim() }),
    onSuccess: () => {
      toast.success('Holiday added', {
        description: 'Shifts on that date are paid the holiday premium from now on.',
      });
      setDate('');
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (error) => toast.error('Could not add it', { description: errorMessage(error) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/holidays/${id}`),
    onSuccess: () => {
      toast.success('Holiday removed');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (error) => toast.error('Could not remove it', { description: errorMessage(error) }),
  });

  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && name.trim().length >= 2;
  const coverage = list.data?.coverage;

  return (
    <>
      <PageHeader
        title="Public holidays"
        description="Hours worked on these dates are paid the holiday premium on a facility's rate card. A date that is not here is an ordinary day, so keep this list ahead of the calendar."
      />

      <div className="space-y-6">
        {list.isPending ? (
          <QueueSkeleton rows={4} />
        ) : list.isError ? (
          <ErrorState
            error={list.error}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        ) : (
          <>
            {coverage?.years.map((year) => {
              const entered = list.data.holidays.filter((row) => row.year === year.year);
              const hasGap = year.missingStatutory.length > 0;
              return (
                <Card key={year.year}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{year.year}</CardTitle>
                    <CardDescription className="text-xs">
                      {entered.length} {entered.length === 1 ? 'holiday' : 'holidays'} in the list
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {hasGap ? (
                      <Alert variant="destructive">
                        <TriangleAlert />
                        <AlertTitle>The list for {year.year} is incomplete</AlertTitle>
                        <AlertDescription>
                          Missing: {year.missingStatutory.join(', ')}. Shifts on those dates are
                          being paid as ordinary days. Add them below.
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {year.missingMoveable.length > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Still to enter when the Government declares them:{' '}
                        <strong>{year.missingMoveable.join(', ')}</strong>.
                      </p>
                    ) : null}

                    {entered.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Holiday</TableHead>
                            <TableHead className="w-24" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entered.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="whitespace-nowrap">
                                {formatDate(row.date)}
                              </TableCell>
                              <TableCell>{row.name}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Remove ${row.name}, ${formatDate(row.date)}`}
                                  onClick={() =>
                                    setRemoving({ id: row.id, name: row.name, date: row.date })
                                  }
                                >
                                  Remove
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Add a holiday</CardTitle>
            <CardDescription className="text-xs">
              For a holiday the Government has declared (Eid, or a Monday given in place of one that
              fell on a weekend). Every change is recorded with your name.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                if (ready) add.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="holiday-date">Date</Label>
                <Input
                  id="holiday-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="holiday-name">Name</Label>
                <Input
                  id="holiday-name"
                  value={name}
                  maxLength={100}
                  placeholder="Eid al-Fitr"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={!ready} loading={add.isPending}>
                Add holiday
              </Button>
              {!ready ? (
                <p className="text-sm text-muted-foreground sm:col-span-3">
                  Add needs a date and a name of at least two letters.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Remove this holiday"
        object={removing ? `${removing.name} · ${formatDate(removing.date)}` : ''}
        consequence="From now on, hours worked on that date are an ordinary day and are not paid the holiday premium on a facility's rate card."
        reversible="Add it again from the form below."
        destructive
        confirmLabel="Remove holiday"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </>
  );
}
