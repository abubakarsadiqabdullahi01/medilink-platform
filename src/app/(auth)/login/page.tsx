'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/ui/api';
import { Button, Card, ErrorNote, Field, inputClass } from '@/components/ui/primitives';

/**
 * Sign in. The session is a cookie the API sets, so there is nothing to store
 * here and no token in local storage to leak.
 */
export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/auth/login', { phone, password });
      router.push('/admin');
      router.refresh();
    } catch (caught) {
      // The API says "those details are not right" without saying which,
      // because a message that distinguishes them is an account oracle.
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Medilink</p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Operations console</h1>

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <ErrorNote error={error} />

          <Field label="Phone number" hint="The number the account was registered with.">
            <input
              className={inputClass}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+2348031100001"
              autoComplete="username"
              inputMode="tel"
            />
          </Field>

          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>

          <Button type="submit" disabled={busy || !phone || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-xs text-muted">
        Locally, <code>scripts/bootstrap-demo.ts</code> creates the operations, compliance and
        administrator accounts. See <code>docs/end-to-end.md</code>.
      </p>
    </main>
  );
}
