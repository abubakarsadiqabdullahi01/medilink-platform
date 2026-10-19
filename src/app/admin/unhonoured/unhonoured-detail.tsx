'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { Timeline } from '@/components/app/timeline';
import { actionLabel, formatAgo, formatWhen } from '@/components/app/format';

/**
 * One unhonoured shift, and the decision about whose fault it was.
 *
 * The three options are not a dropdown, and each states its consequence, for
 * the reason the original queue gave: only one of them marks a practitioner's
 * record, and an officer clicking through a morning should not have to hold
 * that in their head. What changed is that the decision now happens on its own
 * screen with the shift in front of it, instead of inside a card in a list.
 */

export interface Unhonoured {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  practitionerName: string;
  practitionerPhone: string;
  facilityName: string;
  status: string;
  fault: string | null;
  reason: string | null;
  decidedAt: string | null;
  shiftStartsAt: string;
  shiftEndedAt: string;
  detectedAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
}

const FAULTS = [
  {
    value: 'PRACTITIONER',
    label: 'The practitioner',
    consequence: 'Records a no-show. This is the only option that touches their reliability score.',
  },
  {
    value: 'FACILITY',
    label: 'The facility',
    consequence:
      'The ward was shut, nobody was told, the shift never really existed. Costs the practitioner nothing.',
  },
  {
    value: 'NEITHER',
    label: 'Neither',
    consequence:
      'A flood, a bereavement, something nobody could have prevented. A real finding, not a way of avoiding the question.',
  },
];

const MIN_REASON = 10;

/** What recording each finding does, for the confirmation: said as the code does it. */
const WHAT_FOLLOWS: Record<string, string> = {
  PRACTITIONER:
    'The shift is recorded as a no-show against them, and it counts in their reliability score. Nobody is sent a message about it: they learn of it only by finding the status in the app.',
  FACILITY:
    'The flag is closed as the facility’s fault. The shift is recorded as cancelled, with no mark on the practitioner.',
  NEITHER:
    'The flag is closed as nobody’s fault. The shift is recorded as cancelled, with no mark on the practitioner.',
};

