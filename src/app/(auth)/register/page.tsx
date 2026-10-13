'use client';

import { Suspense, useState } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    .regex(/^[\d\s+()-]{10,}$/, "That does not look like a Nigerian mobile number."),
  email: z.union([z.literal(''), z.string().email('That email address is not valid.')]),
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

/**
 * One field's problem, under that field.
 *
 * `role="alert"` so a screen reader hears it when it appears rather than only
 * if the person happens to navigate back over the input.
 */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

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

  const details = useZodForm(detailsSchema, {
    defaultValues: { fullName: '', phone: '', email: '' },
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

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Medilink
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {forFacility
              ? "Register your facility's account"
              : forStaff
                ? 'Create your staff account'
                : 'Create an account'}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {forFacility
              ? "This is you, not the facility — the person who will manage it. Your hospital's own details come next, once this is done."
              : forStaff
                ? 'For people who work at a hospital, or for Medilink, already using the platform. Once your account exists, whoever manages access adds you from their Staff page.'
                : (
                  <>
                    For doctors, nurses and other practitioners looking for shifts. Representing a
                    hospital?{' '}
                    <Link href="/register?as=facility" className="font-medium text-foreground underline underline-offset-4">
                      Register it here
                    </Link>
                    .
                  </>
                )}
          </p>

          <ol className="mt-6 flex items-center gap-2" aria-label="Progress">
            {STEPS.map((label, index) => (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    index < step && 'bg-success text-success-foreground',
                    index === step && 'bg-primary text-primary-foreground',
                    index > step && 'bg-muted text-muted-foreground',
                  )}
                  aria-current={index === step ? 'step' : undefined}
                >
                  {index < step ? <Check className="size-3.5" /> : index + 1}
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
          <p className="mt-2 text-xs font-medium text-muted-foreground">{STEPS[step]}</p>

          <Card className="mt-4">
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
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName">Full name</Label>
                    <Input
                      id="fullName"
                      {...details.register('fullName')}
                      autoComplete="name"
                      placeholder="As it appears on your registration"
                      aria-invalid={Boolean(details.formState.errors.fullName) || undefined}
                    />
                    <FieldError message={details.formState.errors.fullName?.message} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone number</Label>
                    <Input
                      id="phone"
                      {...details.register('phone')}
                      placeholder="0803 123 4567"
                      autoComplete="tel"
                      inputMode="tel"
                      aria-invalid={Boolean(details.formState.errors.phone) || undefined}
                    />
                    <FieldError message={details.formState.errors.phone?.message} />
                    <p className="text-xs text-muted-foreground">
                      A Nigerian mobile number. The code comes here, and it is how you sign in.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email">
                      Email <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      {...details.register('email')}
                      autoComplete="email"
                      aria-invalid={Boolean(details.formState.errors.email) || undefined}
                    />
                    <FieldError message={details.formState.errors.email?.message} />
                    {/* Optional because recovery.ts makes the phone the only
                        recovery channel, and because nothing in the product
                        sends email yet. Saying so beats an unexplained
                        "(optional)" on a field people will wonder about. */}
                    <p className="text-xs text-muted-foreground">
                      Your phone is how you sign in and how you recover your account. Medilink does
                      not send email yet — an address here is kept on your record for when it does.
                    </p>
                  </div>

                  {/* Not disabled until the schema is satisfied. A button
                      that is dead until every field is right gives somebody
                      nothing to press and no reason why; submitting and being
                      told which field is wrong is the kinder failure. */}
                  <Button type="submit" className="w-full" loading={start.isPending}>
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
                  <div className="space-y-1.5">
                    <Label htmlFor="code">The {CODE_LENGTH}-digit code</Label>
                    <Input
                      id="code"
                      {...codeForm.register('code')}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={CODE_LENGTH}
                      className="tabular text-lg tracking-[0.3em]"
                      aria-invalid={Boolean(codeForm.formState.errors.code) || undefined}
                    />
                    <FieldError message={codeForm.formState.errors.code?.message} />
                    <p className="text-xs text-muted-foreground">
                      Sent to {phone}. It expires in ten minutes.
                    </p>
                  </div>

                  <Button type="submit" className="w-full" loading={verify.isPending}>
                    Confirm my number
                  </Button>

                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
                      onClick={() => resend.mutate()}
                      disabled={resend.isPending}
                    >
                      Send it again
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => {
                        setStep(0);
                        codeForm.reset();
                      }}
                    >
                      Change the number
                    </button>
                  </div>

                  {resent ? (
                    <p className="text-xs text-muted-foreground">
                      If that number can receive one, another code is on its way.
                    </p>
                  ) : null}
                </form>
              ) : null}

              {step === 2 ? (
                <form
                  className="space-y-4"
                  onSubmit={passwordForm.handleSubmit((values) => finish.mutate(values))}
                  noValidate
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      {...passwordForm.register('password')}
                      autoComplete="new-password"
                      aria-invalid={Boolean(passwordForm.formState.errors.password) || undefined}
                    />
                    <FieldError message={passwordForm.formState.errors.password?.message} />
                    <p className="text-xs text-muted-foreground">
                      At least {MIN_PASSWORD} characters.
                    </p>
                  </div>

                  {/* Typing it twice matters more here than it usually does:
                      there is no way to reset a password from the interface
                      yet, so one typo on this field is an account nobody can
                      get back into. */}
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm">Confirm password</Label>
                    <Input
                      id="confirm"
                      type="password"
                      {...passwordForm.register('confirm')}
                      autoComplete="new-password"
                      aria-invalid={Boolean(passwordForm.formState.errors.confirm) || undefined}
                    />
                    <FieldError message={passwordForm.formState.errors.confirm?.message} />
                  </div>

                  {/* Asked here, with the account, because matching shows a
                      practitioner to hospitals from the first day. Recorded as
                      consent, so it can be withdrawn from Privacy, under My profile, later. */}
                  {!forStaff ? (
                    <label className="flex items-start gap-3 rounded-md border p-3 text-sm leading-relaxed">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={sharing}
                        onChange={(event) => setSharing(event.target.checked)}
                      />
                      <span>
                        Show my verified credentials and profile to hospitals that are considering
                        me for shifts.{' '}
                        <span className="text-muted-foreground">
                          Needed to be offered work. You can withdraw it at any time from Privacy, under My profile.
                        </span>
                      </span>
                    </label>
                  ) : null}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!forStaff && !sharing}
                    loading={finish.isPending}
                  >
                    Create my account
                  </Button>

                  {finish.isPending ? (
                    <p className="text-xs text-muted-foreground">
                      Setting up your workspace — this takes a moment.
                    </p>
                  ) : null}
                </form>
              ) : null}
            </CardContent>
          </Card>

          <p className="mt-6 text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* What they are actually signing up to, said before they do it rather
          than discovered afterwards — a practitioner's eligibility card, or a
          facility's verification queue. */}
      <div className="hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-center">
        {forStaff ? <Building2 className="size-10 opacity-90" /> : <BadgeCheck className="size-10 opacity-90" />}
        <p className="mt-6 max-w-md text-2xl font-semibold leading-snug tracking-tight">
          {forFacility
            ? 'An account is the start. Your facility is next, and compliance verifies it before it can publish anything.'
            : forStaff
              ? 'An account is the start. Access comes from the person who manages it where you work.'
              : 'An account is the start. Verification is what gets you offered work.'}
        </p>
        <div className="mt-8 space-y-4 text-sm leading-relaxed text-primary-foreground/85">
          {forStaff && !forFacility ? (
            <>
              <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm">Your own sign-in, never a shared one</CardTitle>
                  <CardDescription className="text-primary-foreground/75">
                    Everything you do is recorded against your name, so nobody else can act as you
                    and nobody has to share a password.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm">Access is given, not chosen</CardTitle>
                  <CardDescription className="text-primary-foreground/75">
                    Once your account exists, your hospital&rsquo;s owner adds you from their Staff
                    page using your phone number. Until then the console tells you what to do next.
                  </CardDescription>
                </CardHeader>
              </Card>
            </>
          ) : forFacility ? (
            <>
              <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm">Your facility is checked against its CAC registration</CardTitle>
                  <CardDescription className="text-primary-foreground/75">
                    You can set it up and add colleagues straight away — it just cannot offer a
                    shift to anybody until compliance has confirmed it is real.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm">This account is yours, not the facility&rsquo;s</CardTitle>
                  <CardDescription className="text-primary-foreground/75">
                    You can grant access to colleagues once the facility exists, so this is not the
                    only login it will ever have.
                  </CardDescription>
                </CardHeader>
              </Card>
            </>
          ) : (
            <>
              <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm">You will be asked for your credentials</CardTitle>
                  <CardDescription className="text-primary-foreground/75">
                    Your registration and credentials are reviewed before you can be matched to a
                    shift. Until then your profile says exactly what is outstanding.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm">Nothing is hidden from you</CardTitle>
                  <CardDescription className="text-primary-foreground/75">
                    If you are not eligible, the reasons are listed by name. No one has to ring
                    support to find out why.
                  </CardDescription>
                </CardHeader>
              </Card>
            </>
          )}
        </div>
      </div>
    </main>
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
