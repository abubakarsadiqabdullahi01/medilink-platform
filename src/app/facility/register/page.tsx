'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, CircleAlert, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/ui/api';
import { useZodForm } from '@/lib/ui/form';
import { useReference } from '@/lib/ui/reference';
import {
  REGISTRATION_KIND_OPTIONS,
  registrationOption,
  type RegistrationKind,
} from '@/lib/ui/registration';
import { isNigerianPhone, normalizeNigerianPhone } from '@/lib/phone';
import {
  REGISTRATION_KINDS,
  normaliseRegistrationReference,
  registrationReferenceProblem,
} from '@/modules/facilities/domain/facility';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Combobox } from '@/components/app/combobox';
import { Field } from '@/components/app/field';
import { PageHeader } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { SuccessScreen } from '@/components/app/success-screen';

const schema = z.object({
  name: z.string().trim().min(3, 'Enter the facility name, as it is on your registration.'),
  facilityTypeId: z.string().min(1, 'Choose the type of facility.'),
  registrationKind: z.enum(REGISTRATION_KINDS),
  cacNumber: z.string().trim().min(1, 'Enter the registration number.'),
  stateId: z.string().min(1, 'Choose the state the facility is in.'),
  lgaId: z.string(),
  addressLine: z.string().trim().min(5, 'Enter the street, area and city.'),
  contactPhone: z
    .string()
    .trim()
    .min(1, 'Enter a phone number.')
    .refine(isNigerianPhone, 'Enter a Nigerian mobile number, for example 0803 123 4567.'),
  contactEmail: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || z.string().email().safeParse(value).success,
      'Enter a valid email address, or leave it empty.',
    ),
  licenceNumber: z.string().trim(),
});

type Values = z.input<typeof schema>;
type Step = 'form' | 'review' | 'done';

const EMPTY: Values = {
  name: '',
  facilityTypeId: '',
  registrationKind: 'CAC',
  cacNumber: '',
  stateId: '',
  lgaId: '',
  addressLine: '',
  contactPhone: '',
  contactEmail: '',
  licenceNumber: '',
};

/**
 * A hospital signing itself up.
 *
 * Three steps that say what they are: the details, a read-back of exactly what will be sent, and
 * what happens next. The read-back matters more than it looks: the registration number is what
 * compliance checks against, one registration can belong to one facility, and an account can have
 * only one facility waiting at a time — so a mistake typed here costs a conversation, not a click.
 *
 * It says plainly what happens next, because the thing people want to know is when they can start
 * using it — and the honest answer is "after somebody has checked your registration", not
 * "immediately".
 *
 * The licence document is not asked for here: it is uploaded against a facility, and this one does
 * not exist until the button is pressed. The next step says so and links to where it goes.
 */
