'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, CircleCheck, Eye, FileSearch, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid } from '@/components/app/page-shell';
import { formatAgo } from '@/components/app/format';
import { isRecordChecked, usePractitionerSubmissions, type Submission } from './submissions';

const STATUSES = ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'STRUCK_OFF'] as const;

/**
 * What the practitioner sent, to be confirmed rather than retyped.
 *
 * A practitioner submits their NIN and licence number with a photograph of the
 * slip and the licence. The officer reads the photograph beside the number and
 * says what they see; the identity or registration is then recorded *from the
 * submission*, and the submission decided, in the same click. Before this they
 * went somewhere else to check, then typed the number into a second form —
 * the same fact entered twice, by a different person each time.
 *
 * What is confirmed is the officer's reading — whether the name matches, what
 * the licence shows. The number cannot differ from what was sent because it is
 * never re-entered. Nothing here decides anything on its own.
 */
export function EvidenceReview({
  userId,
  practitionerName,
  regulator,
}: {
  userId: string;
  practitionerName: string;
  /** The regulator for their profession, so the card says whose register this is. */
  regulator: string | null;
}) {
  const submissions = usePractitionerSubmissions(userId);

  if (submissions.isPending) return <Skeleton className="h-32 w-full" />;
  if (submissions.isError) return null; // the credentials tab already says so

  // Identity before registration: a licence belongs to somebody, and who that is
  // comes first. (They would otherwise list newest-first, which put the licence on top.)
  const waiting = submissions.data
    .filter((row) => isRecordChecked(row) && row.status === 'PENDING')
    .sort(
      (a, b) =>
        Number(b.verificationMethod === 'nimc_verification') -
        Number(a.verificationMethod === 'nimc_verification'),
    );
  const sent = submissions.data.filter(
    (row) => isRecordChecked(row) && row.status === 'MORE_INFO_REQUESTED',
  );

  if (waiting.length === 0 && sent.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Submitted by the practitioner</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Read the photograph beside the number, then confirm what you see. The number is taken from
          what they sent, so there is nothing to retype.
        </p>
      </div>

      {waiting.map((row) =>
        row.verificationMethod === 'nimc_verification' ? (
          <IdentityCard
            key={row.id}
            row={row}
            userId={userId}
            practitionerName={practitionerName}
          />
        ) : (
          <RegistrationCard key={row.id} row={row} userId={userId} regulator={regulator} />
        ),
      )}

      {sent.map((row) => (
        <Card key={row.id} className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.credentialTypeName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Waiting for the practitioner to reply to your request
                {row.reviewNotes ? `: “${row.reviewNotes}”` : '.'}
              </p>
            </div>
            <StatusBadge status="MORE_INFO_REQUESTED" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Everything that has to be asked again after a decision. */
function useRefresh(userId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['practitioner-credentials', userId] });
    void queryClient.invalidateQueries({ queryKey: ['verification', userId] });
    void queryClient.invalidateQueries({ queryKey: ['eligibility-of', userId] });
    void queryClient.invalidateQueries({ queryKey: ['practitioner-directory'] });
    void queryClient.invalidateQueries({ queryKey: ['credentials'] });
    void queryClient.invalidateQueries({ queryKey: ['tile'] });
  };
}

/**
 * The photograph, shown inline once asked for.
 *
 * Not loaded on arrival: opening an identity document is an access that is
 * recorded, and it should be recorded because somebody chose to look, not
 * because a page rendered.
 */
function Evidence({ row, title }: { row: Submission; title: string }) {
  const [asked, setAsked] = useState(false);

  const document = useQuery({
    queryKey: ['evidence-url', row.id],
    queryFn: () =>
      api.post<{ downloadUrl: string }>(`/api/v1/credentials/${row.id}/document-url`, {
        scopeType: 'PLATFORM',
      }),
    enabled: asked,
    retry: false,
    // Signed and short-lived: refetched rather than kept on screen until it
    // quietly stops working.
    staleTime: 4 * 60_000,
  });

  if (!row.documentObjectKey) {
    return (
      <Alert variant="warning">
        <TriangleAlert />
        <AlertDescription>
          No photograph was attached, so there is nothing to read the number against. Ask them to
          send one — do not confirm from the number alone.
        </AlertDescription>
      </Alert>
    );
  }

  if (!asked) {
    return (
      <Button type="button" variant="outline" onClick={() => setAsked(true)}>
        <Eye />
        Show the photograph
      </Button>
    );
  }

  if (document.isPending) return <Skeleton className="h-64 w-full" />;
  if (document.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertDescription>
          The photograph could not be opened. Try again in a moment.
        </AlertDescription>
      </Alert>
    );
  }

  const isPdf = new URL(document.data.downloadUrl).pathname.toLowerCase().endsWith('.pdf');

  return (
    <div className="space-y-2">
      {isPdf ? (
        <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
          This one is a PDF — it opens in a new tab.
        </p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={document.data.downloadUrl}
          alt={title}
          className="max-h-96 w-full rounded-md border bg-muted/40 object-contain"
        />
      )}
      <a
        href={document.data.downloadUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        Open full size
      </a>
    </div>
  );
}

/** Ask for a better copy, or turn it down — either needs the reason written down. */
function Alternatives({ row, userId, asked }: { row: Submission; userId: string; asked: string }) {
  const refresh = useRefresh(userId);
  const [note, setNote] = useState('');
  const reason = note.trim();

  const decide = useMutation({
    mutationFn: (decision: 'request_info' | 'reject') =>
      api.post(`/api/v1/credentials/${row.id}/review`, { decision, reviewNotes: reason }),
    onSuccess: (_result, decision) => {
      toast.success(decision === 'reject' ? 'Rejected' : 'More information requested');
      refresh();
    },
    onError: (error) => toast.error('Could not record that', { description: errorMessage(error) }),
  });

  return (
    <div className="space-y-2 border-t pt-4">
      <Label htmlFor={`reason-${row.id}`}>
        Cannot confirm it?{' '}
        <span className="font-normal text-muted-foreground">
          — say what is wrong; they see this note
        </span>
      </Label>
      <Textarea
        id={`reason-${row.id}`}
        rows={2}
        placeholder={asked}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!reason || decide.isPending}
          onClick={() => decide.mutate('request_info')}
        >
          Ask for a clearer copy
        </Button>
        <Button
          variant="destructive"
          disabled={!reason || decide.isPending}
          onClick={() => decide.mutate('reject')}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function IdentityCard({
  row,
  userId,
  practitionerName,
}: {
  row: Submission;
  userId: string;
  practitionerName: string;
}) {
  const reference = useReference();
  const automated = reference.data?.verification.identityAutomated ?? false;
  const refresh = useRefresh(userId);
  // No default: assuming a match would let a mismatched identity through
  // silently, which is the failure this step exists to catch.
  const [match, setMatch] = useState<'yes' | 'no' | ''>('');

  const confirm = useMutation({
    mutationFn: () =>
      api.post<{ outcome: string }>('/api/v1/practitioners/verification/confirm', {
        kind: 'identity',
        submissionId: row.id,
        nameMatch: automated ? undefined : match === 'yes',
      }),
    onSuccess: ({ outcome }) => {
      if (outcome === 'NAME_MISMATCH') {
        toast.warning('Recorded as a mismatch', {
          description: 'The practitioner has been asked to correct it.',
        });
      } else {
        toast.success('Identity confirmed', {
          description: 'Only the last four digits of the number are kept.',
        });
      }
      refresh();
    },
    onError: (error) => toast.error('Could not confirm it', { description: errorMessage(error) }),
  });

  const hasEvidence = Boolean(row.documentObjectKey) || automated;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
            Identity — {row.credentialTypeName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Submitted {formatAgo(row.createdAt)}
          </p>
        </div>
        <StatusBadge status="PENDING" />
      </CardHeader>

      {/* The photograph on the left, the number and the decision on the right, so
          they are read together; stacked on a phone, number first. */}
      <CardContent className="grid items-start gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="lg:col-start-2 lg:row-start-1">
          <DetailGrid>
            <Detail label="Number they sent">
              <span className="tabular tracking-wider">{row.referenceNumber ?? '—'}</span>
            </Detail>
            <Detail label="Name on the account">{practitionerName}</Detail>
          </DetailGrid>
        </div>

        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Evidence row={row} title="NIN slip" />
        </div>

        <div className="space-y-4 lg:col-start-2 lg:row-start-2">
          {automated ? (
            <p className="text-xs text-muted-foreground">
              The number is checked against NIMC when you confirm; there is no name to read.
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">The name on the slip</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['yes', 'Matches the account'],
                    ['no', 'Does not match'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={match === value}
                    onClick={() => setMatch(value)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm transition-colors',
                      match === value
                        ? value === 'yes'
                          ? 'border-success bg-success/10 font-medium text-success'
                          : 'border-warning bg-warning/10 font-medium text-warning'
                        : 'hover:bg-accent',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {match === 'no' ? (
                <p className="text-xs text-muted-foreground">
                  A mismatch is recorded as a fact and asks them to correct it. It is not a
                  rejection.
                </p>
              ) : null}
            </fieldset>
          )}

          <Button
            loading={confirm.isPending}
            disabled={!hasEvidence || (!automated && match === '')}
            onClick={() => confirm.mutate()}
          >
            <BadgeCheck />
            {match === 'no' ? 'Record the mismatch' : 'Confirm identity'}
          </Button>

          <Alternatives
            row={row}
            userId={userId}
            asked="e.g. The photograph is too dark to read the number."
          />
        </div>
      </CardContent>
    </Card>
  );
}

function RegistrationCard({
  row,
  userId,
  regulator,
}: {
  row: Submission;
  userId: string;
  regulator: string | null;
}) {
  const reference = useReference();
  const automated = reference.data?.verification.registrationAutomated ?? false;
  const refresh = useRefresh(userId);
  // No default status: assuming ACTIVE would be assuming the answer to the only
  // question being asked.
  const [status, setStatus] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const confirm = useMutation({
    mutationFn: () =>
      api.post<{ outcome: string }>('/api/v1/practitioners/verification/confirm', {
        kind: 'registration',
        submissionId: row.id,
        registrationStatus: automated ? undefined : status,
        expiresAt: expiresAt || undefined,
      }),
    onSuccess: ({ outcome }) => {
      if (outcome === 'NOT_ACTIVE') {
        toast.warning('Recorded, and rejected', {
          description: 'The licence is not active, so the practitioner has been told why.',
        });
      } else {
        toast.success('Registration confirmed');
      }
      refresh();
    },
    onError: (error) => toast.error('Could not confirm it', { description: errorMessage(error) }),
  });

  const hasEvidence = Boolean(row.documentObjectKey) || automated;
  const notActive = status !== '' && status !== 'ACTIVE';

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
            Registration — {row.credentialTypeName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Submitted {formatAgo(row.createdAt)}
          </p>
        </div>
        <StatusBadge status="PENDING" />
      </CardHeader>

      <CardContent className="grid items-start gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="lg:col-start-2 lg:row-start-1">
          <DetailGrid>
            <Detail label="Licence number they sent">
              <span className="font-mono">{row.referenceNumber ?? '—'}</span>
            </Detail>
            <Detail label="Recorded against">{regulator ?? 'Their profession’s regulator'}</Detail>
          </DetailGrid>
        </div>

        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Evidence row={row} title="Practising licence" />
        </div>

        <div className="space-y-4 lg:col-start-2 lg:row-start-2">
          {automated ? (
            <p className="text-xs text-muted-foreground">
              The register is checked when you confirm; its answer is recorded as it is.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>What the licence shows</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {humanise(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`expires-${row.id}`}>
                  Expiry date on the licence{' '}
                  <span className="font-normal text-muted-foreground">
                    — optional. It is also the date the practitioner sees as when this credential
                    expires.
                  </span>
                </Label>
                <Input
                  id={`expires-${row.id}`}
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
            </div>
          )}

          {notActive ? (
            <p className="text-xs text-muted-foreground">
              Recorded exactly as it shows — that is what the record should say — and the submission
              is rejected with the reason, so the practitioner is told why.
            </p>
          ) : null}

          <Button
            loading={confirm.isPending}
            disabled={!hasEvidence || (!automated && status === '')}
            onClick={() => confirm.mutate()}
          >
            {notActive ? <TriangleAlert /> : <CircleCheck />}
            {notActive
              ? `Record as ${humanise(status).toLowerCase()} and reject`
              : 'Confirm registration'}
          </Button>

          <Alternatives
            row={row}
            userId={userId}
            asked="e.g. The expiry date is cut off in the photograph."
          />
        </div>
      </CardContent>
    </Card>
  );
}
