'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Sign in. The session is a cookie the API sets, so there is nothing to store
 * here and no token in local storage to leak.
 */
export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useMutation({
    mutationFn: () => api.post('/api/v1/auth/login', { phone, password }),
    onSuccess: () => {
      router.push('/admin');
      router.refresh();
    },
  });

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Medilink
          </p>
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
                    <AlertDescription>{errorMessage(signIn.error)}</AlertDescription>
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
                  <Label htmlFor="password">Password</Label>
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

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Locally, <code className="rounded bg-muted px-1 py-0.5">bootstrap-demo.ts</code> creates
            the operations, compliance and administrator accounts. See{' '}
            <code className="rounded bg-muted px-1 py-0.5">docs/end-to-end.md</code>.
          </p>
        </div>
      </div>

      {/* A panel rather than a hero image: this is a tool, and the useful
          thing to say beside a login box is what the tool guarantees. */}
      <div className="hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-center">
        <ShieldCheck className="size-10 opacity-90" />
        <p className="mt-6 max-w-md text-2xl font-semibold leading-snug tracking-tight">
          Every decision on this platform has a name and a reason against it.
        </p>
        <div className="mt-8 space-y-4 text-sm leading-relaxed text-primary-foreground/85">
          <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
            <CardHeader className="p-4">
              <CardTitle className="text-sm">Nothing closes itself</CardTitle>
              <CardDescription className="text-primary-foreground/75">
                No shift is marked a no-show, no credential is approved and no dispute is resolved
                without a person deciding it.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/15 bg-white/10 text-primary-foreground shadow-none">
            <CardHeader className="p-4">
              <CardTitle className="text-sm">Nothing is overwritten</CardTitle>
              <CardDescription className="text-primary-foreground/75">
                A correction keeps what it replaced. A refused excusal stays on the record next to
                the one that was granted.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </main>
  );
}
