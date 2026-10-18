'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, Building2, Check, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { useZodForm } from '@/lib/ui/form';
import { consoleFor, type SessionState } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AuthLink, AuthShell, type AuthPoint } from '@/components/app/auth-shell';
import { Field } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';

/**
 * Creating an account, in the three steps the API is built as: claim a phone
 * number, prove it with the code, then set a password.
 *
 * The API has had all three since Stage 4 and nothing in the product reached
 * them — the only way in was a seed script — so a person could not start where
 * everybody starts.
 *
 * The steps are not split across routes. An abandoned signup leaves a pending
 * account either way, and a URL per step is a URL somebody can land on with no
 * phone number in hand and nothing to do.
 */

const MIN_PASSWORD = 10;
const CODE_LENGTH = 6;

const STEPS = ['Your details', 'Confirm your number', 'Set a password'];

/**
 * Each step's rules, stated once.
 *
 * These mirror what the route already enforces, and that is the point: the
 * old form restated them as a `disabled` expression on the button, so a rule
 * tightened on the server became a form that let you submit and then refused
 * you. A schema here is still a second copy — the honest fix is to export the
 * route's own schema — but it is a copy in the same language and shape as the
 * original, which drifts visibly rather than silently.
 */
const detailsSchema = z.object({
  fullName: z.string().trim().min(2, 'Your full name, as it appears on your registration.'),
  phone: z
    .string()
    .trim()
    .min(1, 'A phone number is needed — it is how you sign in.')
    // Deliberately loose: 0803…, +234803…, 234803… are all things people
    // type, and normalisation belongs in one place (lib/phone.ts) rather
    // than being half-done by a regex here. This only catches the obviously
    // wrong before a round trip.
    .regex(/^[\d\s+()-]{10,}$/, 'That does not look like a Nigerian mobile number.'),
  email: z.union([z.literal(''), z.string().email('That email address is not valid.')]),
  // Recorded against the privacy notice in force. Always asked, so what somebody
  // sees does not depend on whether a notice has been published yet; the server
  // refuses without it once one has.
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Please read and accept the privacy notice to continue.' }),
  }),
});

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .length(CODE_LENGTH, `The code is ${CODE_LENGTH} digits.`)
    .regex(/^\d+$/, 'Digits only.'),
});

const passwordSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD, `At least ${MIN_PASSWORD} characters.`),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    message: 'These two do not match.',
    path: ['confirm'],
  });

