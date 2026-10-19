'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, History, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { PageHeader } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { SeverityBadge, StatusBadge, humanise } from '@/components/app/status-badge';
import { Timeline } from '@/components/app/timeline';
import { actionLabel, formatAgo, formatWhen, shortId } from '@/components/app/format';

/**
 * One incident, in full, with what has happened to it.
 *
 * The queue had every case expanded with its outcome picker open, which made
 * a page of decisions all equally loud. A severe case and a near miss looked
 * the same until you read them. Deciding one at a time, on its own screen, is
 * the shape the work actually has.
 */

export interface Incident {
  id: string;
  facilityId: string;
  facilityName: string;
  assignmentId: string | null;
  subjectUserId: string | null;
  reportedBy: string;
  occurredAt: string;
  reportedAt: string;
  severity: string;
  category: string;
  summary: string;
  status: string;
  outcome: string | null;
  closedAt: string | null;
  closureNotes: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
}

const OUTCOMES = [
  ['SYSTEM_ISSUE', 'System issue — the cause was the process, not a person'],
  ['NO_ACTION', 'No action'],
  ['ADVICE_GIVEN', 'Advice given'],
  ['TRAINING_REQUIRED', 'Training required'],
  ['PRACTITIONER_SUSPENDED', 'Suspend the practitioner'],
  ['REFERRED_TO_REGULATOR', 'Refer to the regulator'],
] as const;

const MIN_NOTE = 20;

