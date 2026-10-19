'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PlusCircle, ShieldCheck, TriangleAlert } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { containsPatientIdentifier } from '@/modules/clinical-incidents/domain/incident';
import { Field } from '@/components/app/field';
import { SuccessScreen } from '@/components/app/success-screen';
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
 *
 * Filing is permanent — a report cannot be edited or withdrawn — and the form says so beside the
 * button that files it. What the person needs after that is not a toast that fades but what will
 * happen to it, so a filed report ends on a screen that says who is told and where the outcome
 * will appear. A report that fails to file keeps everything that was typed.
 */
export function ReportIncidentDialog({ facilityId }: { facilityId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const [occurredAt, setOccurredAt] = useState('');
  const [severity, setSeverity] = useState('NEAR_MISS');
  const [category, setCategory] = useState('MEDICATION');
  const [summary, setSummary] = useState('');
  const [assignmentId, setAssignmentId] = useState<string>(NO_SHIFT);
  const [attempted, setAttempted] = useState(false);
  const [filedSeverity, setFiledSeverity] = useState<string | null>(null);

  const occurredRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

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
      setFiledSeverity(severity);
    },
    onError: (error) => toast.error('Could not report it', { description: errorMessage(error) }),
  });

  const identifier = containsPatientIdentifier(summary);
  const occurredError = !occurredAt
    ? 'Say when it happened.'
    : lagosLocalToInstant(occurredAt).getTime() > Date.now()
      ? 'That time has not happened yet. Use when it actually happened.'
      : undefined;
  const summaryError = identifier
    ? 'This looks like it has a phone number, ID or hospital number, or an email address, in it. Take it out and the report can be filed.'
    : summary.trim().length < MIN_SUMMARY
      ? `Describe what happened in at least ${MIN_SUMMARY} characters${
          summary.trim().length > 0 ? ` (${MIN_SUMMARY - summary.trim().length} more)` : ''
        }.`
      : undefined;

  function submit() {
    if (occurredError || summaryError) {
      setAttempted(true);
      (occurredError ? occurredRef : summaryRef).current?.focus();
      return;
    }
    report.mutate();
  }

  function reset() {
    setSummary('');
    setOccurredAt('');
    setAssignmentId(NO_SHIFT);
    setSeverity('NEAR_MISS');
    setCategory('MEDICATION');
    setAttempted(false);
    setFiledSeverity(null);
    report.reset();
  }

  function onOpenChange(next: boolean) {
    if (report.isPending) return;
    setOpen(next);
    // After a report is filed the form has done its job; reopening should not offer it again.
    if (!next && filedSeverity !== null) reset();
  }

  const urgent = filedSeverity === 'SEVERE' || filedSeverity === 'DEATH';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle />
          Report an incident
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {filedSeverity === null ? 'Report an incident' : 'Report filed'}
          </DialogTitle>
          <DialogDescription>
            {filedSeverity === null
              ? 'A report is not an accusation. Most incidents turn out to be a system failing rather than a person, and naming somebody is optional here for exactly that reason.'
              : 'Your report is on the record.'}
          </DialogDescription>
        </DialogHeader>

        {filedSeverity !== null ? (
          <SuccessScreen
            bare
            title="Your report has been filed"
            description="It is in front of Medilink's compliance team now. It cannot be edited or withdrawn."
            steps={[
              urgent
                ? 'Because it is severe, everybody who handles incidents for Medilink is told straight away.'
                : 'It joins compliance’s queue. A report below severe sends no alert and waits there until an officer opens it.',
              urgent
                ? 'It cannot be closed until somebody has opened it and looked.'
                : 'An officer opens it and may ask the ward for more.',
              'When it is closed, the outcome and the notes behind it appear on this page, in the report’s record.',
            ]}
            actions={
              <Button size="lg" onClick={() => onOpenChange(false)}>
                Back to the incidents
              </Button>
            }
          />
        ) : (
          <>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="When it happened"
                  required
                  hint="Lagos time."
                  error={attempted ? occurredError : undefined}
                >
                  <Input
                    ref={occurredRef}
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(event) => setOccurredAt(event.target.value)}
                  />
                </Field>

                <Field label="Category">
                  {(a11y) => (
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger {...a11y}>
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
                  )}
                </Field>

                <Field label="Severity" className="sm:col-span-2">
                  {(a11y) => (
                    <Select value={severity} onValueChange={setSeverity}>
                      <SelectTrigger {...a11y}>
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
                  )}
                </Field>
              </div>

              <div className="space-y-2">
                <Field
                  label="The shift it happened on"
                  optional
                  hint={`Choosing a shift links the report to the practitioner who worked it. Shifts from the last ${LOOKBACK_DAYS} days are listed.`}
                >
                  {(a11y) => (
                    <Select value={assignmentId} onValueChange={setAssignmentId}>
                      <SelectTrigger {...a11y}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SHIFT}>
                          Not about a particular shift or person
                        </SelectItem>
                        {(recent.data ?? []).map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {row.practitionerName} · {formatWhen(row.startsAt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                {recent.isError ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p role="alert" className="text-sm font-medium text-destructive-text">
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
              </div>

              <Field
                label="What happened"
                required
                hint="Do not write who the patient was: no name, phone number, hospital or ID number. Say what happened and what was done about it; compliance can ask the ward for the rest."
                // A patient identifier is flagged as it is typed, because the safe moment to remove
                // it is before it has been sent; the length is only mentioned once they try to file.
                error={identifier || attempted ? summaryError : undefined}
              >
                <Textarea
                  ref={summaryRef}
                  rows={4}
                  placeholder="What was supposed to happen, what happened instead, and what was done about it."
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </Field>

              <Alert variant="info">
                <ShieldCheck />
                <AlertDescription>
                  Reports cannot be edited or withdrawn once filed, and a severe one cannot be
                  closed until somebody has opened it and looked. That is what makes the record
                  worth keeping.
                </AlertDescription>
              </Alert>

              {report.isError ? (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertDescription className="space-y-1">
                    <p className="font-medium">The report was not filed.</p>
                    <p>{errorMessage(report.error)}</p>
                    <p>What you wrote is still here. Try again when you are ready.</p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>

            <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button loading={report.isPending} onClick={submit}>
                Report it
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