/** A fact with its label, wrapping rather than cutting a name short. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function UnhonouredDetail({ record, onBack }: { record: Unhonoured; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [fault, setFault] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  const history = useQuery({
    queryKey: ['unhonoured-history', record.id],
    queryFn: async () => {
      const body = await api.get<{ entries?: AuditEntry[] }>(
        `/api/v1/audit?scopeType=PLATFORM&entityId=${record.id}&limit=25`,
      );
      return body.entries ?? [];
    },
    retry: false,
  });

  const open = record.status === 'AWAITING_DECISION';

  const decide = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/assignments/${record.assignmentId}/fault`, {
        fault,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Fault recorded');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['unhonoured-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['unhonoured-history', record.id] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
      onBack();
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title={record.practitionerName}
        description={`${record.facilityName} · shift ended ${formatAgo(record.shiftEndedAt)}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            All unhonoured shifts
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="min-w-0">
              <p className="font-medium">{record.practitionerName}</p>
              <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                {record.practitionerPhone}
              </p>
            </div>
            <StatusBadge status={record.status} />
          </CardContent>
        </Card>

        <Tabs defaultValue="shift">
          <TabsList>
            <TabsTrigger value="shift">The shift</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="shift" className="space-y-6 pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What the sweep found</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label="Facility">{record.facilityName}</Fact>
                  <Fact label="Shift started">{formatWhen(record.shiftStartsAt)}</Fact>
                  <Fact label="Shift ended">{formatWhen(record.shiftEndedAt)}</Fact>
                  <Fact label="Flagged">{formatAgo(record.detectedAt)}</Fact>
                </dl>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  The shift ended with no check-in and no check-out recorded against it. That is all
                  the platform knows — it cannot tell an absence from a failed network or a ward
                  that closed, which is why nothing here closes without a person.
                </p>
              </CardContent>
            </Card>

            {record.status === 'CLOSED' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">What was decided</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fact label="Fault">{record.fault ? humanise(record.fault) : '—'}</Fact>
                    <Fact label="Decided">
                      {record.decidedAt ? formatWhen(record.decidedAt) : '—'}
                    </Fact>
                  </dl>
                  {record.reason ? (
                    <div className="rounded-md bg-muted px-3 py-2">
                      <p className="text-sm font-medium text-muted-foreground">What was found</p>
                      <p className="mt-1">{record.reason}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <ExcusalRequests record={record} open={open} onDecided={onBack} />

            {open ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Whose fault was it?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <fieldset className="space-y-2">
                    <legend className="sr-only">Whose fault was it?</legend>
                    {FAULTS.map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'flex min-h-11 cursor-pointer gap-3 rounded-lg border p-4 transition-colors',
                          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
                          fault === option.value
                            ? 'border-primary bg-accent/50'
                            : 'hover:border-primary/40',
                        )}
                      >
                        <input
                          type="radio"
                          name="fault"
                          value={option.value}
                          checked={fault === option.value}
                          onChange={() => setFault(option.value)}
                          className="mt-1 size-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{option.label}</span>
                          <span className="mt-0.5 block text-base text-muted-foreground">
                            {option.consequence}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>

                  <Field
                    label="What you found"
                    required
                    hint={`Who you spoke to and what they said. At least ${MIN_REASON} characters.`}
                    error={
                      reason.trim().length > 0 && reason.trim().length < MIN_REASON
                        ? `${MIN_REASON - reason.trim().length} more character${MIN_REASON - reason.trim().length === 1 ? '' : 's'} needed.`
                        : undefined
                    }
                  >
                    <Textarea
                      rows={3}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>

                  <Button
                    disabled={!fault || reason.trim().length < MIN_REASON}
                    onClick={() => setConfirming(true)}
                  >
                    Review the decision
                  </Button>
                  {!fault ? (
                    <p className="text-sm text-muted-foreground">
                      Choose whose fault it was first.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this flag
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.isPending ? (
                  <ListSkeleton rows={2} label="Loading the history" />
                ) : history.isError ? (
                  <ErrorState
                    error={history.error}
                    onRetry={() => void history.refetch()}
                    retrying={history.isFetching}
                    compact
                  />
                ) : history.data.length === 0 ? (
                  <p className="text-base text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  <Timeline
                    label="History of this flag"
                    steps={history.data.map((entry) => ({
                      id: entry.id,
                      state: 'done' as const,
                      title: actionLabel(entry.action),
                      when: `${formatWhen(entry.createdAt)} · ${formatAgo(entry.createdAt)}`,
                      detail: entry.reason ?? undefined,
                    }))}
                  />
                )}

                {/* The sweep has no actor, and a name against a finding nobody
                    made would read as somebody having decided it. */}
                <p className="mt-4 border-t pt-3 text-sm leading-relaxed text-muted-foreground">
                  The flag itself was raised by the nightly sweep, which is not a person and so
                  carries no name.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Record whose fault it was"
        object={
          <>
            {record.practitionerName} · {record.facilityName}
            <span className="block font-normal text-muted-foreground">
              Shift {formatWhen(record.shiftStartsAt)} · finding:{' '}
              {fault ? FAULTS.find((option) => option.value === fault)?.label : ''}
            </span>
          </>
        }
        consequence={
          <>{fault ? WHAT_FOLLOWS[fault] : null} The flag closes and is not reopened from here.</>
        }
        reversible={false}
        destructive={fault === 'PRACTITIONER'}
        confirmLabel="Record the decision"
        cancelLabel="Not yet"
        loading={decide.isPending}
        onConfirm={() => decide.mutate()}
      >
        <figure className="rounded-md border bg-muted/40 px-3 py-2">
          <figcaption className="text-sm font-medium text-muted-foreground">
            What you found, as it will be kept
          </figcaption>
          <blockquote className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
            {reason.trim()}
          </blockquote>
        </figure>
      </ConfirmDialog>
    </>
  );
}

