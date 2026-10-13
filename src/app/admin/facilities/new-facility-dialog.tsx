'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Search, TriangleAlert } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
import {
  REGISTRATION_KIND_OPTIONS,
  registrationOption,
  type RegistrationKind,
} from '@/lib/ui/registration';
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
import { Combobox } from '@/components/app/combobox';

interface Representative {
  id: string;
  fullName: string;
  phone: string;
  status: string;
}

/**
 * Operations onboarding a facility (UXO-01).
 *
 * The launch model is operations-assisted: a hospital with no one at a computer
 * is registered by Medilink on its behalf, and the person it names becomes its
 * owner. The API has always allowed it and no screen did, so the only way to put a
 * government hospital on the platform was SQL.
 *
 * The representative must already have an account, found by the number they
 * registered with, one at a time - the lookup is deliberately not a directory.
 */
export function NewFacilityDialog() {
  const queryClient = useQueryClient();
  const reference = useReference();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [facilityTypeId, setFacilityTypeId] = useState('');
  const [registrationKind, setRegistrationKind] = useState<RegistrationKind>('GOVERNMENT');
  const [cacNumber, setCacNumber] = useState('');
  const [stateId, setStateId] = useState('');
  const [lgaId, setLgaId] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [representativePhone, setRepresentativePhone] = useState('');
  const [representative, setRepresentative] = useState<Representative | null>(null);
  const [lookupProblem, setLookupProblem] = useState<string | null>(null);

  const registration = registrationOption(registrationKind);
  const lgas = (reference.data?.lgas ?? []).filter((row) => row.stateId === stateId);

  const find = useMutation({
    mutationFn: () =>
      api.get<Representative>(`/api/v1/users/find?phone=${encodeURIComponent(representativePhone.trim())}`),
    onSuccess: (person) => {
      setRepresentative(person);
      setLookupProblem(null);
    },
    onError: (error) => {
      setRepresentative(null);
      setLookupProblem(
        error instanceof ApiError && error.failure.status === 404
          ? 'Nobody has registered with that number. Ask them to create an account first.'
          : errorMessage(error),
      );
    },
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/v1/facilities', {
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
        representativeUserId: representative!.id,
      }),
    onSuccess: () => {
      toast.success('Facility registered', {
        description: `${representative?.fullName} is its owner. It still has to be verified before it can publish.`,
      });
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['facility-directory'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
    onError: (error) => toast.error('Could not register it', { description: errorMessage(error) }),
  });

  const ready =
    name.trim().length >= 2 &&
    facilityTypeId &&
    cacNumber.trim().length >= 3 &&
    stateId &&
    addressLine.trim().length >= 4 &&
    contactPhone.trim().length >= 7 &&
    representative !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Building2 />
          Register a facility
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register a facility</DialogTitle>
          <DialogDescription>
            For a hospital or health centre with nobody at a computer, or one you are onboarding in
            person. It is created waiting for verification and cannot publish anything until it has been
            verified, whoever registers it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nf-name">Name</Label>
            <Input id="nf-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nf-type">Type</Label>
            <Select value={facilityTypeId} onValueChange={setFacilityTypeId}>
              <SelectTrigger id="nf-type">
                <SelectValue placeholder="Choose a type" />
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
            <Label htmlFor="nf-kind">Registered as</Label>
            <Select value={registrationKind} onValueChange={(value) => setRegistrationKind(value as RegistrationKind)}>
              <SelectTrigger id="nf-kind">
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

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nf-reference">{registration.referenceLabel}</Label>
            <Input
              id="nf-reference"
              value={cacNumber}
              onChange={(event) => setCacNumber(event.target.value)}
              placeholder={registration.placeholder}
            />
            <p className="text-xs text-muted-foreground">{registration.help}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nf-state">State</Label>
            <Combobox
              id="nf-state"
              options={(reference.data?.states ?? []).map((row) => ({ value: row.id, label: row.name, hint: row.zone }))}
              value={stateId}
              onChange={(value) => {
                setStateId(value);
                setLgaId('');
              }}
              searchPlaceholder="Search states…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nf-lga">Local government (optional)</Label>
            <Select value={lgaId} onValueChange={setLgaId} disabled={!stateId}>
              <SelectTrigger id="nf-lga">
                <SelectValue placeholder={stateId ? 'Choose one' : 'Choose a state first'} />
              </SelectTrigger>
              <SelectContent>
                {lgas.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nf-address">Address</Label>
            <Input id="nf-address" value={addressLine} onChange={(event) => setAddressLine(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nf-phone">Telephone</Label>
            <Input id="nf-phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nf-email">Email (optional)</Label>
            <Input id="nf-email" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nf-licence">Licence number (optional now; needed to verify)</Label>
            <Input id="nf-licence" value={licenceNumber} onChange={(event) => setLicenceNumber(event.target.value)} />
          </div>

          <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
            <Label htmlFor="nf-rep">Who will run it? The phone number they registered with</Label>
            <div className="flex gap-2">
              <Input
                id="nf-rep"
                value={representativePhone}
                onChange={(event) => {
                  setRepresentativePhone(event.target.value);
                  setRepresentative(null);
                }}
                placeholder="0803 123 4567"
              />
              <Button
                type="button"
                variant="outline"
                disabled={representativePhone.trim().length < 7}
                loading={find.isPending}
                onClick={() => find.mutate()}
              >
                <Search />
                Find
              </Button>
            </div>
            {representative ? (
              <p className="text-sm">
                <strong>{representative.fullName}</strong> will be the owner and can add their own staff.
              </p>
            ) : null}
            {lookupProblem ? (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertDescription>{lookupProblem}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={create.isPending} onClick={() => create.mutate()}>
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
