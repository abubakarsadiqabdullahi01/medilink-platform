'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, Stethoscope, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { useQueue } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SeverityBadge, StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatWhen } from '@/components/app/format';

interface Incident {
  id: string;
  severity: string;
  category: string;
  summary: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
}

const SEVERITIES = [
  ['NEAR_MISS', 'Near miss — caught before it reached the patient'],
  ['MINOR', 'Minor — no lasting harm'],
  ['MODERATE', 'Moderate — treatment or a longer stay'],
  ['SEVERE', 'Severe — lasting harm'],
  ['DEATH', 'Death'],
] as const;

const CATEGORIES = [
  'MEDICATION',
  'CLINICAL_PROCEDURE',
  'DOCUMENTATION',
  'INFECTION_CONTROL',
  'EQUIPMENT',
  'STAFFING',
  'CONDUCT',
  'OTHER',
] as const;

const MIN_SUMMARY = 20;

/**
 * Reporting an incident, from the ward.
 *
 * **Naming a practitioner is optional and says so on the form.** Most
 * incidents are a system failing rather than a person, and a form that
 * demands a name teaches people to find one. The near-miss option is first in
 * the list for the same reason: a reporting culture that only hears about
 * harm has already lost the cases worth learning from.
 */
export default function FacilityIncidentsPage() {
  const facilityId = useFacilityId();
  const queryClient = useQueryClient();

  const queue = useQueue<Incident>(
    ['facility-incidents', facilityId],
    `/api/v1/incidents?facilityId=${facilityId}`,
    (body) => (body as { incidents?: Incident[] }).incidents ?? [],
  );

  const [occurredAt, setOccurredAt] = useState('');
  const [severity, setSeverity] = useState('NEAR_MISS');
  const [category, setCategory] = useState('MEDICATION');
  const [summary, setSummary] = useState('');

  const report = useMutation({
    mutationFn: () =>
      api.post('/api/v1/incidents', {
        facilityId,
        occurredAt: new Date(occurredAt).toISOString(),
        severity,
        category,
        summary: summary.trim(),
      }),
    onSuccess: () => {
      toast.success('Reported', {
        description: 'Compliance sees it immediately. It cannot be edited or withdrawn.',
      });
      void queryClient.invalidateQueries({ queryKey: ['facility-incidents'] });
      setSummary('');
      setOccurredAt('');
    },
    onError: (error) => toast.error('Could not report it', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title="Clinical incidents"
        description="A report is not an accusation. Most incidents turn out to be a system failing rather than a person, and naming somebody is optional here for exactly that reason."
      />

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Report an incident</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="occurred">When it happened</Label>
              <Input
                id="occurred"
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanise(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="summary">What happened</Label>
            <Textarea
              id="summary"
              rows={4}
              placeholder="What was supposed to happen, what happened instead, and what was done about it."
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
            {summary.length > 0 && summary.trim().length < MIN_SUMMARY ? (
              <p className="text-xs text-muted-foreground">
                {MIN_SUMMARY - summary.trim().length} more characters needed.
              </p>
            ) : null}
          </div>

          <Alert variant="info">
            <ShieldCheck />
            <AlertDescription>
              Reports cannot be edited or withdrawn once filed, and a severe one cannot be closed
              until somebody has opened it and looked. That is what makes the record worth keeping.
            </AlertDescription>
          </Alert>

          <Button
            disabled={!occurredAt || summary.trim().length < MIN_SUMMARY}
            loading={report.isPending}
            onClick={() => report.mutate()}
          >
            Report it
          </Button>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-medium">Reported by this facility</h2>

      {queue.isPending ? (
        <QueueSkeleton rows={2} />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>These could not be loaded.</AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <EmptyState icon={<Stethoscope />} title="Nothing reported yet" />
      ) : (
        <div className="space-y-3">
          {queue.data.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-2 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={row.severity} />
                  <StatusBadge status={row.status} />
                  <span className="text-xs text-muted-foreground">
                    {humanise(row.category)} · occurred {formatWhen(row.occurredAt)} · reported{' '}
                    {formatAgo(row.reportedAt)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{row.summary}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
