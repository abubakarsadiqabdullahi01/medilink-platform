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
import { PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { formatDate, formatNaira, parseNairaToKobo } from '@/components/app/format';

interface Floor {
  id: string;
  categoryKey: string;
  specialtyKey: string;
  cadreLevelKey: string;
  shiftType: string;
  minHourlyKobo: number;
  effectiveFrom: string;
}

interface Overview {
  floors: Floor[];
  missing: { categoryKey: string; categoryName: string; shiftType: 'day' | 'night' }[];
  categories: {
    key: string;
    name: string;
    specialties: { key: string; name: string }[];
    levels: { key: string; name: string }[];
  }[];
}

const EVERY = '*';

/**
 * The lowest hourly rate a shift may be published at.
 *
 * A profession with no floor cannot have a shift published at all, so the page
 * leads with which are missing. What the numbers should be is for Medilink and
 * the regulators to decide; this is where they are entered once they have.
 * Floors are never edited or deleted: setting a new one from a later date
 * replaces it from that date, and the old one still explains the shifts priced
 * under it.
 */
export default function RateFloorsPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ['rate-floors'],
    queryFn: () => api.get<Overview>('/api/v1/rate-floors'),
  });

  const [categoryKey, setCategoryKey] = useState('');
  const [specialtyKey, setSpecialtyKey] = useState(EVERY);
  const [levelKey, setLevelKey] = useState(EVERY);
  const [shiftType, setShiftType] = useState<'day' | 'night'>('day');
  const [amount, setAmount] = useState('');
  const [startsOn, setStartsOn] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 10));

  const kobo = parseNairaToKobo(amount);
  const category = overview.data?.categories.find((row) => row.key === categoryKey);

  const set = useMutation({
    mutationFn: () =>
      api.post('/api/v1/rate-floors', {
        categoryKey,
        specialtyKey: specialtyKey === EVERY ? undefined : specialtyKey,
        cadreLevelKey: levelKey === EVERY ? undefined : levelKey,
        shiftType,
        minHourlyKobo: kobo,
        effectiveFrom: startsOn,
      }),
    onSuccess: () => {
      toast.success('Floor set', { description: 'It governs shifts that start from its date.' });
      setAmount('');
      void queryClient.invalidateQueries({ queryKey: ['rate-floors'] });
    },
    onError: (error) => toast.error('Could not set it', { description: errorMessage(error) }),
  });

  const nameOf = (key: string) => overview.data?.categories.find((row) => row.key === key)?.name ?? key;
  const levelName = (categoryKeyOf: string, key: string) =>
    overview.data?.categories.find((row) => row.key === categoryKeyOf)?.levels.find((row) => row.key === key)?.name ?? key;

  return (
    <>
      <PageHeader
        title="Pay floors"
        description="The lowest hourly rate a facility may offer, per profession and shift type. A profession with no floor cannot have a shift published."
      />

      {overview.isPending ? (
        <QueueSkeleton rows={3} />
      ) : overview.isError ? (
        <ErrorState
          error={overview.error}
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : (
        <>
          {overview.data.missing.length > 0 ? (
            <Alert variant="warning" className="mb-6">
              <TriangleAlert />
              <AlertTitle>No floor is in force for these, so shifts for them cannot be published</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-5">
                  {overview.data.missing.map((row) => (
                    <li key={`${row.categoryKey}-${row.shiftType}`}>
                      {row.categoryName}, {row.shiftType} shifts
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Set a floor</CardTitle>
              <CardDescription>
                From the date you choose, a shift that starts then must be offered at least this
                much an hour. It is for every specialty unless you pick one.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] space-y-1.5">
                <Label htmlFor="floor-profession">Profession</Label>
                <Select
                  value={categoryKey}
                  onValueChange={(value) => {
                    setCategoryKey(value);
                    setSpecialtyKey(EVERY);
                    setLevelKey(EVERY);
                  }}
                >
                  <SelectTrigger id="floor-profession">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {overview.data.categories.map((row) => (
                      <SelectItem key={row.key} value={row.key}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[12rem] space-y-1.5">
                <Label htmlFor="floor-specialty">Specialty</Label>
                <Select value={specialtyKey} onValueChange={setSpecialtyKey} disabled={!category}>
                  <SelectTrigger id="floor-specialty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EVERY}>Every specialty</SelectItem>
                    {(category?.specialties ?? []).map((row) => (
                      <SelectItem key={row.key} value={row.key}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(category?.levels ?? []).length > 0 ? (
                <div className="min-w-[12rem] space-y-1.5">
                  <Label htmlFor="floor-level">Level</Label>
                  <Select value={levelKey} onValueChange={setLevelKey}>
                    <SelectTrigger id="floor-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EVERY}>Every level</SelectItem>
                      {(category?.levels ?? []).map((row) => (
                        <SelectItem key={row.key} value={row.key}>
                          {row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="floor-shift">Shift</Label>
                <Select value={shiftType} onValueChange={(value) => setShiftType(value as 'day' | 'night')}>
                  <SelectTrigger id="floor-shift">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="night">Night</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="floor-amount">Minimum per hour (₦)</Label>
                <Input
                  id="floor-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="floor-date">From</Label>
                <Input
                  id="floor-date"
                  type="date"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </div>
              <Button
                disabled={!categoryKey || kobo === null || kobo < 1 || !startsOn}
                loading={set.isPending}
                onClick={() => set.mutate()}
              >
                Set floor
              </Button>
              {amount !== '' && kobo === null ? (
                <p className="basis-full text-xs text-destructive-text">That is not an amount in naira.</p>
              ) : null}
            </CardContent>
          </Card>

          {overview.data.floors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No floor has been set for anything yet.</p>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Profession</TableHead>
                      <TableHead>Specialty</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead className="text-right">Minimum per hour</TableHead>
                      <TableHead>From</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.data.floors.map((floor) => (
                      <TableRow key={floor.id}>
                        <TableCell>{nameOf(floor.categoryKey)}</TableCell>
                        <TableCell>{floor.specialtyKey === EVERY ? 'Every specialty' : floor.specialtyKey}</TableCell>
                        <TableCell>{floor.cadreLevelKey === EVERY ? 'Every level' : levelName(floor.categoryKey, floor.cadreLevelKey)}</TableCell>
                        <TableCell className="capitalize">{floor.shiftType}</TableCell>
                        <TableCell className="tabular text-right">{formatNaira(floor.minHourlyKobo)}</TableCell>
                        <TableCell>{formatDate(floor.effectiveFrom)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}
