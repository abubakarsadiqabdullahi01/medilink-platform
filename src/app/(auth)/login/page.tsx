'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/ui/api';
import { consoleFor, type SessionState } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AuthLink, AuthShell } from '@/components/app/auth-shell';
import { Field } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';

/**
 * Sign in. The session is a cookie the API sets, so there is nothing to store
 * here and no token in local storage to leak.
 *
 * The button is never dead. A person who has typed a number and not yet a password
 * is told which one is missing when they press it, beside the field, rather than
 * left to work out why a faded button will not respond.
 */
interface Values {
  phone: string;
  password: string;
}

/*
 * Two required fields, so the rules are written here rather than as a Zod schema: the validator
 * is a quarter of what the sign-in page would otherwise download, on the page that every
 * visitor, on every connection, has to load first.
 */
const MISSING_PHONE = 'Enter the phone number you sign in with.';
const MISSING_PASSWORD = 'Enter your password.';

export default function LoginPage() {
  const router = useRouter();
  const form = useForm<Values>({ defaultValues: { phone: '', password: '' }, mode: 'onTouched' });
  const [failedOnce, setFailedOnce] = useState(false);

  const signIn = useMutation({
    mutationFn: async (values: Values) => {
      await api.post('/api/v1/auth/login', { phone: values.phone, password: values.password });
      return api.get<SessionState>('/api/v1/auth/session');
    },
    onSuccess: (session) => {
      router.replace(consoleFor(session));
      router.refresh();
    },
    onError: () => setFailedOnce(true),
  });

  const { errors } = form.formState;

  return (
    <AuthShell
      title="Sign in"
      description="One sign-in for practitioners, facility staff and Medilink staff. Your workspace opens according to your account."
      aside={{
        icon: ShieldCheck,
        summary: 'About Medilink',
        headline: 'Every decision on this platform has a name and a reason against it.',
        points: [
          {
            title: 'Nothing closes itself',
            description:
              'No shift is marked a no-show, no credential is approved and no dispute is resolved without a person deciding it.',
          },
          {
            title: 'Nothing is overwritten',
            description:
              'A correction keeps what it replaced. A refused excusal stays on the record next to the one that was granted.',
          },
        ],
      }}
      footer={
        <>
          <p>
            New to Medilink? <AuthLink href="/register">Create a practitioner account</AuthLink>
          </p>
          <p>
            Represent a hospital or clinic?{' '}
            <AuthLink href="/register?as=facility">Register your facility</AuthLink>
          </p>
          <p>
            Work at a facility already on Medilink?{' '}
            <AuthLink href="/register?as=staff">Create a staff account</AuthLink>
          </p>
          <p>
            Stuck? <AuthLink href="/contact">Contact a person</AuthLink>
            {' · '}
            <AuthLink href="/terms">Terms</AuthLink>
            {' · '}
            <AuthLink href="/privacy">Privacy notice</AuthLink>
          </p>
        </>
      }
    >
      <Card>
        <CardContent className="pt-6">
          <form
            className="space-y-4"
            noValidate
            onSubmit={form.handleSubmit((values) =>
              signIn.mutate({ phone: values.phone.trim(), password: values.password }),
            )}
          >
            {signIn.isError ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>
                  {errorMessage(signIn.error)}
                  {signIn.error instanceof ApiError &&
                  signIn.error.failure.code === 'account_locked' ? (
                    <>
                      {' '}
                      <AuthLink href="/forgot-password">Reset your password</AuthLink>
                    </>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <Field
              label="Phone number"
              hint="For example 0803 123 4567"
              error={errors.phone?.message}
            >
              <Input
                {...form.register('phone', {
                  validate: (value) => value.trim().length > 0 || MISSING_PHONE,
                })}
                autoComplete="username"
                inputMode="tel"
                placeholder="0803 123 4567"
              />
            </Field>

            <Field label="Password" error={errors.password?.message}>
              <PasswordInput
                {...form.register('password', { required: MISSING_PASSWORD })}
                autoComplete="current-password"
              />
            </Field>

            <Button type="submit" size="lg" className="w-full" loading={signIn.isPending}>
              Sign in
            </Button>

            {/* The way out is offered at the moment it is needed, not only as a small link above. */}
            <p className={failedOnce ? 'text-base font-medium' : 'text-base'}>
              <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