export default function RegisterFacilityPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const reference = useReference();

  const [step, setStep] = useState<Step>('form');
  const form = useZodForm(schema, { defaultValues: EMPTY });
  const { errors, touchedFields } = form.formState;
  const values = form.watch();
  const registration = registrationOption(values.registrationKind);

  const lgas = (reference.data?.lgas ?? []).filter((row) => row.stateId === values.stateId);

  // Whether the number is one the register would accept is a rule the server applies and the
  // domain module states; asked here as well, so the answer comes under the field, not from a 422.
  const referenceError = useMemo(() => {
    const raw = values.cacNumber.trim();
    if (!raw) return null;
    return registrationReferenceProblem(
      values.registrationKind,
      normaliseRegistrationReference(values.registrationKind, raw),
    );
  }, [values.cacNumber, values.registrationKind]);
  const showReferenceError =
    Boolean(referenceError) && (touchedFields.cacNumber || step !== 'form');

  // Moving between steps puts focus on the new step's heading, so a keyboard or screen-reader user
  // is not left on a button that has gone, and a phone opens the step at its top.
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    heading.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const goTo = (next: Step) => {
    moved.current = true;
    setStep(next);
  };

  const register = useMutation({
    mutationFn: (input: Values) =>
      api.post('/api/v1/facilities/register', {
        name: input.name.trim(),
        facilityTypeId: input.facilityTypeId,
        registrationKind: input.registrationKind,
        cacNumber: input.cacNumber.trim(),
        stateId: input.stateId,
        lgaId: input.lgaId || undefined,
        addressLine: input.addressLine.trim(),
        contactPhone: input.contactPhone.trim(),
        contactEmail: input.contactEmail.trim() || undefined,
        licenceNumber: input.licenceNumber.trim() || undefined,
      }),
    onSuccess: () => {
      // The session's grants have just changed — this account went from
      // holding none to holding facility_owner. The session query has a
      // minute of staleTime for the ordinary case of nothing having changed
      // under it; this is the one moment on this page where something just
      // did, and the dashboard would otherwise still say "not attached" for
      // however much of that minute was left.
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      goTo('done');
    },
  });

  function toReview() {
    void form.handleSubmit(() => {
      if (referenceError) {
        form.setError('cacNumber', { message: referenceError });
        form.setFocus('cacNumber');
        return;
      }
      register.reset();
      goTo('review');
    })();
  }

  const typeName =
    (reference.data?.facilityTypes ?? []).find((row) => row.id === values.facilityTypeId)?.name ??
    '—';
  const stateName = (reference.data?.states ?? []).find((row) => row.id === values.stateId)?.name;
  const lgaName = (reference.data?.lgas ?? []).find((row) => row.id === values.lgaId)?.name;
  const storedReference = normaliseRegistrationReference(
    values.registrationKind,
    values.cacNumber.trim(),
  );
  const phone = (() => {
    try {
      return normalizeNigerianPhone(values.contactPhone);
    } catch {
      return values.contactPhone;
    }
  })();

  if (step === 'done') {
    return (
      <>
        <PageHeader title="Register your facility" />
        <SuccessScreen
          title={`${values.name.trim()} is registered, and waiting to be verified`}
          description="You are set up as its owner, so you can add colleagues now."
          steps={[
            'Compliance checks your registration number against your licence document. Until it has verified the facility, it cannot publish a shift.',
            'Add your licence document, its number and its expiry date on the Facility profile. Compliance reads the licence beside the number before verifying.',
            'In the meantime you can set the facility up and add colleagues.',
          ]}
          actions={
            <>
              <Link href="/facility/profile" className={buttonVariants({ size: 'lg' })}>
                Add the licence
                <ArrowRight />
              </Link>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  router.push('/facility');
                  router.refresh();
                }}
              >
                Go to the dashboard
              </Button>
            </>
          }
        />
      </>
    );
  }

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

      <p className="tabular text-sm font-semibold uppercase tracking-wide text-primary">
        Step {step === 'form' ? 1 : 2} of 2 · {step === 'form' ? 'Details' : 'Review'}
      </p>
      <h2
        ref={heading}
        tabIndex={-1}
        className="mb-4 mt-1 text-xl font-semibold tracking-tight outline-none"
      >
        {step === 'form' ? 'Your facility’s details' : 'Check before you register'}
      </h2>

      {step === 'review' ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">This is what compliance will see</CardTitle>
            <CardDescription>
              The registration number is what is checked, and one registration can belong to only
              one facility. Change anything that is wrong now.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="divide-y rounded-md border">
              <Row label="Facility name">{values.name.trim()}</Row>
              <Row label="Type">{typeName}</Row>
              <Row label="Registered as">{registration.label}</Row>
              <Row label={registration.referenceLabel}>
                <span className="font-mono">{storedReference}</span>
                {storedReference !== values.cacNumber.trim() ? (
                  <span className="block text-sm text-muted-foreground">
                    As you typed it: {values.cacNumber.trim()}. Spaces and punctuation are not kept
                    in a CAC number.
                  </span>
                ) : null}
              </Row>
              <Row label="Where">
                {[lgaName, stateName].filter(Boolean).join(', ')}
                <span className="block">{values.addressLine.trim()}</span>
              </Row>
              <Row label="Telephone">{phone}</Row>
              <Row label="Email">{values.contactEmail.trim() || 'Not given'}</Row>
              <Row label="Operating licence number">
                {values.licenceNumber.trim() ||
                  'Not given yet. You can add it on the Facility profile.'}
              </Row>
            </dl>

            {register.isError ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>
                  <strong>It was not registered.</strong> {errorMessage(register.error)} Nothing you
                  typed has been lost: change what is wrong and try again.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="outline"
                disabled={register.isPending}
                onClick={() => goTo('form')}
                className="w-full sm:w-auto"
              >
                <ArrowLeft />
                Change the details
              </Button>
              <Button
                loading={register.isPending}
                onClick={() => register.mutate(form.getValues())}
                className="w-full sm:w-auto"
              >
                <Building2 />
                Register this facility
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-8 pt-6">
            {reference.isError ? (
              <ErrorState
                compact
                error={reference.error}
                onRetry={() => void reference.refetch()}
                retrying={reference.isFetching}
              />
            ) : null}

            <Section
              title="About the facility"
              note="These have to match your registration, because that is what is checked against."
            >
              <Field
                label="Facility name"
                required
                hint="As it appears on your registration certificate."
                error={errors.name?.message}
                className="sm:col-span-2"
              >
                <Input autoComplete="organization" {...form.register('name')} />
              </Field>

              <Field label="Type" required error={errors.facilityTypeId?.message}>
                {(a11y) => (
                  <Controller
                    control={form.control}
                    name="facilityTypeId"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger {...a11y} onBlur={field.onBlur}>
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
                    )}
                  />
                )}
              </Field>

              <Field label="What is the facility registered as?" required>
                {(a11y) => (
                  <Controller
                    control={form.control}
                    name="registrationKind"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(value) => field.onChange(value as RegistrationKind)}
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
                  />
                )}
              </Field>

              <Field
                label={registration.referenceLabel}
                required
                hint={registration.help}
                error={
                  showReferenceError ? (referenceError ?? undefined) : errors.cacNumber?.message
                }
                className="sm:col-span-2"
              >
                <Input
                  placeholder={registration.placeholder}
                  autoComplete="off"
                  {...form.register('cacNumber')}
                />
              </Field>
            </Section>

            <Section title="Where it is">
              <Field label="State" required error={errors.stateId?.message}>
                {(a11y) => (
                  <Controller
                    control={form.control}
                    name="stateId"
                    render={({ field }) => (
                      <Combobox
                        id={a11y.id}
                        options={(reference.data?.states ?? []).map((row) => ({
                          value: row.id,
                          label: row.name,
                          hint: row.zone,
                        }))}
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value);
                          form.setValue('lgaId', '');
                        }}
                        searchPlaceholder="Search 37 states…"
                      />
                    )}
                  />
                )}
              </Field>

              <Field label="Local government area" optional>
                {(a11y) => (
                  <Controller
                    control={form.control}
                    name="lgaId"
                    render={({ field }) => (
                      <Combobox
                        id={a11y.id}
                        options={lgas.map((row) => ({ value: row.id, label: row.name }))}
                        value={field.value}
                        onChange={field.onChange}
                        disabled={lgas.length === 0}
                        placeholder={lgas.length === 0 ? 'Choose a state first' : 'Choose one'}
                        searchPlaceholder={`Search ${lgas.length} areas…`}
                      />
                    )}
                  />
                )}
              </Field>

              <Field
                label="Address"
                required
                error={errors.addressLine?.message}
                className="sm:col-span-2"
              >
                <Input
                  autoComplete="street-address"
                  placeholder="Street, area, city"
                  {...form.register('addressLine')}
                />
              </Field>
            </Section>

            <Section title="How to reach the facility">
              <Field
                label="Telephone"
                required
                hint="A Nigerian mobile number, for example 0803 123 4567. A landline is not accepted."
                error={errors.contactPhone?.message}
              >
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0803 123 4567"
                  {...form.register('contactPhone')}
                />
              </Field>

              <Field label="Email" optional error={errors.contactEmail?.message}>
                <Input type="email" autoComplete="email" {...form.register('contactEmail')} />
              </Field>

              <Field
                label="Operating licence number"
                optional
                hint="Compliance will ask for it if it is not here. A facility whose licence has lapsed cannot publish shifts."
                className="sm:col-span-2"
              >
                <Input autoComplete="off" {...form.register('licenceNumber')} />
              </Field>
            </Section>

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
              <Button onClick={toReview} className="w-full sm:w-auto">
                Review before registering
                <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** A group of related fields under its own heading, one column on a phone and two beside it. */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-base font-semibold">{title}</legend>
      {note ? (
        <p className="mb-3 text-sm text-muted-foreground">{note}</p>
      ) : (
        <div className="mb-3" />
      )}
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-base leading-relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
