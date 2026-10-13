'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Combobox } from '@/components/app/combobox';
import { PageHeader } from '@/components/app/page-shell';
import {
  REGISTRATION_KIND_OPTIONS,
  registrationOption,
  type RegistrationKind,
} from '@/lib/ui/registration';

/**
 * A hospital signing itself up.
 *
 * The form says plainly what happens next, because the thing people want to
 * know is when they can start using it — and the honest answer is "after
 * somebody has checked your registration", not "immediately".
 */
export default function RegisterFacilityPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const reference = useReference();

  const [name, setName] = useState('');
  const [facilityTypeId, setFacilityTypeId] = useState('');
  const [registrationKind, setRegistrationKind] = useState<RegistrationKind>('CAC');
  const [cacNumber, setCacNumber] = useState('');
  const registration = registrationOption(registrationKind);
  const [stateId, setStateId] = useState('');
  const [lgaId, setLgaId] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');

  const lgas = (reference.data?.lgas ?? []).filter((row) => row.stateId === stateId);

  const register = useMutation({
    mutationFn: () =>
      api.post('/api/v1/facilities/register', {
        name: name.trim(),
        facilityTypeId,
        registrationKind,
        cacNumber: cacNumber.trim(),
        stateId,
        lgaId: lgaId || undefined,
        addressLine: addressLine.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim() || undefined,
        licenceNumber: licenceNumber.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Registered', {
        description: 'Compliance will verify it before you can publish shifts.',
      });
      // The session's grants have just changed — this account went from
      // holding none to holding facility_owner. The session query has a
      // minute of staleTime for the ordinary case of nothing having changed
      // under it; this is the one moment on this page where something just
      // did, and the dashboard would otherwise still say "not attached" for
      // however much of that minute was left.
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      router.push('/facility');
      router.refresh();
    },
    onError: (error) => toast.error('Could not register it', { description: errorMessage(error) }),
  });

  const ready =
    name.trim().length >= 3 &&
    facilityTypeId &&
    cacNumber.trim().length >= 3 &&
    stateId &&
    addressLine.trim().length >= 5 &&
    contactPhone.trim().length >= 7;

  return (
    <>
      <PageHeader
        title="Register your facility"
        description="Tell us who you are and where. A compliance officer checks the details against your registration before the facility can publish anything."
      />

      <Alert variant="info" className="mb-6">
        <ShieldCheck />
        <AlertDescription>
          <strong>Nothing goes live immediately.</strong> Your facility is created pending
          verification: you can set it up and add colleagues straight away, and it cannot offer a
          shift to anybody until compliance has confirmed it is real.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Your details</CardTitle>
          <CardDescription>
            These have to match your registration, because that is what is checked against.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Facility name</Label>
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="As it appears on your registration certificate"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={facilityTypeId} onValueChange={setFacilityTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {(reference.data?.facilityTypes ?? []).map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="registration-kind">What is the facility registered as?</Label>
              <Select
                value={registrationKind}
                onValueChange={(value) => setRegistrationKind(value as RegistrationKind)}
              >
                <SelectTrigger id="registration-kind">
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cac">{registration.referenceLabel}</Label>
              <Input
                id="cac"
                value={cacNumber}
                onChange={(event) => setCacNumber(event.target.value)}
                placeholder={registration.placeholder}
              />
              <p className="text-xs text-muted-foreground">{registration.help}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Combobox
                id="state"
                options={(reference.data?.states ?? []).map((row) => ({
                  value: row.id,
                  label: row.name,
                  hint: row.zone,
                }))}
                value={stateId}
                onChange={(value) => {
                  setStateId(value);
                  setLgaId('');
                }}
                searchPlaceholder="Search 37 states…"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lga">Local government area</Label>
              <Combobox
                id="lga"
                options={lgas.map((row) => ({ value: row.id, label: row.name }))}
                value={lgaId}
                onChange={setLgaId}
                disabled={lgas.length === 0}
                placeholder={lgas.length === 0 ? 'Choose a state first' : 'Optional'}
                searchPlaceholder={`Search ${lgas.length} areas…`}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={addressLine}
                onChange={(event) => setAddressLine(event.target.value)}
                placeholder="Street, area, city"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Telephone</Label>
              <Input
                id="phone"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder="+234 803 000 0000"
                inputMode="tel"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="licence">
                Operating licence number{' '}
                <span className="font-normal text-muted-foreground">— optional for now</span>
              </Label>
              <Input
                id="licence"
                value={licenceNumber}
                onChange={(event) => setLicenceNumber(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Compliance will ask for it if it is not here. A facility whose licence has lapsed
                cannot publish shifts.
              </p>
            </div>
          </div>

          <Button disabled={!ready} loading={register.isPending} onClick={() => register.mutate()}>
            <Building2 />
            Register
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
