'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, Check, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
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

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [resent, setResent] = useState(false);

  // Only once they have typed something to compare — flagging a mismatch
  // against an empty box is telling somebody off for not having finished.
  const mismatch = confirm.length > 0 && confirm !== password;

  const start = useMutation({
    mutationFn: () =>
      api.post('/api/v1/auth/register', {
        phone,
        fullName,
        email: email.trim() || undefined,
      }),
    onSuccess: () => setStep(1),
  });

  const verify = useMutation({
    mutationFn: () => api.post('/api/v1/auth/verify-phone', { phone, code }),
    onSuccess: () => setStep(2),
  });

  const resend = useMutation({
    mutationFn: () =>
      api.post('/api/v1/auth/resend-code', { phone, purpose: 'PHONE_VERIFICATION' }),
    onSuccess: () => setResent(true),
  });

  const finish = useMutation({
    mutationFn: async () => {
      await api.post('/api/v1/auth/set-password', { phone, password });
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
      for (let attempt = 0; attempt < 8 && session.grants.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        session = await api.get<SessionState>('/api/v1/auth/session');
      }
      return session;
    },
    onSuccess: (session) => {
      router.replace(consoleFor(session));
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Create an account</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            For practitioners. Facility and operations access is granted by Medilink once your
            organisation is onboarded.
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
                  onSubmit={(event) => {
                    event.preventDefault();
                    start.mutate();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName">Full name</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      autoComplete="name"
                      placeholder="As it appears on your registration"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone number</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="0803 123 4567"
                      autoComplete="tel"
                      inputMode="tel"
                    />
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
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                    />
                    {/* Optional because recovery.ts makes the phone the only
                        recovery channel, and because nothing in the product
                        sends email yet. Saying so beats an unexplained
                        "(optional)" on a field people will wonder about. */}
                    <p className="text-xs text-muted-foreground">
                      Your phone is how you sign in and how you recover your account. Medilink does
                      not send email yet — an address here is kept on your record for when it does.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    loading={start.isPending}
                    disabled={fullName.trim().length < 2 || !phone}
                  >
                    Send me a code
                  </Button>
                </form>
              ) : null}

              {step === 1 ? (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    verify.mutate();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="code">The {CODE_LENGTH}-digit code</Label>
                    <Input
                      id="code"
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                      }
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="tabular text-lg tracking-[0.3em]"
                    />
                    <p className="text-xs text-muted-foreground">
                      Sent to {phone}. It expires in ten minutes.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    loading={verify.isPending}
                    disabled={code.length !== CODE_LENGTH}
                  >
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
                        setCode('');
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
                  onSubmit={(event) => {
                    event.preventDefault();
                    finish.mutate();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                    />
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
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      autoComplete="new-password"
                      aria-invalid={mismatch || undefined}
                      aria-describedby={mismatch ? 'confirm-problem' : undefined}
                    />
                    {mismatch ? (
                      <p id="confirm-problem" className="text-xs text-destructive">
                        These two do not match.
                      </p>
                    ) : null}
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    loading={finish.isPending}
                    disabled={password.length < MIN_PASSWORD || confirm !== password}
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

      {/* What a practitioner is actually signing up to, said before they do it
          rather than discovered on the eligibility card afterwards. */}
      <div className="hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-center">
        <BadgeCheck className="size-10 opacity-90" />
        <p className="mt-6 max-w-md text-2xl font-semibold leading-snug tracking-tight">
          An account is the start. Verification is what gets you offered work.
        </p>
        <div className="mt-8 space-y-4 text-sm leading-relaxed text-primary-foreground/85">
          <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
            <CardHeader className="p-4">
              <CardTitle className="text-sm">You will be asked for your credentials</CardTitle>
              <CardDescription className="text-primary-foreground/75">
                Your registration and credentials are reviewed before you can be matched to a shift.
                Until then your profile says exactly what is outstanding.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
            <CardHeader className="p-4">
              <CardTitle className="text-sm">Nothing is hidden from you</CardTitle>
              <CardDescription className="text-primary-foreground/75">
                If you are not eligible, the reasons are listed by name. No one has to ring support
                to find out why.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </main>
  );
}
