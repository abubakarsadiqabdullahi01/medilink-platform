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
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { StatusBadge } from '@/components/app/status-badge';
import { ErrorState } from '@/components/app/states';
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

type FieldName = 'bankName' | 'accountName' | 'accountNumber';

const EMPTY = { bankName: '', accountName: '', accountNumber: '' };

/** What the application checks before it accepts an account, said before it has to refuse one. */
function problems(form: typeof EMPTY): Partial<Record<FieldName, string>> {
  const found: Partial<Record<FieldName, string>> = {};
  if (form.bankName.trim().length === 0) found.bankName = 'Enter the name of your bank.';
  if (form.accountName.trim().length < 2) {
    found.accountName = 'Enter the name exactly as your bank holds it.';
  }
  if (form.accountNumber.replace(/[\s-]/g, '').length !== 10) {
    found.accountNumber = 'An account number has 10 digits.';
  }
  return found;
}

/**
 * Where a practitioner is paid, as they see it (BIL-06).
 *
 * They give a bank, the name the account is held under and the number; a finance officer checks
 * it against the name they are registered under before anything is paid to it. Only the last four
 * digits are ever shown back: the whole number is for finance to transfer to and is not on any
 * screen of the person it belongs to.
 *
 * This is where their pay will go, so giving an account is a review and not a click: what was
 * entered is read back with the number masked, and what happens to the account that is paid
 * today is said before anything is sent. The password is asked for again after that, because a
 * session left open on a stolen laptop is what is used to change this.
 */
export function MyPayoutAccount() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  // Errors appear once somebody has tried to send, then follow what they type. Not on blur: an error
  // appearing under a field the moment the finger leaves it moves the button the finger was heading
  // for, and the tap misses.
  const [attempted, setAttempted] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const stepUp = useStepUp('Giving a bank account decides where your pay is sent.');

  const mine = useQuery({
    queryKey: ['my-payout-account'],
    queryFn: () => api.get<Mine>('/api/v1/me/payout-account'),
  });

  const submit = useMutation({
    mutationFn: () => api.post('/api/v1/me/payout-account', form),
    onSuccess: () => {
      toast.success('Account sent for checking', {
        description:
          'Medilink will check it against your registered name, and text you when it has.',
      });
      setEditing(false);
      setForm(EMPTY);
      setAttempted(false);
      void queryClient.invalidateQueries({ queryKey: ['my-payout-account'] });
    },
    // What was typed stays where it is: a refusal is corrected, not entered again.
    onError: (error) => {
      if (stepUp.handle(error, () => submit.mutate())) return;
      toast.error('Could not save it', { description: errorMessage(error) });
    },
  });

  const data = mine.data;
  const found = problems(form);
  const shown = (name: FieldName) => (attempted ? found[name] : undefined);
  const waitingUntil =
    data?.readyAt && new Date(data.readyAt) > new Date() ? new Date(data.readyAt) : null;
  const last4 = form.accountNumber.replace(/[\s-]/g, '').slice(-4);

  function review() {
    setAttempted(true);
    if (Object.keys(found).length === 0) setReviewing(true);
  }

  return (
    <>
      {stepUp.dialog}
      <Card className="mb-8">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4" aria-hidden="true" />
            Where you are paid
          </CardTitle>
          {!editing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={mine.isPending}
            >
              {data?.verified || data?.pending ? 'Change account' : 'Add your account'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {mine.isError ? (
            <ErrorState
              error={mine.error}
              onRetry={() => void mine.refetch()}
              retrying={mine.isFetching}
              compact
            />
          ) : null}

          {data && !data.verified && !data.pending ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                {data.refused ? (
                  <>
                    Your last account, ending{' '}
                    <span className="font-mono">{data.refused.last4}</span>, could not be verified
                    {data.refused.reviewNote ? `: ${data.refused.reviewNote}` : '.'} Please give
                    another.
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
                  {data.verified.bankName} ·{' '}
                  <span className="font-mono">••••••{data.verified.last4}</span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
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
                  {data.pending.bankName} ·{' '}
                  <span className="font-mono">••••••{data.pending.last4}</span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Sent {formatDate(data.pending.createdAt)}. Medilink is checking it
                  {data.verified
                    ? '; until it has, payments keep going to the account above.'
                    : '.'}
                </p>
              </div>
              <StatusBadge status="PENDING" />
            </div>
          ) : null}

          {editing ? (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                review();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bank" error={shown('bankName')} required>
                  <Input
                    value={form.bankName}
                    maxLength={80}
                    placeholder="Guaranty Trust Bank"
                    autoComplete="off"
                    onChange={(event) => setForm({ ...form, bankName: event.target.value })}
                  />
                </Field>
                <Field
                  label="Account number"
                  hint="The 10-digit NUBAN number, for example 0123456789."
                  error={shown('accountNumber')}
                  required
                >
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={13}
                    value={form.accountNumber}
                    onChange={(event) => setForm({ ...form, accountNumber: event.target.value })}
                  />
                </Field>
              </div>
              <Field
                label="Name on the account"
                hint="Exactly as your bank holds it. It has to be your own account: one in somebody else’s name is refused unless Medilink is told why it is right."
                error={shown('accountName')}
                required
              >
                <Input
                  value={form.accountName}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(event) => setForm({ ...form, accountName: event.target.value })}
                />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" loading={submit.isPending}>
                  Review before sending
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                    setForm(EMPTY);
                    setAttempted(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={reviewing}
        onOpenChange={setReviewing}
        title="Check this account before it is sent"
        object={`${form.bankName.trim()} · ••••••${last4} · ${form.accountName.trim()}`}
        consequence={
          <>
            A finance officer checks it against the name you are registered under before anything is
            paid to it, and there is a short wait after you give a new account before a payment can
            go to it.{' '}
            {data?.verified ? (
              <>
                Until then, payments keep going to your current account ending{' '}
                <span className="font-mono">{data.verified.last4}</span>.
              </>
            ) : (
              'Nothing can be paid to you until it has been checked.'
            )}
          </>
        }
        reversible="Giving another account before this one is checked replaces it."
        confirmLabel="Send for checking"
        cancelLabel="Go back and edit"
        onConfirm={() => {
          // Closed first: if the password is asked for, that dialog has the screen to itself, and
          // the form behind keeps what was typed whichever way this goes.
          setReviewing(false);
          submit.mutate();
        }}
      />
    </>
  );
}
