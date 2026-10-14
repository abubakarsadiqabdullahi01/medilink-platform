'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/app/status-badge';
import { useStepUp } from '@/components/app/step-up';
import { formatDate } from '@/components/app/format';

interface AccountView {
  id: string;
  bankName: string;
  accountName: string;
  last4: string;
  status: string;
  createdAt: string;
  reviewNote: string | null;
}

interface Mine {
  verified: AccountView | null;
  pending: AccountView | null;
  refused: AccountView | null;
  readyAt: string | null;
}

/**
 * Where a practitioner is paid, as they see it (BIL-06).
 *
 * They give a bank, the name the account is held under and the number; a finance
 * officer checks it against the name they are registered under before anything is
 * paid to it. Only the last four digits are ever shown back: the whole number is for
 * finance to transfer to and is not on any screen of the person it belongs to. Giving
 * an account asks for the password again, because it is where their pay will go.
 */
export function MyPayoutAccount() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bankName: '', accountName: '', accountNumber: '' });
  const stepUp = useStepUp('Giving a bank account decides where your pay is sent.');

  const mine = useQuery({
    queryKey: ['my-payout-account'],
    queryFn: () => api.get<Mine>('/api/v1/me/payout-account'),
  });

  const submit = useMutation({
    mutationFn: () => api.post('/api/v1/me/payout-account', form),
    onSuccess: () => {
      toast.success('Account sent for checking', {
        description: 'Medilink will check it against your registered name, and text you when it has.',
      });
      setEditing(false);
      setForm({ bankName: '', accountName: '', accountNumber: '' });
      void queryClient.invalidateQueries({ queryKey: ['my-payout-account'] });
    },
    onError: (error) => {
      if (stepUp.handle(error, () => submit.mutate())) return;
      toast.error('Could not save it', { description: errorMessage(error) });
    },
  });

  const data = mine.data;
  const ready =
    form.bankName.trim().length > 0 &&
    form.accountName.trim().length >= 2 &&
    form.accountNumber.replace(/[\s-]/g, '').length === 10;
  const waitingUntil = data?.readyAt && new Date(data.readyAt) > new Date() ? new Date(data.readyAt) : null;

  return (
    <>
      {stepUp.dialog}
      <Card className="mb-8">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Landmark className="size-4" aria-hidden="true" />
            Where you are paid
          </CardTitle>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={mine.isPending}>
              {data?.verified || data?.pending ? 'Change account' : 'Add your account'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {mine.isError ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>Your payout account could not be loaded.</AlertDescription>
            </Alert>
          ) : null}

          {data && !data.verified && !data.pending ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                {data.refused ? (
                  <>
                    Your last account, ending <span className="font-mono">{data.refused.last4}</span>, could not
                    be verified{data.refused.reviewNote ? `: ${data.refused.reviewNote}` : '.'} Please give another.
                  </>
                ) : (
                  'You have not given a bank account yet. Nothing can be paid to you until you do and Medilink has checked it.'
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {data?.verified ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {data.verified.bankName} · <span className="font-mono">••••••{data.verified.last4}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {data.verified.accountName}
                  {waitingUntil
                    ? ` · Payments to this account can start from ${formatDate(waitingUntil)}.`
                    : ' · Payments go to this account.'}
                </p>
              </div>
              <StatusBadge status="VERIFIED" />
            </div>
          ) : null}

          {data?.pending ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {data.pending.bankName} · <span className="font-mono">••••••{data.pending.last4}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sent {formatDate(data.pending.createdAt)}. Medilink is checking it
                  {data.verified ? '; until it has, payments keep going to the account above.' : '.'}
                </p>
              </div>
              <StatusBadge status="PENDING" />
            </div>
          ) : null}

          {editing ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payout-bank">Bank</Label>
                  <Input
                    id="payout-bank"
                    value={form.bankName}
                    maxLength={80}
                    placeholder="Guaranty Trust Bank"
                    onChange={(event) => setForm({ ...form, bankName: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payout-number">Account number</Label>
                  <Input
                    id="payout-number"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={13}
                    value={form.accountNumber}
                    onChange={(event) => setForm({ ...form, accountNumber: event.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payout-name">Name on the account</Label>
                <Input
                  id="payout-name"
                  value={form.accountName}
                  maxLength={120}
                  onChange={(event) => setForm({ ...form, accountName: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Exactly as your bank holds it. It has to be your own account: one in somebody else&rsquo;s
                  name is refused unless Medilink is told why it is right.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!ready} loading={submit.isPending}>
                  Send for checking
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
