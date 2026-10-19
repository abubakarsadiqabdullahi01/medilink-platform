'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, History } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { registrationOption } from '@/lib/ui/registration';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, PageHeader } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { DocumentDialog } from '@/components/app/document-dialog';
import { StaffManager } from '@/components/app/staff-manager';
import { FACILITY_STAFF_ROLES } from '@/lib/ui/staff-roles';
import { actionLabel, formatAgo, formatDate, formatWhen } from '@/components/app/format';

/**
 * One facility, everything about it, and what has happened to it.
 *
 * The queue card carried enough to verify from and nothing to judge with: no
 * licence to open, no history, and no way to see a facility that was already
 * verified without changing the filter. Deciding whether an organisation may
 * put people on a ward deserves more than a name and an address.
 *
 * History comes from the audit trail filtered to this record — `entityId` has
 * always been a supported filter and nothing called it. It is the same trail
 * the audit page shows, narrowed to one subject, which is the question an
 * officer actually has: what has happened to *this* hospital.
 */

export interface Facility {
  id: string;
  name: string;
  registrationKind?: string;
  cacNumber: string;
  verificationChecks?: {
    licenceDocumentSeen: boolean;
    licenceMatchesFacility: boolean;
    registrationChecked: boolean;
    checkedWith: string;
  } | null;
  facilityTypeId: string;
  stateId: string;
  lgaId: string | null;
  addressLine: string;
  contactPhone: string;
  contactEmail: string | null;
  status: string;
  licenceNumber: string | null;
  licenceObjectKey: string | null;
  licenceExpiresAt: string | null;
  verifiedAt: string | null;
  reviewNotes: string | null;
  canPublish: boolean;
  publishBlockers: string[];
  createdAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

export function FacilityDetail({ facility, onBack }: { facility: Facility; onBack: () => void }) {
  const queryClient = useQueryClient();
  const reference = useReference();
  const [note, setNote] = useState('');
  // What the officer confirms before approving (UXO-02).
  const [seen, setSeen] = useState(false);
  const [matches, setMatches] = useState(false);
  const [registrationChecked, setRegistrationChecked] = useState(false);
  const [checkedWith, setCheckedWith] = useState('');
  /** The decision waiting for a yes: a verification is final, a refusal sends the facility back. */
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);

  const fresh = useQuery({
    queryKey: ['facility-detail', facility.id],
    queryFn: () => api.get<Facility>(`/api/v1/facilities/${facility.id}?scopeType=PLATFORM`),
    initialData: facility,
    retry: false,
  });

  const history = useQuery({
    queryKey: ['facility-history', facility.id],
    queryFn: async () => {
      const body = await api.get<{ entries?: AuditEntry[] }>(
        `/api/v1/audit?scopeType=PLATFORM&entityId=${facility.id}&limit=25`,
      );
      return body.entries ?? [];
    },
    retry: false,
  });

  const row = fresh.data ?? facility;
  const pending = row.status === 'PENDING';

