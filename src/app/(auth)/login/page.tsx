'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/ui/api';
import { consoleFor, type SessionState } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TextSizeControl } from '@/components/app/text-size-control';
import { Logo } from '@/components/app/logo';
import { AuthPanel } from '@/components/app/auth-panel';

/**
 * Sign in. The session is a cookie the API sets, so there is nothing to store
 * here and no token in local storage to leak.
 */
export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useMutation({
    mutationFn: async () => {
      await api.post('/api/v1/auth/login', { phone, password });
      return api.get<SessionState>('/api/v1/auth/session');
    },
    onSuccess: (session) => {
      router.replace(consoleFor(session));
      router.refresh();
    },
  });

  return (
    <main className="relative grid min-h-dvh lg:grid-cols-2">
      {/* Over the form's half, not over the teal panel beside it, where its dark text cannot be read. */}
      <TextSizeControl className="absolute right-3 top-3 z-10 lg:right-[calc(50%+0.75rem)]" />
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-8" />
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Verified healthcare workforce management.
          </p>

          <Card className="mt-6">
            <CardContent className="pt-6">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  signIn.mutate();
                }}
              >
                {signIn.isError ? (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertDescription>
                      {errorMessage(signIn.error)}
                      {signIn.error instanceof ApiError && signIn.error.failure.code === 'account_locked' ? (
                        <>
                          {' '}
                          <Link href="/forgot-password" className="font-medium underline underline-offset-4">
                            Reset your password
                          </Link>
                        </>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+234 803 000 0000"
                    autoComplete="username"
                    inputMode="tel"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  loading={signIn.isPending}
                  disabled={!phone || !password}
                >
                  Sign in
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="mt-6 text-sm text-muted-foreground">
            New to Medilink?{' '}
            <Link
              href="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create a practitioner account
            </Link>
          </p>

          <p className="mt-2 text-sm text-muted-foreground">
            Stuck?{' '}
            <Link href="/contact" className="font-medium text-primary underline-offset-4 hover:underline">
              Contact a person
            </Link>
            {' · '}
            <Link href="/terms" className="font-medium text-primary underline-offset-4 hover:underline">
              Terms
            </Link>
            {' · '}
            <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
              Privacy notice
            </Link>
          </p>

          <p className="mt-2 text-sm text-muted-foreground">
            Represent a hospital or clinic?{' '}
            <Link
              href="/register?as=facility"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Register your facility
            </Link>
          </p>

        </div>
      </div>

      {/* One thing to say beside a login box: what the tool guarantees. */}
      <AuthPanel>
        <ShieldCheck className="size-8 opacity-90" aria-hidden="true" />
        <p className="mt-5 max-w-md text-2xl font-semibold leading-snug tracking-tight">
          Every decision on this platform has a name and a reason against it.
        </p>
      </AuthPanel>
    </main>
  );
}
