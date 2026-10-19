'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Clock, ExternalLink, Octagon, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';
import { daysUntilExpiry, expiryPhrase, expiryTone } from '@/lib/ui/credential-timing';
import { useFacilityId } from '@/lib/ui/facility';
import { isNigerianPhone } from '@/lib/phone';
import { useSession } from '@/lib/ui/session';
import { cn } from '@/lib/utils';
import {
  normaliseRegistrationReference,
  registrationReferenceProblem,
} from '@/modules/facilities/domain/facility';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  REGISTRATION_KIND_OPTIONS,
  registrationOption,
  type RegistrationKind,
} from '@/lib/ui/registration';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DocumentUpload, type UploadedDocument } from '@/components/app/document-upload';
import { Field } from '@/components/app/field';
import { formatDate } from '@/components/app/format';
import { StatusBadge } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { ErrorState, LoadingStatus } from '@/components/app/states';

/** The facility as /api/v1/facilities/:id returns it. */
interface FacilityRecord {
  id: string;
  name: string;
  registrationKind: RegistrationKind;
  cacNumber: string;
  addressLine: string;
  contactPhone: string;
  contactEmail: string | null;
  licenceNumber: string | null;
  licenceObjectKey: string | null;
  licenceExpiresAt: string | null;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';
  reviewNotes: string | null;
  canPublish: boolean;
}