/** A fact with its label, wrapping rather than cutting a name or a number short. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function IncidentDetail({ incident, onBack }: { incident: Incident; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState('SYSTEM_ISSUE');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  // The route returns { incident, subjectHistory }, not the incident alone —
  // it always carries the subject's other reports alongside it, so a reader
  // never has to decide from one report whether this is a pattern.
  const fresh = useQuery({
    queryKey: ['incident', incident.id],
    queryFn: () =>
      api.get<{
        incident: Incident;
        subject: { fullName: string; phone: string; status: string } | null;
        shift: { startsAt: string; endsAt: string } | null;
        subjectHistory: Incident[];
      }>(`/api/v1/incidents/${incident.id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ['incident-history', incident.id],
    queryFn: async () => {
      const body = await api.get<{ entries?: AuditEntry[] }>(
        `/api/v1/audit?scopeType=PLATFORM&entityId=${incident.id}&limit=25`,
      );
      return body.entries ?? [];
    },
    retry: false,
  });

  const row = fresh.data?.incident ?? incident;
  const open = row.status !== 'CLOSED';
  // Kept from the original queue: the two most serious outcomes have to be
  // taken by somebody before they can be closed, so the decision has a name
  // against it rather than arriving from a queue nobody owned.
  const mustReview = ['SEVERE', 'DEATH'].includes(row.severity);
  const blockedUntilTaken = mustReview && row.status === 'REPORTED';
  const subjectName = fresh.data?.subject?.fullName ?? 'the practitioner';

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['incident', incident.id] });
    void queryClient.invalidateQueries({ queryKey: ['incident-history', incident.id] });
    void queryClient.invalidateQueries({ queryKey: ['incident-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['tile'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-incidents'] });
  }

  const take = useMutation({
    mutationFn: () => api.post(`/api/v1/incidents/${incident.id}/review`),
    onSuccess: () => {
      toast.success('Case taken');
      refresh();
    },
    onError: (error) => toast.error('Could not take it', { description: errorMessage(error) }),
  });

  const close = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/incidents/${incident.id}/close`, { outcome, notes: note.trim() }),
    onSuccess: () => {
      toast.success('Incident closed');
      setNote('');
      setConfirming(false);
      refresh();
    },
    onError: (error) => toast.error('Could not close it', { description: errorMessage(error) }),
  });

  const noteLength = note.trim().length;
  const noteTooShort = noteLength > 0 && noteLength < MIN_NOTE;
  const outcomeLabel = OUTCOMES.find(([value]) => value === outcome)?.[1] ?? humanise(outcome);

  return (
    <>
      <PageHeader
        title={`${humanise(row.category)} at ${row.facilityName}`}
        description={`Reported ${formatAgo(row.reportedAt)}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            All incidents
          </Button>
        }
      />

      <div className="space-y-6">
        {fresh.isError ? (
          <ErrorState
            compact
            error={fresh.error}
            onRetry={() => void fresh.refetch()}
            retrying={fresh.isFetching}
          />
        ) : null}

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <SeverityBadge severity={row.severity} />
            <StatusBadge status={row.status} />
            <span className="text-base text-muted-foreground">{humanise(row.category)}</span>
          </CardContent>
        </Card>

        <Tabs defaultValue="case">
          <TabsList>
            <TabsTrigger value="case">The case</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="case" className="space-y-6 pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">What was reported</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="leading-relaxed">{row.summary}</p>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact label="Occurred">{formatWhen(row.occurredAt)}</Fact>
                  <Fact label="Reported">{formatWhen(row.reportedAt)}</Fact>
                  <Fact label="Facility">{row.facilityName}</Fact>
                  <Fact label="Shift">
                    {fresh.data?.shift
                      ? formatWhen(fresh.data.shift.startsAt)
                      : row.assignmentId
                        ? shortId(row.assignmentId)
                        : 'Not tied to one'}
                  </Fact>
                  {fresh.data?.subject ? (
                    <Fact label="Practitioner">
                      {fresh.data.subject.fullName}{' '}
                      <span className="block font-mono text-sm text-muted-foreground">
                        {fresh.data.subject.phone}
                      </span>
                    </Fact>
                  ) : null}
                </dl>

                {/* Said plainly because the absence is meaningful: an incident
                    naming nobody is the normal case, not an incomplete one. */}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {row.subjectUserId
                    ? `This report names ${fresh.data?.subject?.fullName ?? 'a practitioner'}. Naming somebody is not an accusation — most incidents close as a system issue.`
                    : 'This report names no practitioner, which is ordinary. An incident traceable to no one person is still worth having.'}
                </p>
              </CardContent>
            </Card>

            {row.status === 'CLOSED' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">How it was closed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fact label="Outcome">{row.outcome ? humanise(row.outcome) : '—'}</Fact>
                    <Fact label="Closed">{row.closedAt ? formatWhen(row.closedAt) : '—'}</Fact>
                  </dl>
                  {row.closureNotes ? (
                    <div className="rounded-md bg-muted px-3 py-2">
                      <p className="text-sm font-medium text-muted-foreground">What was found</p>
                      <p className="mt-1">{row.closureNotes}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {open ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Decide</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {blockedUntilTaken ? (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertDescription>
                        A {row.severity.toLowerCase().replace('_', ' ')} incident cannot be closed
                        straight from the queue. Take the case first, so the decision has a name
                        against it.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Field label="Outcome">
                    {(a11y) => (
                      <Select value={outcome} onValueChange={setOutcome}>
                        <SelectTrigger {...a11y}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OUTCOMES.map(([value, label]) => (
                            // Suspending needs somebody to suspend; the server
                            // refuses it on a report naming nobody, so the
                            // option says why rather than failing on click.
                            <SelectItem
                              key={value}
                              value={value}
                              disabled={value === 'PRACTITIONER_SUSPENDED' && !row.subjectUserId}
                            >
                              {value === 'PRACTITIONER_SUSPENDED'
                                ? row.subjectUserId
                                  ? `Suspend ${subjectName}`
                                  : 'Suspend the practitioner (this report names nobody)'
                                : label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>

                  <Field
                    label="What was found"
                    required
                    hint={`At least ${MIN_NOTE} characters. This is what the record will say happened.`}
                    error={
                      noteTooShort
                        ? `${MIN_NOTE - noteLength} more character${MIN_NOTE - noteLength === 1 ? '' : 's'} needed.`
                        : undefined
                    }
                  >
                    <Textarea
                      rows={3}
                      placeholder="The cause, and what follows from it."
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </Field>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    {row.status === 'REPORTED' ? (
                      <Button
                        variant="outline"
                        loading={take.isPending}
                        onClick={() => take.mutate()}
                      >
                        Take this case
                      </Button>
                    ) : null}

                    <Button
                      disabled={noteLength < MIN_NOTE || blockedUntilTaken}
                      onClick={() => setConfirming(true)}
                    >
                      Review and close
                    </Button>
                  </div>
                  {row.status === 'REPORTED' ? (
                    <p className="text-sm text-muted-foreground">
                      Taking a case marks it under review, with your name against it in the history.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this case
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.isPending ? (
                  <ListSkeleton rows={2} label="Loading the history" />
                ) : history.isError ? (
                  <ErrorState
                    compact
                    error={history.error}
                    onRetry={() => void history.refetch()}
                    retrying={history.isFetching}
                  />
                ) : history.data.length === 0 ? (
                  <p className="text-base text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  <Timeline
                    label="History of this incident"
                    steps={history.data.map((entry) => ({
                      id: entry.id,
                      state: 'done' as const,
                      title: actionLabel(entry.action),
                      when: `${formatWhen(entry.createdAt)} · ${formatAgo(entry.createdAt)}`,
                      detail: entry.reason ?? undefined,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Close this incident"
        object={
          <>
            {humanise(row.category)} at {row.facilityName} · {humanise(row.severity)}
            <span className="block font-normal text-muted-foreground">Outcome: {outcomeLabel}</span>
          </>
        }
        consequence={
          <>
            The incident is closed with this outcome, and what you wrote becomes the record of what
            was found. There is no way to reopen a closed incident from here.
            {outcome === 'PRACTITIONER_SUSPENDED' ? (
              <>
                {' '}
                <strong>{subjectName}&apos;s account is suspended in the same step.</strong> Lifting
                a suspension is a separate action, taken from their record.
              </>
            ) : null}
            {outcome === 'REFERRED_TO_REGULATOR' ? (
              <> This records the decision to refer; nothing is sent to the regulator from here.</>
            ) : null}
          </>
        }
        reversible={false}
        destructive={outcome === 'PRACTITIONER_SUSPENDED'}
        confirmLabel="Close incident"
        cancelLabel="Not yet"
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      />
    </>
  );
}