function RegisterForm() {
  const router = useRouter();
  // Facility signup has nowhere else to start from: `/facility/register`
  // sits behind a signed-in shell (it has to — a facility needs a
  // representative user, and the session guard needs a session to check),
  // so a hospital's first step is this same phone-and-password flow, and the
  // query param is what tells this page — and the redirect at the end —
  // that is what is happening.
  const as = useSearchParams().get('as');
  const forFacility = as === 'facility';
  // A colleague joining a hospital that is already on Medilink. Like the
  // owner, they are staff rather than a practitioner: no practitioner role,
  // no screening. What they can do comes from the owner's Staff page.
  const forStaff = forFacility || as === 'staff';
  const [step, setStep] = useState(0);
  const [resent, setResent] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Moving on removes the button that was just pressed, and focus would fall to the top of the
  // page. The step's heading takes it instead, so a keyboard or screen-reader user hears where
  // they are and carries on from there. Not on first render: arriving must not steal focus.
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) stepHeading.current?.focus();
    arrived.current = true;
  }, [step]);

  const details = useZodForm(detailsSchema, {
    defaultValues: {
      fullName: '',
      phone: '',
      email: '',
      acceptTerms: undefined as unknown as true,
    },
  });
  const codeForm = useZodForm(codeSchema, { defaultValues: { code: '' } });
  const passwordForm = useZodForm(passwordSchema, {
    defaultValues: { password: '', confirm: '' },
  });

  /**
   * The number is carried between steps rather than re-read from the field,
   * because step two is a different form and the API needs the number it
   * actually sent the code to — not whatever is in a box by then.
   */
  const phone = details.getValues('phone');

  const start = useMutation({
    mutationFn: (values: z.infer<typeof detailsSchema>) =>
      api.post('/api/v1/auth/register', {
        phone: values.phone,
        fullName: values.fullName,
        email: values.email.trim() || undefined,
        acceptedTerms: values.acceptTerms,
      }),
    onSuccess: () => setStep(1),
  });

  // Handed back by verifying the phone and required to set the password: it is
  // what ties the last step to the code that was just entered.
  const [setupToken, setSetupToken] = useState('');

  const verify = useMutation({
    mutationFn: (values: z.infer<typeof codeSchema>) =>
      api.post<{ setupToken: string | null }>('/api/v1/auth/verify-phone', {
        phone,
        code: values.code,
      }),
    onSuccess: (result) => {
      setSetupToken(result.setupToken ?? '');
      setStep(2);
    },
  });

  const resend = useMutation({
    mutationFn: () =>
      api.post('/api/v1/auth/resend-code', { phone, purpose: 'PHONE_VERIFICATION' }),
    onSuccess: () => setResent(true),
  });

  const finish = useMutation({
    mutationFn: async (values: z.infer<typeof passwordSchema>) => {
      const password = values.password;
      await api.post('/api/v1/auth/set-password', {
        phone,
        password,
        setupToken,
        accountType: forStaff ? 'staff' : 'practitioner',
        consentToSharing: forStaff ? undefined : sharing,
      });
      await api.post('/api/v1/auth/login', { phone, password });

      /**
       * The baseline practitioner grant arrives through the outbox, so it is
       * not always there the instant the password is set. Landing somebody in
       * a console with an empty sidebar because the worker is a second behind
       * would look like a broken account on the one screen that has to feel
       * solid. Waiting briefly for the first grant costs nothing; if it never
       * comes, the console says so better than a spinner here would.
       */
      let session = await api.get<SessionState>('/api/v1/auth/session');
      // A staff account has no grant coming until somebody gives it one.
      for (let attempt = 0; !forStaff && attempt < 8 && session.grants.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        session = await api.get<SessionState>('/api/v1/auth/session');
      }
      return session;
    },
    onSuccess: (session) => {
      router.replace(
        forFacility ? '/facility/register' : forStaff ? '/facility' : consoleFor(session),
      );
      router.refresh();
    },
  });

  const failure = start.error ?? verify.error ?? finish.error ?? resend.error;

  const title = forFacility
    ? "Register your facility's account"
    : forStaff
      ? 'Create your staff account'
      : 'Create an account';

  const aside =
    forStaff && !forFacility
      ? {
          icon: Building2,
          headline:
            'An account is the start. Access comes from the person who manages it where you work.',
          points: [
            {
              title: 'Your own sign-in, never a shared one',
              description:
                'Everything you do is recorded against your name, so nobody else can act as you and nobody has to share a password.',
            },
            {
              title: 'Access is given, not chosen',
              description:
                'Once your account exists, your hospital’s owner adds you from their Staff page using your phone number. Until then the console tells you what to do next.',
            },
          ] satisfies AuthPoint[],
        }
      : forFacility
        ? {
            icon: Building2,
            headline:
              'An account is the start. Your facility is next, and Medilink verifies it before it can publish anything.',
            points: [
              {
                title: 'Your facility is checked against its registration',
                description:
                  'You can set it up straight away — it just cannot offer a shift to anybody until Medilink has confirmed it is real.',
              },
              {
                title: 'This account is yours, not the facility’s',
                description:
                  'You can grant access to colleagues once the facility exists, so this is not the only login it will ever have.',
              },
            ] satisfies AuthPoint[],
          }
        : {
            icon: BadgeCheck,
            headline: 'An account is the start. Verification is what gets you offered work.',
            points: [
              {
                title: 'You will be asked for your credentials',
                description:
                  'Your registration and credentials are reviewed before you can be matched to a shift. Until then your profile says exactly what is outstanding.',
              },
              {
                title: 'Nothing is hidden from you',
                description:
                  'If you are not eligible, the reasons are listed by name. No one has to ring support to find out why.',
              },
            ] satisfies AuthPoint[],
          };

  const detailErrors = details.formState.errors;
  const codeErrors = codeForm.formState.errors;
  const passwordErrors = passwordForm.formState.errors;

  return (
    <AuthShell
      title={title}
      description={
        forFacility ? (
          "This is you, not the facility — the person who will manage it. Your hospital's own details come next, once this is done."
        ) : forStaff ? (
          'For people who work at a hospital, or for Medilink, already using the platform. Once your account exists, whoever manages access adds you from their Staff page.'
        ) : (
          <>
            For doctors, nurses and other practitioners looking for shifts. Representing a hospital?{' '}
            <AuthLink href="/register?as=facility">Register it here</AuthLink>.
          </>
        )
      }
      aside={aside}
      footer={
        <p>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </p>
      }
    >
      <ol className="flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                index < step && 'bg-success text-success-foreground',
                index === step && 'bg-primary text-primary-foreground',
                index > step && 'bg-muted text-muted-foreground',
              )}
              aria-current={index === step ? 'step' : undefined}
            >
              {index < step ? <Check className="size-4" aria-hidden="true" /> : index + 1}
              <span className="sr-only">
                {index < step
                  ? ` ${label}, done`
                  : index === step
                    ? ` ${label}, this step`
                    : ` ${label}, not yet`}
              </span>
            </span>
            {index < STEPS.length - 1 ? (
              <span
                className={cn('h-px flex-1', index < step ? 'bg-success' : 'bg-border')}
                aria-hidden="true"
              />
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">
        Step {step + 1} of {STEPS.length}
      </p>
      <h2 ref={stepHeading} tabIndex={-1} className="text-lg font-semibold outline-none">
        {STEPS[step]}
      </h2>

      <Card className="mt-3">
        <CardContent className="pt-6">
          {failure ? (
            <Alert variant="destructive" className="mb-4">
              <TriangleAlert />
              <AlertDescription>{errorMessage(failure)}</AlertDescription>
            </Alert>
          ) : null}

          {step === 0 ? (
            <form
              className="space-y-4"
              onSubmit={details.handleSubmit((values) => start.mutate(values))}
              noValidate
            >
              <Field
                label="Full name"
                hint="As it appears on your registration."
                error={detailErrors.fullName?.message}
              >
                <Input {...details.register('fullName')} autoComplete="name" />
              </Field>

              <Field
                label="Phone number"
                hint="A Nigerian mobile number, for example 0803 123 4567. The code comes here, and it is how you sign in."
                error={detailErrors.phone?.message}
              >
                <Input {...details.register('phone')} autoComplete="tel" inputMode="tel" />
              </Field>

              {/* Optional because recovery.ts makes the phone the only recovery channel, and
                  because nothing in the product sends email yet. Saying so beats an unexplained
                  "(optional)" on a field people will wonder about. */}
              <Field
                label="Email"
                optional
                hint="Your phone is how you sign in and how you recover your account. Medilink does not send email yet — an address here is kept on your record for when it does."
                error={detailErrors.email?.message}
              >
                <Input type="email" {...details.register('email')} autoComplete="email" />
              </Field>

              <div className="space-y-1.5">
                <label className="flex items-start gap-3 text-base">
                  <input
                    type="checkbox"
                    {...details.register('acceptTerms')}
                    className="mt-0.5 size-6 shrink-0 rounded border-input accent-primary"
                    aria-invalid={Boolean(detailErrors.acceptTerms) || undefined}
                  />
                  <span>
                    I have read the{' '}
                    <Link href="/privacy" target="_blank" className="font-medium underline">
                      privacy notice<span className="sr-only"> (opens in a new tab)</span>
                    </Link>{' '}
                    and the{' '}
                    <Link href="/terms" target="_blank" className="font-medium underline">
                      terms<span className="sr-only"> (opens in a new tab)</span>
                    </Link>{' '}
                    and I accept them.
                  </span>
                </label>
                {detailErrors.acceptTerms?.message ? (
                  <p role="alert" className="text-sm font-medium text-destructive-text">
                    {detailErrors.acceptTerms.message}
                  </p>
                ) : null}
              </div>

              {/* Not disabled until the schema is satisfied. A button that is dead until every
                  field is right gives somebody nothing to press and no reason why; submitting and
                  being told which field is wrong is the kinder failure. */}
              <Button type="submit" size="lg" className="w-full" loading={start.isPending}>
                Send me a code
              </Button>
            </form>
          ) : null}

          {step === 1 ? (
            <form
              className="space-y-4"
              onSubmit={codeForm.handleSubmit((values) => verify.mutate(values))}
              noValidate
            >
              <Field
                label={`The ${CODE_LENGTH}-digit code`}
                hint={`Sent to ${phone}. It expires in ten minutes.`}
                error={codeErrors.code?.message}
              >
                <Input
                  {...codeForm.register('code')}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={CODE_LENGTH}
                  className="tabular text-lg tracking-[0.3em]"
                />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={verify.isPending}>
                Confirm my number
              </Button>

              <div className="flex flex-wrap items-center justify-between gap-x-4">
                <Button
                  type="button"
                  variant="link"
                  className="h-11 px-0"
                  onClick={() => resend.mutate()}
                  loading={resend.isPending}
                >
                  Send it again
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-11 px-0 text-muted-foreground"
                  onClick={() => {
                    setStep(0);
                    codeForm.reset();
                  }}
                >
                  Change the number
                </Button>
              </div>

              <p role="status" className="min-h-5 text-sm text-muted-foreground">
                {resent ? 'If that number can receive one, another code is on its way.' : ''}
              </p>
            </form>
          ) : null}

          {step === 2 ? (
            <form
              className="space-y-4"
              onSubmit={passwordForm.handleSubmit((values) => finish.mutate(values))}
              noValidate
            >
              <Field
                label="Password"
                hint={`At least ${MIN_PASSWORD} characters.`}
                error={passwordErrors.password?.message}
              >
                <PasswordInput {...passwordForm.register('password')} autoComplete="new-password" />
              </Field>

              {/* Typing it twice matters more here than it usually does: one typo on this field
                  is an account nobody can get back into without a reset. */}
              <Field label="Confirm password" error={passwordErrors.confirm?.message}>
                <PasswordInput {...passwordForm.register('confirm')} autoComplete="new-password" />
              </Field>

              {/* Asked here, with the account, because matching shows a practitioner to hospitals
                  from the first day. Recorded as consent, so it can be withdrawn from Privacy,
                  under My profile, later. */}
              {!forStaff ? (
                <label className="flex items-start gap-3 rounded-md border p-3 text-base leading-relaxed">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-6 shrink-0 accent-primary"
                    checked={sharing}
                    onChange={(event) => setSharing(event.target.checked)}
                    aria-describedby="sharing-help"
                  />
                  <span>
                    Show my verified credentials and profile to hospitals that are considering me
                    for shifts.{' '}
                    <span id="sharing-help" className="text-muted-foreground">
                      Needed to be offered work. You can withdraw it at any time from Privacy, under
                      My profile.
                    </span>
                  </span>
                </label>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={!forStaff && !sharing}
                loading={finish.isPending}
                aria-describedby={!forStaff && !sharing ? 'create-help' : undefined}
              >
                Create my account
              </Button>
              {!forStaff && !sharing ? (
                <p id="create-help" className="text-sm text-muted-foreground">
                  Tick the box above to continue: showing your profile to hospitals is what lets you
                  be offered shifts.
                </p>
              ) : null}

              <p role="status" className="min-h-5 text-sm text-muted-foreground">
                {finish.isPending ? 'Setting up your workspace — this takes a moment.' : ''}
              </p>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </AuthShell>
  );
}

/**
 * `useSearchParams` makes this page client-rendered, and Next refuses to
 * prerender one without a boundary to show while that happens — the
 * production build fails outright, which is how this was found. Development
 * never complains, so the page worked for months and could not have shipped.
 *
 * The fallback is the page's own background rather than a spinner. There is
 * nothing to wait for but the query string, so a spinner would flash for a
 * frame and read as slowness that is not there.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <RegisterForm />
    </Suspense>
  );
}
