'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useZodForm } from '@/lib/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AuthLink, AuthShell } from '@/components/app/auth-shell';
import { Field } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';

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
    // Every session was revoked, so the next thing to do is sign in. It is a link, not a timer:
    // a message that vanishes after two seconds is gone before a slow reader, or a screen
    // reader, has finished it.
    onSuccess: () => setDone(true),
  });

  const resend = useMutation({
    mutationFn: () => api.post('/api/v1/auth/resend-code', { phone, purpose: 'PASSWORD_RESET' }),
  });

  // Moving to the second step removes the button that was just pressed. Without this, focus falls
  // to the top of the document and a keyboard or screen-reader user starts again from the logo.
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) heading.current?.focus();
    mounted.current = true;
  }, [step]);

  const failure = request.error ?? confirm.error ?? resend.error;

  const { errors: phoneErrors } = phoneForm.formState;
  const { errors: resetErrors } = resetForm.formState;

  return (
    <AuthShell
      title="Reset your password"
      description={
        step === 'phone'
          ? 'Enter the number you sign in with. If it has an account, we will text it a code.'
          : 'Enter the code and choose a new password.'
      }
      footer={
        <p>
          Remembered it? <AuthLink href="/login">Sign in</AuthLink>
        </p>
      }
    >
      <Card>
        <CardContent className="pt-6">
          <h2 ref={heading} tabIndex={-1} className="sr-only">
            {done
              ? 'Password changed'
              : step === 'phone'
                ? 'Step 1 of 2: your number'
                : 'Step 2 of 2: the code and a new password'}
          </h2>

          {failure ? (
            <Alert variant="destructive" className="mb-4">
              <TriangleAlert />
              <AlertDescription>{errorMessage(failure)}</AlertDescription>
            </Alert>
          ) : null}

          {done ? (
            <div role="status" className="space-y-4">
              <p className="leading-relaxed">
                Your password has been changed and you have been signed out everywhere. Sign in with
                the new one.
              </p>
              <Button asChild size="lg" className="w-full">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          ) : step === 'phone' ? (
            <form
              className="space-y-4"
              onSubmit={phoneForm.handleSubmit((values) => request.mutate(values))}
              noValidate
            >
              <Field
                label="Phone number"
                hint="For example 0803 123 4567"
                error={phoneErrors.phone?.message}
              >
                <Input
                  {...phoneForm.register('phone')}
                  placeholder="0803 123 4567"
                  autoComplete="username"
                  inputMode="tel"
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={request.isPending}>
                Send me a code
              </Button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={resetForm.handleSubmit((values) => confirm.mutate(values))}
              noValidate
            >
              <Field
                label={`The ${CODE_LENGTH}-digit code`}
                hint={`If ${phone} has an account, a code is on its way. It expires in ten minutes.`}
                error={resetErrors.code?.message}
              >
                <Input
                  {...resetForm.register('code')}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={CODE_LENGTH}
                  className="tabular text-lg tracking-[0.3em]"
                />
              </Field>

              <Field
                label="New password"
                hint={`At least ${MIN_PASSWORD} characters.`}
                error={resetErrors.password?.message}
              >
                <PasswordInput {...resetForm.register('password')} autoComplete="new-password" />
              </Field>

              <Field label="Confirm new password" error={resetErrors.confirm?.message}>
                <PasswordInput {...resetForm.register('confirm')} autoComplete="new-password" />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={confirm.isPending}>
                Change my password
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
                    setStep('phone');
                    resetForm.reset();
                  }}
                >
                  Change the number
                </Button>
              </div>
              <p role="status" className="min-h-5 text-sm text-muted-foreground">
                {resend.isSuccess
                  ? 'If that number can receive one, another code is on its way.'
                  : ''}
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