interface Excusal {
  id: string;
  reason: string;
  status: 'REQUESTED' | 'GRANTED' | 'REFUSED';
  decisionNotes: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/**
 * What the practitioner said, before anybody decides fault.
 *
 * The request was always recorded and always decidable over the API, but the
 * officer had no way to see it from here — so the flag got decided without
 * the one piece of evidence the practitioner had offered. Granting closes the
 * flag as nobody's fault, which is what the server does; refusing leaves it
 * open for the decision below and needs a reason, because the practitioner is
 * owed one.
 */
function ExcusalRequests({
  record,
  open,
  onDecided,
}: {
  record: Unhonoured;
  open: boolean;
  onDecided: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [deciding, setDeciding] = useState<{ id: string; decision: 'grant' | 'refuse' } | null>(
    null,
  );

  const excusals = useQuery({
    queryKey: ['excusals', record.assignmentId],
    queryFn: async () => {
      const body = await api.get<{ excusals?: Excusal[] }>(
        `/api/v1/assignments/${record.assignmentId}/excusals?scopeType=PLATFORM`,
      );
      return body.excusals ?? [];
    },
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: 'grant' | 'refuse' }) =>
      api.post(`/api/v1/excusals/${input.id}/decide`, {
        decision: input.decision,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (_data, input) => {
      toast.success(
        input.decision === 'grant' ? 'Excused — the flag is closed' : 'Request refused',
      );
      void queryClient.invalidateQueries({ queryKey: ['excusals', record.assignmentId] });
      void queryClient.invalidateQueries({ queryKey: ['unhonoured-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['unhonoured-history', record.id] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
      setNotes('');
      setDeciding(null);
      if (input.decision === 'grant') onDecided();
    },
    onError: (error) => toast.error('Could not decide it', { description: errorMessage(error) }),
  });

  if (excusals.isPending)
    return <ListSkeleton rows={1} label="Loading what the practitioner said" />;
  if (excusals.isError) {
    return (
      <ErrorState
        error={excusals.error}
        onRetry={() => void excusals.refetch()}
        retrying={excusals.isFetching}
        compact
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">What the practitioner said</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {excusals.data.length === 0 ? (
          <p className="text-base text-muted-foreground">
            They have not asked to be excused. They can, from their own shifts page, until this is
            decided.
          </p>
        ) : (
          excusals.data.map((excusal) => (
            <div key={excusal.id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Asked {formatAgo(excusal.createdAt)}
                </p>
                <StatusBadge status={excusal.status} />
              </div>
              <p className="text-base">{excusal.reason}</p>
              {excusal.decisionNotes ? (
                <p className="text-sm text-muted-foreground">Decision: {excusal.decisionNotes}</p>
              ) : null}

              {open && excusal.status === 'REQUESTED' ? (
                <div className="space-y-3 border-t pt-3">
                  <Field
                    label="Your note"
                    hint={`Required to refuse (at least ${MIN_REASON} characters); optional to excuse. The practitioner sees it as Medilink’s reply.`}
                    error={
                      notes.trim().length > 0 && notes.trim().length < MIN_REASON
                        ? 'Too short to refuse with. Say what you checked.'
                        : undefined
                    }
                  >
                    <Textarea
                      rows={2}
                      placeholder="What you checked, and what it showed."
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </Field>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="success"
                      onClick={() => setDeciding({ id: excusal.id, decision: 'grant' })}
                    >
                      Excuse them…
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={notes.trim().length < MIN_REASON}
                      onClick={() => setDeciding({ id: excusal.id, decision: 'refuse' })}
                    >
                      Refuse…
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </CardContent>

      <ConfirmDialog
        open={deciding !== null}
        onOpenChange={(next) => !next && setDeciding(null)}
        title={deciding?.decision === 'grant' ? 'Excuse the practitioner' : 'Refuse the request'}
        object={
          <>
            {record.practitionerName} · {record.facilityName}
            <span className="block font-normal text-muted-foreground">
              Shift {formatWhen(record.shiftStartsAt)}
            </span>
          </>
        }
        consequence={
          deciding?.decision === 'grant' ? (
            <>
              The flag closes as nobody’s fault and the shift is recorded as cancelled, with no mark
              on their record. Nobody is sent a message; they see your note, if you wrote one, on
              their shifts page.
            </>
          ) : (
            <>
              The request is refused and your note is shown to them as Medilink’s reply. It decides
              nothing about fault: the flag stays open for you to decide below.
            </>
          )
        }
        reversible={false}
        destructive={deciding?.decision === 'refuse'}
        confirmLabel={deciding?.decision === 'grant' ? 'Excuse them' : 'Refuse the request'}
        cancelLabel="Not yet"
        loading={decide.isPending}
        onConfirm={() => deciding && decide.mutate(deciding)}
      >
        {notes.trim() ? (
          <figure className="rounded-md border bg-muted/40 px-3 py-2">
            <figcaption className="text-sm font-medium text-muted-foreground">
              Your note, as they will read it
            </figcaption>
            <blockquote className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
              {notes.trim()}
            </blockquote>
          </figure>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
