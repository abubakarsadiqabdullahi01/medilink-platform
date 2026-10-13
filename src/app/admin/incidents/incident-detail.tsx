'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, History, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SeverityBadge, StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, PageHeader } from '@/components/app/page-shell';
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

export function IncidentDetail({ incident, onBack }: { incident: Incident; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState('SYSTEM_ISSUE');
  const [note, setNote] = useState('');

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
      refresh();
    },
    onError: (error) => toast.error('Could not close it', { description: errorMessage(error) }),
  });

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
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <SeverityBadge severity={row.severity} />
            <StatusBadge status={row.status} />
            <span className="text-sm text-muted-foreground">{humanise(row.category)}</span>
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
                <CardTitle className="text-sm">What was reported</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="leading-relaxed">{row.summary}</p>

                <DetailGrid>
                  <Detail label="Occurred">{formatWhen(row.occurredAt)}</Detail>
                  <Detail label="Reported">{formatWhen(row.reportedAt)}</Detail>
                  <Detail label="Facility">{row.facilityName}</Detail>
                  <Detail label="Shift">
                    {fresh.data?.shift
                      ? formatWhen(fresh.data.shift.startsAt)
                      : row.assignmentId
                        ? shortId(row.assignmentId)
                        : 'Not tied to one'}
                  </Detail>
                  {fresh.data?.subject ? (
                    <Detail label="Practitioner">
                      {fresh.data.subject.fullName}{' '}
                      <span className="font-mono text-xs text-muted-foreground">
                        {fresh.data.subject.phone}
                      </span>
                    </Detail>
                  ) : null}
                </DetailGrid>

                {/* Said plainly because the absence is meaningful: an incident
                    naming nobody is the normal case, not an incomplete one. */}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {row.subjectUserId
                    ? `This report names ${fresh.data?.subject?.fullName ?? 'a practitioner'}. Naming somebody is not an accusation — most incidents close as a system issue.`
                    : 'This report names no practitioner, which is ordinary. An incident traceable to no one person is still worth having.'}
                </p>
              </CardContent>
            </Card>

            {row.status === 'CLOSED' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">How it was closed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <DetailGrid>
                    <Detail label="Outcome">{row.outcome ? humanise(row.outcome) : '—'}</Detail>
                    <Detail label="Closed">{row.closedAt ? formatWhen(row.closedAt) : '—'}</Detail>
                  </DetailGrid>
                  {row.closureNotes ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What was found
                      </p>
                      <p className="mt-1">{row.closureNotes}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {open ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Decide</CardTitle>
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

                  <div className="space-y-1.5">
                    <Label>Outcome</Label>
                    <Select value={outcome} onValueChange={setOutcome}>
                      <SelectTrigger>
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
                                ? `Suspend ${fresh.data?.subject?.fullName ?? 'the practitioner'}`
                                : 'Suspend the practitioner (this report names nobody)'
                              : label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="closure-note">
                      What was found{' '}
                      <span className="font-normal text-muted-foreground">— required</span>
                    </Label>
                    <Textarea
                      id="closure-note"
                      rows={3}
                      placeholder="The cause, and what follows from it."
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      At least {MIN_NOTE} characters. This is what the record will say happened.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
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
                      disabled={
                        note.trim().length < MIN_NOTE || blockedUntilTaken || close.isPending
                      }
                      loading={close.isPending}
                      onClick={() => close.mutate()}
                    >
                      Close incident
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this case
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.isPending ? (
                  <Skeleton className="h-32 w-full" />
                ) : history.isError ? (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertDescription>The history could not be loaded.</AlertDescription>
                  </Alert>
                ) : history.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {history.data.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-border pl-4">
                        <p className="text-sm font-medium">
                          {actionLabel(entry.action)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatWhen(entry.createdAt)} · {formatAgo(entry.createdAt)}
                        </p>
                        {entry.reason ? <p className="mt-1 text-sm">{entry.reason}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
