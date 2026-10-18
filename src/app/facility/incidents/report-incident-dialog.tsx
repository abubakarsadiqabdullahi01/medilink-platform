'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PlusCircle, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea';
import { containsPatientIdentifier } from '@/modules/clinical-incidents/domain/incident';
import { humanise } from '@/components/app/status-badge';
import { formatWhen } from '@/components/app/format';
import { lagosLocalToInstant } from '@/lib/lagos-date';

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

/** Far enough back to cover last week's shifts, which is when most reports are written. */
const LOOKBACK_DAYS = 14;
const NO_SHIFT = 'none';

interface RecentShift {
  id: string;
  practitionerName: string;
  startsAt: string;
}

/**
 * Reporting an incident, from the ward.
 *
 * **Naming a practitioner is optional and says so on the form.** Most
 * incidents are a system failing rather than a person, and a form that
 * demands a name teaches people to find one. The near-miss option is first in
 * the list for the same reason: a reporting culture that only hears about
 * harm has already lost the cases worth learning from.
 */
export function ReportIncidentDialog({ facilityId }: { facilityId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const [occurredAt, setOccurredAt] = useState('');
  const [severity, setSeverity] = useState('NEAR_MISS');
  const [category, setCategory] = useState('MEDICATION');
  const [summary, setSummary] = useState('');
  const [assignmentId, setAssignmentId] = useState<string>(NO_SHIFT);

  // Naming a shift names the practitioner on it: the server takes the
  // subject from the assignment, after checking it is this facility's. Until
  // this list existed the form said naming somebody was optional and offered
  // no way to do it, so an incident could never reach the person involved —
  // a suspension decided on one suspended nobody.
  const recent = useQuery({
    queryKey: ['incident-recent-shifts', facilityId],
    queryFn: async () => {
      const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const body = await api.get<{ assignments?: RecentShift[] }>(
        `/api/v1/assignments?scopeType=FACILITY&scopeId=${facilityId}&from=${from}&to=${to}`,
      );
      return [...(body.assignments ?? [])].sort(
        (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
      );
    },
    enabled: open,
  });

  const report = useMutation({
    mutationFn: () =>
      api.post('/api/v1/incidents', {
        facilityId,
        occurredAt: lagosLocalToInstant(occurredAt).toISOString(),
        severity,
        category,
        summary: summary.trim(),
        assignmentId: assignmentId === NO_SHIFT ? undefined : assignmentId,
      }),
    onSuccess: () => {
      toast.success('Reported', {
        description: 'Compliance sees it immediately. It cannot be edited or withdrawn.',
      });
      void queryClient.invalidateQueries({ queryKey: ['facility-incidents'] });
      setOpen(false);
      setSummary('');
      setOccurredAt('');
      setAssignmentId(NO_SHIFT);
    },
    onError: (error) => toast.error('Could not report it', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle />
          Report an incident
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Report an incident</DialogTitle>
          <DialogDescription>
            A report is not an accusation. Most incidents turn out to be a system failing rather
            than a person, and naming somebody is optional here for exactly that reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              <Label htmlFor="report-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="report-category">
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
              <Label htmlFor="report-severity">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger id="report-severity">
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
            <Label htmlFor="report-shift">
              The shift it happened on{' '}
              <span className="font-normal text-muted-foreground">— optional</span>
            </Label>
            <Select value={assignmentId} onValueChange={setAssignmentId}>
              <SelectTrigger id="report-shift">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SHIFT}>Not about a particular shift or person</SelectItem>
                {(recent.data ?? []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.practitionerName} · {formatWhen(row.startsAt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recent.isError ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-xs text-destructive-text">
                  Your recent shifts could not be loaded, so none can be chosen right now.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={recent.isFetching}
                  onClick={() => void recent.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Choosing a shift links the report to the practitioner who worked it. Shifts from the
              last {LOOKBACK_DAYS} days are listed.
            </p>
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
            <p className="text-xs text-muted-foreground">
              Do not write who the patient was: no name, phone number, hospital or ID number. Say
              what happened and what was done about it; compliance can ask the ward for the rest.
            </p>
            {containsPatientIdentifier(summary) ? (
              <p role="alert" className="text-xs text-destructive-text">
                This looks like it has a phone number, ID or hospital number, or an email address,
                in it. Take it out and the report can be filed.
              </p>
            ) : null}
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !occurredAt ||
              summary.trim().length < MIN_SUMMARY ||
              containsPatientIdentifier(summary)
            }
            loading={report.isPending}
            onClick={() => report.mutate()}
          >
            Report it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
