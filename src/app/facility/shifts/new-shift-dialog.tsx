'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useZodForm } from '@/lib/ui/form';
import { useFacility } from '@/lib/ui/facility';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/app/field';
import { ErrorState } from '@/components/app/states';
import { SuccessScreen } from '@/components/app/success-screen';
import {
  formatMinutes,
  formatNaira,
  formatShiftWindow,
  parseNairaToKobo,
} from '@/components/app/format';
import { lagosLocalToInstant } from '@/lib/lagos-date';
import { deriveShiftType } from '@/modules/service-requests/domain/shift-type';

/**
 * Publishing a shift, in three steps that say what they are: **details**, **review**, **done**.
 *
 * A shift cannot have its terms changed once it is published, and people ask for it at the end of a
 * twelve-field form on a phone. So nothing is sent from the form: it leads to a review screen that
 * reads the whole thing back in plain words — what, when in Lagos time, how many, the rate, the
 * cancellation terms, what it will cost at least — and says plainly what publishing does and that
 * its terms cannot then be edited. Only the button on that screen sends anything.
 *
 * What was easy to get wrong before is no longer silent:
 *  - **No pre-filled rate.** It was ₦5,000, and a person could publish having chosen only a
 *    profession and two times. The rate is empty and says what it is for.
 *  - **The cancellation terms are a suggestion, labelled as one**, and printed on the review screen
 *    because "this is what a dispute turns on".
 *  - **Known blockers come first.** The facility record already says whether it can publish and why
 *    not; the form says so before twelve fields, not after.
 *  - **A failed publish never leaves two drafts.** The shift is created, then published. If the
 *    second step fails — an unaccepted agreement, a pay floor, a lapsed licence — the draft is kept,
 *    the screen says it was saved but is *not* published, and trying again publishes that same draft
 *    unless something was changed, in which case the stale draft is withdrawn first.
 *  - **The rate is naira in, kobo out**, through `parseNairaToKobo`, which refuses a third decimal.
 *  - **After success** it says what happens next and offers the next step: find candidates for it.
 *
 * Everything entered survives a refusal; nothing is lost by closing and reopening until it has
 * been published.
 */

const URGENCIES = [
  { value: 'ROUTINE', label: 'Routine' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'EMERGENCY', label: 'Emergency' },
] as const;

const SUGGESTED_TERMS = 'Either party may cancel up to 24 hours before the shift without penalty.';

const BLOCKERS: Record<string, string> = {
  not_verified: 'This facility has not been verified by Medilink yet.',
  suspended: 'This facility is suspended.',
  licence_expired: 'The facility licence has expired.',
  deleted: 'This facility has been removed.',
};

interface Values {
  categoryId: string;
  specialtyId?: string;
  levelId?: string;
  supervised: boolean;
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  startsAt: string;
  endsAt: string;
  headcount: string;
  rate: string;
  terms: string;
  notes?: string;
}

const EMPTY: Values = {
  categoryId: '',
  specialtyId: '',
  levelId: '',
  supervised: false,
  urgency: 'ROUTINE',
  startsAt: '',
  endsAt: '',
  headcount: '1',
  rate: '',
  terms: SUGGESTED_TERMS,
  notes: '',
};

type Step = 'form' | 'review' | 'done';