  /**
   * The API's word is `approve`; the button says Verify because that is what
   * the step is called everywhere else in this product. The translation
   * belongs here rather than in either of them.
   */
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post(`/api/v1/facilities/${facility.id}/verify`, {
        decision,
        reviewNotes: note.trim() || undefined,
        ...(decision === 'approve'
          ? {
              checks: {
                licenceDocumentSeen: seen,
                licenceMatchesFacility: matches,
                registrationChecked,
                checkedWith: checkedWith.trim(),
              },
            }
          : {}),
      }),
    onSuccess: (_result, decision) => {
      toast.success(decision === 'approve' ? 'Facility verified' : 'Facility rejected');
      setDeciding(null);
      setNote('');
      setSeen(false);
      setMatches(false);
      setRegistrationChecked(false);
      setCheckedWith('');
      void queryClient.invalidateQueries({ queryKey: ['facility-detail', facility.id] });
      void queryClient.invalidateQueries({ queryKey: ['facility-history', facility.id] });
      void queryClient.invalidateQueries({ queryKey: ['facility-directory'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
    onError: (error) => toast.error('Could not record that', { description: errorMessage(error) }),
  });

  // Why Verify is held, in words beside the button: a disabled button that does not say why is a
  // dead end for the person whose job is to clear it.
  const verifyBlockers = [
    !row.licenceObjectKey ? 'a licence document uploaded by the facility' : null,
    !row.licenceNumber ? 'a licence number' : null,
    !seen || !matches || !registrationChecked ? 'all three checks ticked' : null,
    checkedWith.trim().length < 10 ? 'how you checked it (at least 10 characters)' : null,
  ].filter(Boolean);

  const stateName =
    (reference.data?.states ?? []).find((entry) => entry.id === row.stateId)?.name ?? null;
  const lgaName =
    (reference.data?.lgas ?? []).find((entry) => entry.id === row.lgaId)?.name ?? null;
  const typeName =
    (reference.data?.facilityTypes ?? []).find((entry) => entry.id === row.facilityTypeId)?.name ??
    null;

  return (
    <>
      <PageHeader
        title={row.name}
        description={`${registrationOption(row.registrationKind).referenceLabel} ${row.cacNumber} · onboarded ${formatAgo(row.createdAt)}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            All facilities
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {typeName ?? 'Facility'}
                {stateName ? ` · ${stateName}` : ''}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{row.addressLine}</p>
            </div>
            <div className="flex items-center gap-3">
              {row.canPublish ? (
                <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                  Can publish shifts
                </span>
              ) : (
                <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                  Cannot publish
                </span>
              )}
              <StatusBadge status={row.status} />
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-6 pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">The organisation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailGrid>
                  <Detail label="Registered as">
                    {registrationOption(row.registrationKind).label}
                  </Detail>
                  <Detail label={registrationOption(row.registrationKind).referenceLabel}>
                    {row.cacNumber}
                  </Detail>
                  <Detail label="Type">{typeName ?? '—'}</Detail>
                  <Detail label="State">{stateName ?? '—'}</Detail>
                  <Detail label="Local government">{lgaName ?? '—'}</Detail>
                  <Detail label="Telephone">{row.contactPhone}</Detail>
                  <Detail label="Email">{row.contactEmail ?? '—'}</Detail>
                  <Detail label="Onboarded">{formatDate(row.createdAt)}</Detail>
                  <Detail label="Verified">
                    {row.verifiedAt ? formatDate(row.verifiedAt) : 'Not yet'}
                  </Detail>
                </DetailGrid>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Licence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailGrid>
                  <Detail label="Number">{row.licenceNumber ?? 'Not given'}</Detail>
                  <Detail label="Expires">
                    {row.licenceExpiresAt ? formatDate(row.licenceExpiresAt) : '—'}
                  </Detail>
                  <Detail label="Document">
                    {row.licenceObjectKey ? 'Attached' : 'None attached'}
                  </Detail>
                </DetailGrid>

                {row.licenceObjectKey ? (
                  <DocumentDialog
                    title={`${row.name} — licence`}
                    description={row.licenceNumber ?? undefined}
                    fetchUrl={() =>
                      api.post<{ url: string }>(`/api/v1/facilities/${row.id}/licence-url`, {})
                    }
                  />
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    No licence document was uploaded, and a facility cannot be verified without one:
                    a check that happened somewhere this record cannot show is not a check.
                  </p>
                )}

                {!row.canPublish && row.publishBlockers.length > 0 ? (
                  <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-warning">
                      Why it cannot publish
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {row.publishBlockers.map((blocker) => (
                        <li key={blocker} className="text-sm">
                          · {humanise(blocker)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {row.reviewNotes ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Last decision note</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{row.reviewNotes}</p>
                </CardContent>
              </Card>
            ) : null}

            {row.verificationChecks ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">What was checked before it was verified</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>· The licence document was opened and read</p>
                  <p>· It matches this facility</p>
                  <p>· The registration was checked with whoever issued it</p>
                  <p className="pt-2 text-muted-foreground">
                    How: {row.verificationChecks.checkedWith}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {pending ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Decide</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <fieldset className="space-y-3 rounded-md border p-3">
                    <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Before you verify
                    </legend>
                    {[
                      ['I opened the licence document and it is legible', seen, setSeen],
                      ["The name and address on it are this facility's", matches, setMatches],
                      [
                        'I checked the registration reference with whoever issued it',
                        registrationChecked,
                        setRegistrationChecked,
                      ],
                    ].map(([label, value, set]) => (
                      <label key={label as string} className="flex items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={value as boolean}
                          onChange={(event) =>
                            (set as (next: boolean) => void)(event.target.checked)
                          }
                          className="mt-0.5 size-6 shrink-0 rounded border-input accent-primary"
                        />
                        <span>{label as string}</span>
                      </label>
                    ))}
                    <div className="space-y-1.5">
                      <Label htmlFor="facility-checked-with">How did you check it?</Label>
                      <Textarea
                        id="facility-checked-with"
                        rows={2}
                        placeholder="Who you asked, or what you looked at."
                        value={checkedWith}
                        onChange={(event) => setCheckedWith(event.target.value)}
                      />
                    </div>
                  </fieldset>

                  <div className="space-y-2">
                    <Label htmlFor="facility-note">
                      Reason{' '}
                      <span className="font-normal text-muted-foreground">
                        — required to reject
                      </span>
                    </Label>
                    <Textarea
                      id="facility-note"
                      rows={2}
                      placeholder="What could not be confirmed."
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </div>

                  {verifyBlockers.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      To verify, this still needs {verifyBlockers.join(', ')}. To reject, a reason
                      is enough.
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="success"
                      disabled={
                        !row.licenceObjectKey ||
                        !row.licenceNumber ||
                        !seen ||
                        !matches ||
                        !registrationChecked ||
                        checkedWith.trim().length < 10 ||
                        decide.isPending
                      }
                      onClick={() => setDeciding('approve')}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!note.trim() || decide.isPending}
                      onClick={() => setDeciding('reject')}
                    >
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          {/* Medilink's view of who can act for the facility. Mounted only when opened, because
              reading the list asks for a password: nobody should meet that prompt for a tab
              they did not open. This is where an owner who is the problem is dealt with. */}
          <TabsContent value="staff" className="space-y-4 pt-5">
            <p className="text-sm text-muted-foreground">
              Who can act for this facility. Medilink may remove a facility&apos;s last owner, which
              its own people may not, and every change is recorded with who made it and why.
            </p>
            <StaffManager
              scopeType="FACILITY"
              scopeId={facility.id}
              roles={FACILITY_STAFF_ROLES}
              signupPath="/register?as=staff"
            />
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this facility
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.isPending ? (
                  <Skeleton className="h-32 w-full" />
                ) : history.isError ? (
                  <ErrorState
                    error={history.error}
                    onRetry={() => void history.refetch()}
                    retrying={history.isFetching}
                    compact
                  />
                ) : history.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing recorded against this facility yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {history.data.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-border pl-4">
                        <p className="text-sm font-medium">{actionLabel(entry.action)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatWhen(entry.createdAt)} · {formatAgo(entry.createdAt)}
                        </p>
                        {entry.reason ? <p className="mt-1 text-sm">{entry.reason}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}

                <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                  What happened to this record, not who has been busy. The trail cannot be filtered
                  by person, which is the design rather than a gap.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={deciding !== null}
        onOpenChange={(next) => !next && setDeciding(null)}
        title={deciding === 'reject' ? 'Reject this facility' : 'Verify this facility'}
        object={`${row.name} · ${registrationOption(row.registrationKind).referenceLabel} ${row.cacNumber}`}
        consequence={
          deciding === 'reject' ? (
            <>
              The facility cannot publish shifts. It is shown your reason — “{note.trim()}” — and
              can correct its details and send them again.
            </>
          ) : (
            <>
              The facility can publish shifts, and practitioners can be matched to them. What you
              confirmed above is kept with the decision.
            </>
          )
        }
        reversible={
          deciding === 'reject' ? 'It returns to this queue when the facility resubmits.' : false
        }
        destructive={deciding === 'reject'}
        confirmLabel={deciding === 'reject' ? 'Reject facility' : 'Verify facility'}
        loading={decide.isPending}
        onConfirm={() => deciding && decide.mutate(deciding)}
      />
    </>
  );
}
