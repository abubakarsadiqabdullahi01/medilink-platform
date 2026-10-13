'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { DocumentUpload, type UploadedDocument } from '@/components/app/document-upload';
import { StatusBadge } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';

/** The facility as /api/v1/facilities/:id returns it. */
interface FacilityRecord {
  id: string;
  name: string;
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
 * What compliance holds about this facility, and the way to correct it.
 *
 * There was no such page. The licence upload route existed and nothing called it,
 * a refused facility was told to "reply to Medilink with the corrected documents"
 * and had nowhere to, and an owner could not see what compliance held or fix a
 * wrong address. Everything here goes through routes that already existed.
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
  const [licence, setLicence] = useState<UploadedDocument | null>(null);

  // Filled from the record once it arrives, and again after a save.
  useEffect(() => {
    if (!record) return;
    setAddressLine(record.addressLine);
    setContactPhone(record.contactPhone);
    setContactEmail(record.contactEmail ?? '');
    setLicenceNumber(record.licenceNumber ?? '');
    setLicenceExpiresAt(dateOnly(record.licenceExpiresAt));
    setCacNumber(record.cacNumber);
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
    if (refused && cacNumber.trim() && cacNumber.trim().toUpperCase() !== record.cacNumber) {
      out.cacNumber = cacNumber.trim();
    }
    return out;
  }

  const pending = changes();
  const nothingToSave = Object.keys(pending).length === 0;
  // A verified facility that changes its licence goes back for review: say so
  // before the click, not after.
  const sendsBackForReview =
    record?.status === 'VERIFIED' &&
    ('licenceNumber' in pending || 'licenceExpiresAt' in pending || 'licenceObjectKey' in pending);

  const save = useMutation({
    mutationFn: (resubmit: boolean) =>
      api.patch(`/api/v1/facilities/${facilityId}`, { ...pending, ...(resubmit ? { resubmit: true } : {}) }),
    onSuccess: (_data, resubmit) => {
      toast.success(resubmit ? 'Sent back to compliance for review' : 'Saved');
      void queryClient.invalidateQueries({ queryKey: ['facility-profile', facilityId] });
      void queryClient.invalidateQueries({ queryKey: ['facility'] });
    },
    onError: (error) => toast.error('That did not save', { description: errorMessage(error) }),
  });

  const viewLicence = useMutation({
    mutationFn: () => api.post<{ downloadUrl: string }>(`/api/v1/facilities/${facilityId}/licence-url`, {}),
    onSuccess: ({ downloadUrl }) => window.open(downloadUrl, '_blank', 'noopener,noreferrer'),
    onError: (error) => toast.error('Could not open the licence', { description: errorMessage(error) }),
  });

  if (!facilityId || facility.isPending) {
    return (
      <>
        <PageHeader title="Facility profile" description="What Medilink holds about this facility." />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  if (facility.isError || !record) {
    return (
      <>
        <PageHeader title="Facility profile" description="What Medilink holds about this facility." />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>The facility could not be loaded.</AlertDescription>
        </Alert>
      </>
    );
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
          <AlertDescription>
            Waiting for verification. Medilink checks the CAC registration and licence before this
            facility can publish shifts.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>The name and type are changed through Medilink.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <p className="text-sm">{record.name}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cac">CAC registration number</Label>
              {refused && canEdit ? (
                <>
                  <Input id="cac" value={cacNumber} onChange={(event) => setCacNumber(event.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Correct it if it was mistyped. It cannot be changed once the facility is verified.
                  </p>
                </>
              ) : (
                <p className="font-mono text-sm">{record.cacNumber}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={addressLine}
                onChange={(event) => setAddressLine(event.target.value)}
                disabled={!canEdit}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Contact phone</Label>
                <Input
                  id="phone"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  inputMode="tel"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Contact email</Label>
                <Input
                  id="email"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Licence</CardTitle>
            <CardDescription>
              Compliance reads the licence beside the number before verifying the facility.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="licence-number">Licence number</Label>
                <Input
                  id="licence-number"
                  value={licenceNumber}
                  onChange={(event) => setLicenceNumber(event.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="licence-expiry">Expires</Label>
                <Input
                  id="licence-expiry"
                  type="date"
                  value={licenceExpiresAt}
                  onChange={(event) => setLicenceExpiresAt(event.target.value)}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Licence document</Label>
              {record.licenceObjectKey && !licence ? (
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <span>A licence document is on file.</span>
                  <Button
                    variant="outline"
                    size="sm"
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
                  label={record.licenceObjectKey ? 'Replace the licence document' : 'Attach the licence'}
                  hint="A clear photograph or PDF, up to 10 MB. The number and expiry date must be readable."
                />
              ) : null}
            </div>

            {sendsBackForReview ? (
              <Alert variant="warning">
                <AlertDescription>
                  Changing the licence of a verified facility sends it back to compliance, and it
                  cannot publish shifts until it is verified again.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {canEdit ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant={refused ? 'outline' : 'default'}
            disabled={nothingToSave}
            loading={save.isPending && !save.variables}
            onClick={() => save.mutate(false)}
          >
            Save changes
          </Button>
          {refused ? (
            <Button
              disabled={nothingToSave}
              loading={save.isPending && save.variables === true}
              onClick={() => save.mutate(true)}
            >
              Save and send for review
            </Button>
          ) : null}
          {refused && nothingToSave ? (
            <p className="text-xs text-muted-foreground">
              Change something first — sent back as it is, it would be refused for the same reason.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