export function NewShiftDialog({
  facilityId,
  trigger,
  defaultOpen = false,
}: {
  facilityId: string;
  /** The control that opens it, when the page has a better place for it than the default button. */
  trigger?: ReactNode;
  /** Already open when it first appears — for `NewShiftLauncher`, which loads it on the first press. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState<Step>('form');
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const reference = useReference();
  const facility = useFacility(facilityId);
  const queryClient = useQueryClient();

  // Whether the chosen profession has levels is only known after it is chosen, so the schema asks
  // a ref rather than being rebuilt (the form's resolver is fixed when it is created).
  const levelsRequired = useRef(false);

  const schema = useMemo(
    () =>
      z
        .object({
          categoryId: z.string().min(1, 'Choose the profession.'),
          specialtyId: z.string().optional(),
          levelId: z.string().optional(),
          supervised: z.boolean(),
          urgency: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']),
          startsAt: z.string().min(1, 'Choose when the shift starts.'),
          endsAt: z.string().min(1, 'Choose when the shift ends.'),
          headcount: z
            .string()
            .trim()
            .regex(/^\d+$/, 'A whole number, at least 1.')
            .refine((value) => Number(value) >= 1, 'At least one person.'),
          rate: z
            .string()
            .trim()
            .min(1, 'Enter the hourly rate in naira.')
            .refine((value) => {
              const kobo = parseNairaToKobo(value);
              return kobo !== null && kobo > 0;
            }, 'Enter an amount in naira, for example 5,000 or 5,000.50.'),
          terms: z
            .string()
            .trim()
            .min(10, 'Say what happens if either side cancels — a sentence, at least.'),
          notes: z.string().optional(),
        })
        .superRefine((value, ctx) => {
          if (levelsRequired.current && !value.levelId) {
            ctx.addIssue({
              code: 'custom',
              path: ['levelId'],
              message: 'Choose the level this shift is for.',
            });
          }
          if (value.startsAt && value.endsAt) {
            const starts = lagosLocalToInstant(value.startsAt).getTime();
            const ends = lagosLocalToInstant(value.endsAt).getTime();
            if (ends <= starts) {
              ctx.addIssue({
                code: 'custom',
                path: ['endsAt'],
                message: 'A shift has to end after it starts.',
              });
            }
            if (starts <= Date.now()) {
              ctx.addIssue({
                code: 'custom',
                path: ['startsAt'],
                message: 'A shift cannot start in the past.',
              });
            }
          }
        }),
    [],
  );

  const form = useZodForm(schema, { defaultValues: EMPTY });
  const { errors } = form.formState;
  const values = form.watch();

  const specialties = (reference.data?.specialties ?? []).filter(
    (row) => row.categoryId === values.categoryId,
  );
  // Levels the profession has defined (REQ-01). Once it has any, a shift has to say which.
  const levels = (reference.data?.cadreLevels ?? []).filter(
    (row) => row.categoryId === values.categoryId,
  );
  levelsRequired.current = levels.length > 0;

  const hourlyRateKobo = parseNairaToKobo(values.rate ?? '') ?? 0;
  const startsAtInstant = values.startsAt ? lagosLocalToInstant(values.startsAt) : null;
  const endsAtInstant = values.endsAt ? lagosLocalToInstant(values.endsAt) : null;
  const minutes =
    startsAtInstant && endsAtInstant
      ? Math.round((endsAtInstant.getTime() - startsAtInstant.getTime()) / 60_000)
      : 0;
  const headcount = Number(values.headcount) >= 1 ? Math.floor(Number(values.headcount)) : 1;
  // Whole kobo: rate × minutes × people ÷ 60, rounded once at the end.
  const estimateKobo = minutes > 0 ? Math.round((hourlyRateKobo * minutes * headcount) / 60) : 0;
  // Day or night is a fact about the hours and the pay floor follows it, so it is worked out rather
  // than picked (UXF-06). The server works it out again and refuses a label that disagrees.
  const shiftType =
    startsAtInstant && endsAtInstant && minutes > 0
      ? deriveShiftType(startsAtInstant, endsAtInstant)
      : null;

  const blockers = facility.data?.publishBlockers ?? [];
  const cannotPublish = facility.data?.canPublish === false && blockers.length > 0;

  // The draft created by a publish that then failed, and exactly what it was created from.
  const draft = useRef<{ id: string; key: string } | null>(null);

  const publish = useMutation({
    mutationFn: async () => {
      const v = form.getValues();
      const payload = {
        facilityId,
        professionalCategoryId: v.categoryId,
        specialtyId: v.specialtyId || undefined,
        cadreLevelId: v.levelId || undefined,
        supervisionAvailable: v.supervised,
        startsAt: lagosLocalToInstant(v.startsAt).toISOString(),
        endsAt: lagosLocalToInstant(v.endsAt).toISOString(),
        headcount: Number(v.headcount),
        hourlyRateKobo: parseNairaToKobo(v.rate) ?? 0,
        urgency: v.urgency,
        cancellationTerms: v.terms.trim(),
        notes: v.notes?.trim() || undefined,
      };
      const key = JSON.stringify(payload);

      let id = draft.current?.id;
      if (id && draft.current?.key !== key) {
        // Something was changed after the last attempt, so the saved draft is not what is about to
        // be published. Withdraw it rather than leave two, and make the shift again.
        await api
          .post(`/api/v1/service-requests/${id}/cancel`, {
            facilityId,
            reason: 'Replaced by a corrected draft before it was published.',
          })
          .catch(() => undefined);
        id = undefined;
        draft.current = null;
      }
      if (!id) {
        const created = await api.post<{ id: string }>('/api/v1/service-requests', payload);
        id = created.id;
        draft.current = { id, key };
      }

      // Created as a DRAFT; publishing is what opens it to invitations. The gate rules — a verified
      // facility, a licence that has not lapsed, accepted terms, the pay floor — are checked here.
      await api.post(`/api/v1/service-requests/${id}/publish`, { facilityId });
      return id;
    },
    onSuccess: (id) => {
      draft.current = null;
      setPublishedId(id);
      setStep('done');
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
  });

  // Moving between steps replaces the button just pressed; the new step's heading takes focus so a
  // keyboard or screen-reader user starts reading where they now are.
  const heading = useRef<HTMLHeadingElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) heading.current?.focus();
    arrived.current = true;
  }, [step]);

  function reset() {
    form.reset(EMPTY);
    publish.reset();
    draft.current = null;
    setPublishedId(null);
    setStep('form');
  }

  function onOpenChange(next: boolean) {
    if (publish.isPending) return;
    setOpen(next);
    // After a publish the form has done its job; reopening should not offer the same shift again.
    if (!next && step === 'done') reset();
  }

  const profession = nameOf(reference.data?.professionalCategories, values.categoryId);
  const specialty = specialties.find((row) => row.id === values.specialtyId)?.name;
  const level = levels.find((row) => row.id === values.levelId)?.name;
  const urgency = URGENCIES.find((row) => row.value === values.urgency)?.label ?? values.urgency;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <CalendarPlus />
            Publish a shift
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          {step === 'done' ? null : (
            <p className="text-sm font-medium text-muted-foreground">
              {step === 'form' ? 'Step 1 of 2 · Details' : 'Step 2 of 2 · Review'}
            </p>
          )}
          <DialogTitle ref={heading} tabIndex={-1} className="outline-none">
            {step === 'form'
              ? 'Publish a shift'
              : step === 'review'
                ? 'Check it before you publish'
                : 'Shift published'}
          </DialogTitle>
          <DialogDescription className={step === 'done' ? 'sr-only' : undefined}>
            {step === 'form'
              ? 'Say what you need. You will see it all read back before anything is sent.'
              : step === 'review'
                ? 'Once published, a shift can be offered to practitioners and its terms cannot be changed.'
                : 'It is now open to be offered to practitioners.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'done' ? (
          <SuccessScreen
            bare
            title={`${profession}${level ? ` (${level})` : ''} shift is published`}
            description={
              values.startsAt
                ? formatShiftWindow(startsAtInstant, endsAtInstant) + ' · Lagos time'
                : undefined
            }
            steps={[
              'Find candidates: Medilink ranks the practitioners who are eligible, available and nearby, and says why anybody was left out.',
              `Offer it to the people you choose. Nobody is booked until they accept and you confirm — that is when it becomes a shift${
                headcount > 1 ? ` (you need ${headcount})` : ''
              }.`,
              'Its terms are now fixed. To change them, cancel it and publish another.',
            ]}
            actions={
              <>
                {publishedId ? (
                  <Link
                    href={`/facility/shifts/${publishedId}`}
                    onClick={() => onOpenChange(false)}
                    className={buttonVariants({ size: 'lg' })}
                  >
                    Find candidates
                  </Link>
                ) : null}
                <Button variant="outline" size="lg" onClick={reset}>
                  Publish another
                </Button>
              </>
            }
          />
        ) : step === 'review' ? (
          <div className="space-y-4">
            <dl className="divide-y rounded-lg border">
              <Row label="Who">
                {profession}
                {specialty ? ` · ${specialty}` : ''}
                {level ? ` · ${level}` : ''}
                {values.supervised ? ' · supervision available' : ''}
              </Row>
              <Row label="When (Lagos time)">
                {formatShiftWindow(startsAtInstant, endsAtInstant)}
                <span className="block text-sm text-muted-foreground">
                  {formatMinutes(minutes)} ·{' '}
                  {shiftType === 'NIGHT' ? 'a night shift' : 'a day shift'}
                </span>
              </Row>
              <Row label="People needed">{headcount}</Row>
              <Row label="Urgency">{urgency}</Row>
              <Row label="Rate">
                <span className="tabular">{formatNaira(hourlyRateKobo)} an hour</span>
                <span className="block text-sm text-muted-foreground">
                  <span className="tabular">{formatNaira(estimateKobo)}</span> at the base rate for{' '}
                  {headcount === 1 ? 'one person' : `${headcount} people`}. Night and public-holiday
                  hours are multiplied by this facility&rsquo;s rate card, so the invoice can come
                  to more.
                </span>
              </Row>
              <Row label="If somebody cancels">
                <span className="whitespace-pre-wrap">{values.terms.trim()}</span>
                <span className="block text-sm text-muted-foreground">
                  This is what a dispute turns on. It is shown to the practitioner before they say
                  yes.
                </span>
              </Row>
              {values.notes?.trim() ? (
                <Row label="Notes for the practitioner">
                  <span className="whitespace-pre-wrap">{values.notes.trim()}</span>
                </Row>
              ) : null}
            </dl>

            {publish.isError ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription className="space-y-1">
                  <p className="font-medium">It was not published.</p>
                  <p>{errorMessage(publish.error)}</p>
                  {draft.current ? (
                    <p>
                      It is saved as a draft and has not been offered to anybody. Go back and
                      correct what is wrong, or publish again; it will not be duplicated.
                    </p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
              <Button
                variant="outline"
                onClick={() => setStep('form')}
                disabled={publish.isPending}
              >
                Back and change
              </Button>
              <Button onClick={() => publish.mutate()} loading={publish.isPending}>
                Publish this shift
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-6"
            noValidate
            onSubmit={form.handleSubmit(() => {
              publish.reset();
              setStep('review');
            })}
          >
            {cannotPublish ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription className="space-y-1">
                  <p className="font-medium">This facility cannot publish shifts right now.</p>
                  <ul className="list-disc pl-5">
                    {blockers.map((blocker) => (
                      <li key={blocker}>{BLOCKERS[blocker] ?? blocker}</li>
                    ))}
                  </ul>
                  <p>
                    <Link
                      href="/facility/profile"
                      className="font-medium underline underline-offset-4"
                    >
                      Open the facility profile
                    </Link>{' '}
                    to put it right.
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}

            {reference.isError ? (
              <ErrorState
                error={reference.error}
                onRetry={() => void reference.refetch()}
                retrying={reference.isFetching}
                compact
              />
            ) : null}

            <fieldset className="space-y-4">
              <legend className="mb-1 text-base font-semibold">Who you need</legend>

              <Field label="Profession" error={errors.categoryId?.message}>
                {(a11y) => (
                  <Controller
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          form.setValue('specialtyId', '');
                          form.setValue('levelId', '');
                        }}
                      >
                        <SelectTrigger {...a11y} onBlur={field.onBlur}>
                          <SelectValue placeholder="Choose a profession" />
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

              {specialties.length > 0 ? (
                <Field
                  label="Specialty"
                  optional
                  hint="Leave on “Any” to offer it to everyone in the profession."
                >
                  {(a11y) => (
                    <Controller
                      control={form.control}
                      name="specialtyId"
                      render={({ field }) => (
                        <Select
                          value={field.value || 'any'}
                          onValueChange={(value) => field.onChange(value === 'any' ? '' : value)}
                        >
                          <SelectTrigger {...a11y}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Any</SelectItem>
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
              ) : null}

              {levels.length > 0 ? (
                <Field
                  label="Level"
                  hint="Only practitioners recorded at this level are offered the shift."
                  error={errors.levelId?.message}
                >
                  {(a11y) => (
                    <Controller
                      control={form.control}
                      name="levelId"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger {...a11y} onBlur={field.onBlur}>
                            <SelectValue placeholder="Which level is this shift for?" />
                          </SelectTrigger>
                          <SelectContent>
                            {levels.map((row) => (
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
              ) : null}

              <Field label="People needed" error={errors.headcount?.message}>
                <Input type="number" inputMode="numeric" min={1} {...form.register('headcount')} />
              </Field>

              <label className="flex items-start gap-3 text-base">
                <input
                  type="checkbox"
                  className="mt-0.5 size-6 shrink-0 accent-primary"
                  {...form.register('supervised')}
                />
                <span>
                  Somebody will be there to supervise
                  <span className="block text-sm text-muted-foreground">
                    Needed to offer the shift to a practitioner on a provisional register.
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="mb-1 text-base font-semibold">When</legend>
              <p className="-mt-2 text-sm text-muted-foreground">All times are Lagos time (WAT).</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starts" error={errors.startsAt?.message}>
                  <Input type="datetime-local" {...form.register('startsAt')} />
                </Field>
                <Field label="Ends" error={errors.endsAt?.message}>
                  <Input type="datetime-local" {...form.register('endsAt')} />
                </Field>
              </div>

              <p aria-live="polite" className="rounded-md bg-muted px-3 py-2 text-base">
                {shiftType === null
                  ? 'Day or night is worked out from the times you choose.'
                  : `${formatMinutes(minutes)}. ${
                      shiftType === 'NIGHT'
                        ? 'A night shift — most of it falls between 20:00 and 06:00.'
                        : 'A day shift.'
                    }`}
              </p>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="mb-1 text-base font-semibold">Pay and terms</legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Hourly rate (naira)"
                  hint="What you will pay per person for each hour, before night and holiday multiples."
                  error={errors.rate?.message}
                >
                  <Input
                    inputMode="decimal"
                    placeholder="For example 5,000"
                    autoComplete="off"
                    {...form.register('rate')}
                  />
                </Field>

                <Field
                  label="Urgency"
                  hint="Urgent and emergency shifts are shown first to practitioners."
                >
                  {(a11y) => (
                    <Controller
                      control={form.control}
                      name="urgency"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger {...a11y}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {URGENCIES.map((row) => (
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
              </div>

              {minutes > 0 && hourlyRateKobo > 0 ? (
                <p aria-live="polite" className="rounded-md bg-muted px-3 py-2 text-base">
                  <span className="tabular">{formatMinutes(minutes)}</span> ×{' '}
                  <span className="tabular">{formatNaira(hourlyRateKobo)}</span> × {headcount}{' '}
                  {headcount === 1 ? 'person' : 'people'} ={' '}
                  <strong className="tabular">{formatNaira(estimateKobo)}</strong> at the base rate.
                  Night and holiday hours are multiplied by your rate card.
                </p>
              ) : null}

              <Field
                label="If somebody cancels"
                hint="Suggested wording. Change it if it is not your policy: this is what a dispute turns on, and the practitioner sees it before they say yes."
                error={errors.terms?.message}
              >
                <Textarea rows={3} {...form.register('terms')} />
              </Field>

              <Field
                label="Notes for the practitioner"
                optional
                hint="Ward, who to report to, anything they need to bring."
              >
                <Textarea rows={2} {...form.register('notes')} />
              </Field>
            </fieldset>

            <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={cannotPublish}>
                Review before publishing
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-base leading-relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
