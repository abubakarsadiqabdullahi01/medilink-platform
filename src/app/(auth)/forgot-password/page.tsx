'use client';

import { useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useZodForm } from '@/lib/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TextSizeControl } from '@/components/app/text-size-control';
import { FieldError } from '@/components/app/field-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Getting back into an account: the phone number, the code that is sent to it,
 * and a new password.
 *
 * The API has had both halves since Stage 4. Nothing in the product reached
 * them, so the lockout message told people to reset their password and there
 * was nowhere to do it: a forgotten password was a locked-out nurse.
 *
 * What it says is deliberately the same whether or not the number has an
 * account. The server answers the request identically either way, and a screen
 * that said "no such number" would undo that.
 */

const MIN_PASSWORD = 10;
const CODE_LENGTH = 6;

const phoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, 'The number you sign in with.')
    .regex(/^[\d\s+()-]{10,}$/, 'That does not look like a Nigerian mobile number.'),
});

const resetSchema = z
  .object({
    code: z
      .string()
      .trim()
      .length(CODE_LENGTH, `The code is ${CODE_LENGTH} digits.`)
      .regex(/^\d+$/, 'Digits only.'),
    password: z.string().min(MIN_PASSWORD, `At least ${MIN_PASSWORD} characters.`),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    message: 'These two do not match.',
    path: ['confirm'],
  });

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'reset'>('phone');
  const [done, setDone] = useState(false);

  const phoneForm = useZodForm(phoneSchema, { defaultValues: { phone: '' } });
  const resetForm = useZodForm(resetSchema, {
    defaultValues: { code: '', password: '', confirm: '' },
  });
  // Carried to the second step rather than re-read from the first form, for the
  // same reason registration does: the API needs the number the code was sent to.
  const phone = phoneForm.getValues('phone');

  const request = useMutation({
    mutationFn: (values: z.infer<typeof phoneSchema>) =>
      api.post('/api/v1/auth/password/reset-request', { phone: values.phone }),
    onSuccess: () => setStep('reset'),
  });

  const confirm = useMutation({
    mutationFn: (values: z.infer<typeof resetSchema>) =>
      api.post('/api/v1/auth/password/reset-confirm', {
        phone,
        code: values.code,
        password: values.password,
      }),
    onSuccess: () => {
      setDone(true);
      // Every session was revoked, so the next thing to do is sign in.
      setTimeout(() => router.replace('/login'), 2500);
    },
  });

  const resend = useMutation({
    mutationFn: () => api.post('/api/v1/auth/resend-code', { phone, purpose: 'PASSWORD_RESET' }),
  });

  const failure = request.error ?? confirm.error ?? resend.error;

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-6 py-12">
      <TextSizeControl className="absolute right-3 top-3 z-10" />
      <div className="w-full max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Medilink
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {step === 'phone'
            ? 'Enter the number you sign in with. If it has an account, we will text it a code.'
            : 'Enter the code and choose a new password.'}
        </p>

        <Card className="mt-6">
          <CardContent className="pt-6">
            {failure ? (
              <Alert variant="destructive" className="mb-4">
                <TriangleAlert />
                <AlertDescription>{errorMessage(failure)}</AlertDescription>
              </Alert>
            ) : null}

            {done ? (
              <p role="status" className="text-sm">
                Your password has been changed and you have been signed out everywhere. Taking you
                to sign in…
              </p>
            ) : step === 'phone' ? (
              <form
                className="space-y-4"
                onSubmit={phoneForm.handleSubmit((values) => request.mutate(values))}
                noValidate
              >
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input
                    id="phone"
                    {...phoneForm.register('phone')}
                    placeholder="0803 123 4567"
                    autoComplete="username"
                    inputMode="tel"
                    aria-invalid={Boolean(phoneForm.formState.errors.phone) || undefined}
                  />
                  <FieldError message={phoneForm.formState.errors.phone?.message} />
                </div>
                <Button type="submit" className="w-full" loading={request.isPending}>
                  Send me a code
                </Button>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={resetForm.handleSubmit((values) => confirm.mutate(values))}
                noValidate
              >
                <div className="space-y-1.5">
                  <Label htmlFor="code">The {CODE_LENGTH}-digit code</Label>
                  <Input
                    id="code"
                    {...resetForm.register('code')}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={CODE_LENGTH}
                    className="tabular text-lg tracking-[0.3em]"
                    aria-invalid={Boolean(resetForm.formState.errors.code) || undefined}
                  />
                  <FieldError message={resetForm.formState.errors.code?.message} />
                  <p className="text-xs text-muted-foreground">
                    If {phone} has an account, a code is on its way. It expires in ten minutes.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    {...resetForm.register('password')}
                    autoComplete="new-password"
                    aria-invalid={Boolean(resetForm.formState.errors.password) || undefined}
                  />
                  <FieldError message={resetForm.formState.errors.password?.message} />
                  <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    {...resetForm.register('confirm')}
                    autoComplete="new-password"
                    aria-invalid={Boolean(resetForm.formState.errors.confirm) || undefined}
                  />
                  <FieldError message={resetForm.formState.errors.confirm?.message} />
                </div>

                <Button type="submit" className="w-full" loading={confirm.isPending}>
                  Change my password
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
                      setStep('phone');
                      resetForm.reset();
                    }}
                  >
                    Change the number
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
