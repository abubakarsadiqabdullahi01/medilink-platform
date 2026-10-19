'use client';

import { useEffect, useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/ui/api';
import { useZodForm } from '@/lib/ui/form';
import { useProfile } from '@/lib/ui/practitioner';
import { useReference } from '@/lib/ui/reference';
import { BIO_MAX_LENGTH, YEARS_OF_EXPERIENCE_MAX } from '@/modules/practitioners/domain/profile';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/app/combobox';
import { Field } from '@/components/app/field';
import { ErrorState, LoadingStatus } from '@/components/app/states';
import { Skeleton } from '@/components/ui/skeleton';
import { PhotoField } from './photo-field';

export const TRAVEL = [
  ['SAME_LGA', 'Only my own local government area'],
  ['SAME_STATE', 'Anywhere in my state'],
  ['ANYWHERE', 'Anywhere in Nigeria'],
] as const;

const schema = z.object({
  categoryId: z.string().min(1, 'Choose your profession.'),
  specialtyId: z.string(),
  years: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Enter a whole number of years: 0 if you have just qualified.')
    .refine((value) => Number(value) <= YEARS_OF_EXPERIENCE_MAX, {
      message: `Enter ${YEARS_OF_EXPERIENCE_MAX} years or fewer.`,
    }),
  bio: z.string().max(BIO_MAX_LENGTH, `Keep it to ${BIO_MAX_LENGTH} characters or fewer.`),
  stateId: z.string(),
  lgaId: z.string(),
  travel: z.enum(['SAME_LGA', 'SAME_STATE', 'ANYWHERE']),
});

const EMPTY = {
  categoryId: '',
  specialtyId: '',
  years: '0',
  bio: '',
  stateId: '',
  lgaId: '',
  travel: 'SAME_STATE' as const,
};

/**
 * The profile, which is also half the matcher's input.
 *
 * Travel preference and home LGA are not decoration: the engine scores
 * proximity against them and excludes a shift outside what somebody said they
 * would travel to. The form says so, because a practitioner who leaves the
 * default has effectively narrowed their own offers without being told.
 *
 * Mistakes are named under the field as soon as it has been left, and the form keeps everything
 * typed when the server refuses it — the reason is written beside the button, where it stays,
 * rather than in a notice that goes after a few seconds.
 */
export function ProfileForm({
  onSaved,
  embedded = false,
}: {
  onSaved?: (created: boolean) => void;
  /** Inside the setup wizard, whose own heading already says this is the first step. */
  embedded?: boolean;
}) {
  const reference = useReference();
  const queryClient = useQueryClient();

  const profile = useProfile();
  const form = useZodForm(schema, { defaultValues: EMPTY });
  const { errors } = form.formState;
  const values = form.watch();

  // Seeded when the profile arrives; what the person has already changed is kept, so a refetch
  // in the background never overwrites typing.
  useEffect(() => {
    if (!profile.data) return;
    form.reset(
      {
        categoryId: profile.data.professionalCategoryId,
        specialtyId: profile.data.specialtyId ?? '',
        years: String(profile.data.yearsOfExperience),
        bio: profile.data.bio ?? '',
        stateId: profile.data.homeStateId ?? '',
        lgaId: profile.data.homeLgaId ?? '',
        travel: profile.data.travelPreference as (typeof EMPTY)['travel'],
      },
      { keepDirtyValues: true },
    );
  }, [profile.data, form]);

  const exists = Boolean(profile.data);
  const specialties = (reference.data?.specialties ?? []).filter(
    (row) => row.categoryId === values.categoryId,
  );
  const lgas = (reference.data?.lgas ?? []).filter((row) => row.stateId === values.stateId);

  const save = useMutation({
    mutationFn: (input: z.input<typeof schema>) => {
      const body = {
        professionalCategoryId: input.categoryId,
        specialtyId: input.specialtyId || undefined,
        yearsOfExperience: Number(input.years || '0'),
        bio: input.bio.trim() || undefined,
        homeStateId: input.stateId || undefined,
        homeLgaId: input.lgaId || undefined,
        travelPreference: input.travel,
      };
      return exists
        ? api.patch('/api/v1/practitioners/me', body)
        : api.post('/api/v1/practitioners/me', body);
    },
    onSuccess: () => {
      toast.success('Saved');
      onSaved?.(!exists);
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
    },
  });

  const travelHint = useMemo(() => {
    if (values.travel === 'SAME_LGA' && !values.lgaId) {
      return 'You chose only your own area. Say which area that is above, or no shift can be placed against it.';
    }
    if (values.travel === 'SAME_STATE' && !values.stateId) {
      return 'Say which state you live in above, so “anywhere in my state” means something.';
    }
    return 'Your local government area and how far you will travel are what the matcher scores proximity on. Narrowing them narrows the shifts you are offered.';
  }, [values.travel, values.lgaId, values.stateId]);

  if (profile.isPending) {
    return (
      <>
        <LoadingStatus label="Loading your details" />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  if (profile.isError) {
    return (
      <ErrorState
        error={profile.error}
        onRetry={() => void profile.refetch()}
        retrying={profile.isFetching}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {exists ? 'Your details' : 'Create your profile'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Not a <form>: inside one, Radix Select adds a native <select> that hears programmatic
            changes — the values loaded from the profile — before its options exist, and answers
            by clearing the field. The button submits instead. */}
        <div className="space-y-5">
          {!exists && !embedded ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                You have no profile yet, so you cannot be matched to anything. This is the first
                step.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* A photograph attaches to a profile, so there is nothing to show until there is one: on a
              phone it would only push the first question below the fold. */}
          {exists ? (
            <>
              <PhotoField hasPhoto={Boolean(profile.data?.photoObjectKey)} profileExists />
              <Separator />
            </>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
            <Field label="Profession" required error={errors.categoryId?.message}>
              {(a11y) => (
                <Controller
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        // A specialty belongs to one profession, so the old one is no longer an answer.
                        form.setValue('specialtyId', '');
                      }}
                    >
                      <SelectTrigger {...a11y} onBlur={field.onBlur}>
                        <SelectValue placeholder="Choose one" />
                      </SelectTrigger>
                      <SelectContent>
                        {(reference.data?.professionalCategories ?? []).map((row) => (
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

            <Field label="Specialty" optional>
              {(a11y) => (
                <Controller
                  control={form.control}
                  name="specialtyId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={specialties.length === 0}
                    >
                      <SelectTrigger {...a11y}>
                        <SelectValue
                          placeholder={
                            specialties.length === 0
                              ? values.categoryId
                                ? 'None for this profession'
                                : 'Choose a profession first'
                              : 'Choose one'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {specialties.map((row) => (
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

            <Field label="Years of experience" required error={errors.years?.message}>
              <Input type="number" inputMode="numeric" min={0} {...form.register('years')} />
            </Field>

            <Field label="State you live in" optional>
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
                        // The LGA belonged to the old state, so it is no longer
                        // an answer to this question.
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

            <Field label="How far you will travel">
              {(a11y) => (
                <Controller
                  control={form.control}
                  name="travel"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger {...a11y}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRAVEL.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">{travelHint}</p>

          <Field
            label="About you"
            optional
            error={errors.bio?.message}
            hint="Where you have worked, what you are good at."
          >
            <Textarea rows={3} {...form.register('bio')} />
          </Field>

          {save.isError ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>
                <strong>Could not save.</strong> {errorMessage(save.error)} Nothing you typed has
                been lost: fix it and try again.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            loading={save.isPending}
            onClick={() =>
              void form.handleSubmit((input) => {
                save.reset();
                save.mutate(input);
              })()
            }
          >
            {exists ? 'Save changes' : 'Create profile'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