/** "2027-03-31T00:00:00.000Z" as "2027-03-31", which is what a date input holds. */
function dateOnly(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

/**
 * "31 Mar 2027 · in 163 days", warning inside a month. A lapsed licence says what that costs,
 * in the words the registration form already uses: a facility whose licence has lapsed cannot
 * publish shifts.
 */
function LicenceExpiry({ day }: { day: string }) {
  const days = daysUntilExpiry({ documentExpiresOn: day });
  if (days === null) return null;
  const tone = expiryTone(days);
  return (
    <span
      className={cn(
        'flex items-start gap-1.5',
        tone === 'danger' && 'font-medium text-destructive-text',
        tone === 'warning' && 'font-medium text-warning',
      )}
    >
      {tone ? (
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      )}
      <span>
        {formatDate(day)} · {expiryPhrase(days)}
        {days < 0 ? '. A facility whose licence has lapsed cannot publish shifts.' : ''}
      </span>
    </span>
  );
}

/**
 * What compliance holds about this facility, and the way to correct it.
 *
 * There was no such page. The licence upload route existed and nothing called it,
 * a refused facility was told to "reply to Medilink with the corrected documents"
 * and had nowhere to, and an owner could not see what compliance held or fix a
 * wrong address. Everything here goes through routes that already existed.
 *
 * **Two saves change what compliance has to do again, and both ask first.** Changing the licence
 * of a verified facility puts it back to pending, and "Save and send for review" on a refused one
 * puts it in front of a reviewer as it stands. The page says which it is about to do, and what
 * the facility can and cannot do after.
 */
export default function FacilityProfilePage() {
  const facilityId = useFacilityId();
  const session = useSession();
  const canEdit = session.permissions.includes('facility.write');
  const queryClient = useQueryClient();

  const facility = useQuery({
    queryKey: ['facility-profile', facilityId],
    queryFn: () => api.get<FacilityRecord>(`/api/v1/facilities/${facilityId}`),
    enabled: Boolean(facilityId),
  });

  const record = facility.data;
  const refused = record?.status === 'REJECTED';

  const [addressLine, setAddressLine] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceExpiresAt, setLicenceExpiresAt] = useState('');
  const [cacNumber, setCacNumber] = useState('');
  const [registrationKind, setRegistrationKind] = useState<RegistrationKind>('CAC');
  const [licence, setLicence] = useState<UploadedDocument | null>(null);
  const [confirming, setConfirming] = useState<'licence' | 'resubmit' | null>(null);

  // Filled from the record once it arrives, and again after a save.
  useEffect(() => {
    if (!record) return;
    setAddressLine(record.addressLine);
    setContactPhone(record.contactPhone);
    setContactEmail(record.contactEmail ?? '');
    setLicenceNumber(record.licenceNumber ?? '');
    setLicenceExpiresAt(dateOnly(record.licenceExpiresAt));
    setCacNumber(record.cacNumber);
    setRegistrationKind(record.registrationKind);
    setLicence(null);
  }, [record]);

  /** Only what differs from what is held, so a save says exactly what it changed. */
  function changes(): Record<string, unknown> {
    if (!record) return {};
    const out: Record<string, unknown> = {};
    if (addressLine.trim() !== record.addressLine) out.addressLine = addressLine.trim();
    if (contactPhone.trim() !== record.contactPhone) out.contactPhone = contactPhone.trim();
    if (contactEmail.trim() !== (record.contactEmail ?? '') && contactEmail.trim()) {
      out.contactEmail = contactEmail.trim();
    }
    if (licenceNumber.trim() !== (record.licenceNumber ?? '') && licenceNumber.trim()) {
      out.licenceNumber = licenceNumber.trim();
    }
    if (licenceExpiresAt && licenceExpiresAt !== dateOnly(record.licenceExpiresAt)) {
      out.licenceExpiresAt = licenceExpiresAt;
    }
    if (licence) out.licenceObjectKey = licence.objectKey;
    if (refused && registrationKind !== record.registrationKind) {
      out.registrationKind = registrationKind;
    }
    if (refused && cacNumber.trim() && cacNumber.trim().toUpperCase() !== record.cacNumber) {
      out.cacNumber = cacNumber.trim();
    }
    return out;
  }

  const pending = changes();
  const nothingToSave = Object.keys(pending).length === 0;

  // The same rules the server applies, said under the field instead of in a refusal. Only for what
  // has been changed: a value already on file is not the person's mistake to fix.
  const problems: Record<string, string | undefined> = {
    address:
      'addressLine' in pending && addressLine.trim().length < 5
        ? 'Enter the street, area and city.'
        : undefined,
    phone:
      'contactPhone' in pending && !isNigerianPhone(contactPhone)
        ? 'Enter a Nigerian mobile number, for example 0803 123 4567.'
        : undefined,
    email:
      'contactEmail' in pending && !/^\S+@\S+\.\S+$/.test(contactEmail.trim())
        ? 'Enter a valid email address.'
        : undefined,
    cac:
      'cacNumber' in pending || 'registrationKind' in pending
        ? (registrationReferenceProblem(
            registrationKind,
            normaliseRegistrationReference(registrationKind, cacNumber),
          ) ?? undefined)
        : undefined,
  };
  const hasProblem = Object.values(problems).some(Boolean);

  // A verified facility that changes its licence goes back for review: say so
  // before the click, not after.
  const sendsBackForReview =
    record?.status === 'VERIFIED' &&
    ('licenceNumber' in pending || 'licenceExpiresAt' in pending || 'licenceObjectKey' in pending);

  const save = useMutation({
    mutationFn: (resubmit: boolean) =>
      api.patch(`/api/v1/facilities/${facilityId}`, {
        ...pending,
        ...(resubmit ? { resubmit: true } : {}),
      }),
    onSuccess: (_data, resubmit) => {
      setConfirming(null);
      toast.success(resubmit ? 'Sent back to compliance for review' : 'Saved');
      void queryClient.invalidateQueries({ queryKey: ['facility-profile', facilityId] });
      void queryClient.invalidateQueries({ queryKey: ['facility'] });
    },
  });

  const viewLicence = useMutation({
    mutationFn: () =>
      api.post<{ downloadUrl: string }>(`/api/v1/facilities/${facilityId}/licence-url`, {}),
    onSuccess: ({ downloadUrl }) => window.open(downloadUrl, '_blank', 'noopener,noreferrer'),
    onError: (error) =>
      toast.error('Could not open the licence', { description: errorMessage(error) }),
  });

  if (!facilityId || facility.isPending) {
    return (
      <>
        <PageHeader
          title="Facility profile"
          description="What Medilink holds about this facility."
        />
        <LoadingStatus label="Loading the facility" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  if (facility.isError || !record) {
    return (
      <>
        <PageHeader
          title="Facility profile"
          description="What Medilink holds about this facility."
        />
        <ErrorState
          error={facility.error}
          onRetry={() => void facility.refetch()}
          retrying={facility.isFetching}
        />
      </>
    );
  }

  const referenceLabel = registrationOption(registrationKind).referenceLabel;
  const changedLabels = [
    'licenceNumber' in pending ? 'licence number' : null,
    'licenceExpiresAt' in pending ? 'licence expiry date' : null,
    'licenceObjectKey' in pending ? 'licence document' : null,
  ].filter(Boolean);

  // Why the save buttons are off, beside them, so a disabled button is never a mystery.
  const saveNote = nothingToSave
    ? refused
      ? 'Change something first — sent back as it is, it would be refused for the same reason.'
      : 'Nothing has changed yet.'
    : hasProblem
      ? 'Correct the fields marked above to save.'
      : null;

  function trySave(resubmit: boolean) {
    save.reset();
    if (resubmit) setConfirming('resubmit');
    else if (sendsBackForReview) setConfirming('licence');
    else save.mutate(false);
  }

  return (
    <>
      <PageHeader
        title="Facility profile"
        description="What Medilink holds about this facility, and the way to correct it."
        action={<StatusBadge status={record.status} />}
      />

      {refused ? (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert />
          <AlertDescription className="space-y-1">
            <p>
              <strong>Medilink could not verify this facility.</strong>
            </p>
            {record.reviewNotes ? <p>What compliance said: {record.reviewNotes}</p> : null}
            <p>
              Correct what was wrong below, then choose <strong>Save and send for review</strong>.
              It goes back to compliance as it is now.
            </p>
          </AlertDescription>
        </Alert>
      ) : record.status === 'PENDING' ? (
        <Alert variant="warning" className="mb-6">
          <Clock />
          <AlertDescription>
            <strong>Waiting for verification.</strong> Medilink checks the registration and licence
            before this facility can publish shifts.
          </AlertDescription>
        </Alert>
      ) : record.status === 'SUSPENDED' ? (
        <Alert variant="destructive" className="mb-6">
          <Octagon />
          <AlertDescription>
            <strong>This facility is suspended</strong> and cannot publish shifts.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
            <CardDescription>The name and type are changed through Medilink.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Name</dt>
                <dd className="text-base">{record.name}</dd>
              </div>
              {!(refused && canEdit) ? (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{referenceLabel}</dt>
                  <dd className="font-mono text-base">{record.cacNumber}</dd>
                </div>
              ) : null}
            </dl>

            {refused && canEdit ? (
              <>
                <Field label="What the facility is registered as">
                  {(a11y) => (
                    <Select
                      value={registrationKind}
                      onValueChange={(value) => setRegistrationKind(value as RegistrationKind)}
                    >
                      <SelectTrigger
                        {...a11y}
                        className="h-auto min-h-11 whitespace-normal py-2 text-left [&>span]:line-clamp-none"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REGISTRATION_KIND_OPTIONS.map((row) => (
                          <SelectItem key={row.value} value={row.value}>
                            {row.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field
                  label={referenceLabel}
                  hint="Correct it if it was mistyped or filed under the wrong kind. It cannot be changed once the facility is verified."
                  error={problems.cac}
                >
                  <Input
                    value={cacNumber}
                    onChange={(event) => setCacNumber(event.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </>
            ) : null}

            <Field label="Address" error={problems.address}>
              <Input
                value={addressLine}
                onChange={(event) => setAddressLine(event.target.value)}
                disabled={!canEdit}
                autoComplete="street-address"
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Contact phone" error={problems.phone}>
                <Input
                  type="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  inputMode="tel"
                  disabled={!canEdit}
                  autoComplete="tel"
                />
              </Field>
              <Field label="Contact email" error={problems.email}>
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={!canEdit}
                  autoComplete="email"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Licence</CardTitle>
            <CardDescription>
              Compliance reads the licence beside the number before verifying the facility.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Licence number">
                <Input
                  value={licenceNumber}
                  onChange={(event) => setLicenceNumber(event.target.value)}
                  disabled={!canEdit}
                  autoComplete="off"
                />
              </Field>
              <Field label="Expires">
                <Input
                  type="date"
                  value={licenceExpiresAt}
                  onChange={(event) => setLicenceExpiresAt(event.target.value)}
                  disabled={!canEdit}
                />
              </Field>
            </div>

            <p role="status" className="-mt-2 text-sm">
              {licenceExpiresAt ? (
                <LicenceExpiry day={licenceExpiresAt} />
              ) : (
                <span className="text-muted-foreground">No expiry date on file.</span>
              )}
            </p>

            <div className="space-y-2">
              <p id="licence-document-label" className="text-base font-medium leading-snug">
                Licence document
              </p>
              {record.licenceObjectKey && !licence ? (
                <div className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-base">A licence document is on file.</span>
                  <Button
                    variant="outline"
                    loading={viewLicence.isPending}
                    onClick={() => viewLicence.mutate()}
                  >
                    <ExternalLink />
                    View
                  </Button>
                </div>
              ) : null}
              {canEdit ? (
                <DocumentUpload
                  endpoint={`/api/v1/facilities/${facilityId}/licence-upload-url`}
                  value={licence}
                  onUploaded={setLicence}
                  labelledBy="licence-document-label"
                  label={
                    record.licenceObjectKey ? 'Replace the licence document' : 'Attach the licence'
                  }
                  hint="A clear photograph or PDF, up to 10 MB. The number and expiry date must be readable."
                />
              ) : null}
            </div>

            {sendsBackForReview ? (
              <Alert variant="warning">
                <AlertDescription>
                  Changing the licence of a verified facility sends it back to compliance, and it
                  cannot publish shifts until it is verified again. You will be asked to confirm.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {canEdit ? (
        <div className="mt-6 space-y-3">
          {save.isError && confirming === null ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>
                <strong>That did not save.</strong> {errorMessage(save.error)} What you changed is
                still here: fix it and try again.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              variant={refused ? 'outline' : 'default'}
              disabled={nothingToSave || hasProblem}
              aria-describedby={saveNote ? 'facility-save-note' : undefined}
              loading={save.isPending && confirming === null}
              onClick={() => trySave(false)}
              className="w-full sm:w-auto"
            >
              Save changes
            </Button>
            {refused ? (
              <Button
                disabled={nothingToSave || hasProblem}
                aria-describedby={saveNote ? 'facility-save-note' : undefined}
                onClick={() => trySave(true)}
                className="w-full sm:w-auto"
              >
                Save and send for review
              </Button>
            ) : null}
          </div>
          {saveNote ? (
            <p id="facility-save-note" className="text-sm text-muted-foreground">
              {saveNote}
            </p>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming === 'licence'}
        onOpenChange={(next) => !next && setConfirming(null)}
        title="Send this facility back for verification?"
        object={`${record.name} · changing the ${changedLabels.join(', ')}`}
        consequence="The facility goes back to Pending. It cannot publish shifts until compliance has verified it again."
        reversible={{
          tone: 'final',
          label: 'You cannot take this back.',
          detail: 'Only compliance can verify the facility again.',
        }}
        confirmLabel="Save and send back"
        cancelLabel="Keep it verified"
        destructive
        loading={save.isPending}
        error={
          save.isError
            ? `That did not save. ${errorMessage(save.error)} What you changed is still here.`
            : null
        }
        onConfirm={() => save.mutate(false)}
      />

      <ConfirmDialog
        open={confirming === 'resubmit'}
        onOpenChange={(next) => !next && setConfirming(null)}
        title="Send this to compliance again?"
        object={`${record.name} · refused, corrected, sent for review`}
        consequence="It goes back to compliance as it is now, and the note they gave is cleared. They review what is on file when they get to it."
        reversible={{
          tone: 'open',
          label: 'You cannot withdraw it once it is sent.',
          detail:
            'You can keep editing while it waits; compliance reviews what is on file when they get to it.',
        }}
        confirmLabel="Send for review"
        cancelLabel="Keep editing"
        loading={save.isPending}
        error={
          save.isError
            ? `That did not send. ${errorMessage(save.error)} What you changed is still here.`
            : null
        }
        onConfirm={() => save.mutate(true)}
      />
    </>
  );
}
