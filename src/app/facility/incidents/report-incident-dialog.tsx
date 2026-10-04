'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { humanise } from '@/components/app/status-badge';

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
export function ReportIncidentDialog({ facilityId }: { facilityId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

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
      setOpen(false);
      setSummary('');
      setOccurredAt('');
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!occurredAt || summary.trim().length < MIN_SUMMARY}
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
