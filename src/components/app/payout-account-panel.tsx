'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, Landmark, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { useStepUp } from '@/components/app/step-up';
import { formatDate, formatWhen } from '@/components/app/format';

export type AccountState = 'not_required' | 'ready' | 'missing' | 'unverified' | 'cooling_off';

type Problem = 'name_mismatch' | 'account_reused';

interface OfficerAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  last4: string;
  status: string;
  createdAt: string;
  problems: Problem[];
}

const PROBLEM_TEXT: Record<Problem, string> = {
  name_mismatch: 'The name on the account does not match the name they are registered under.',
  account_reused: 'Another practitioner has given this same account.',
};

const STANDING: Record<AccountState, { tone: 'warning' | 'info'; text: string }> = {
  missing: {
    tone: 'warning',
    text: 'They have not given a bank account, so a payout cannot be prepared. They can add one from their Earnings page.',
  },
  unverified: {
    tone: 'warning',
    text: 'They have given an account that nobody has checked yet. Show it, check it against the bank, then verify it. A payout cannot be prepared until you do.',
  },
  cooling_off: {
    tone: 'info',
    text: 'Their account was added recently, and nothing is paid to a new account for a while after it is added. The date is below.',
  },
  ready: { tone: 'info', text: 'A verified account is on file.' },
  not_required: {
    tone: 'info',
    text: 'This platform is set to pay without requiring a verified account.',
  },
};

/**
 * Where to pay a practitioner, for the finance officer (BIL-06).
 *
 * The whole number is not shown until it is asked for, and asking is what asks for
 * the password again and is written to the audit trail: it is the one place in the
 * product that opens it, to show where to make the transfer. Verifying is the check
 * a payout rests on: the name on the account against the name they are registered
 * under, and whether anybody else has given the same account. When either is wrong
 * the officer has to say, in words, why it is the right account anyway.
 */
export function PayoutAccountPanel({
  practitionerId,
  standing,
  readyAt,
}: {
  practitionerId: string;
  standing: AccountState | undefined;
  readyAt: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [details, setDetails] = useState<{ practitionerName: string; accounts: OfficerAccount[] } | null>(null);
  const [deciding, setDeciding] = useState<{ account: OfficerAccount; decision: 'verify' | 'reject' } | null>(null);
  const [text, setText] = useState('');
  const stepUp = useStepUp('Showing and checking a bank account is part of moving money.');

  function changed() {
    setDetails(null);
    void queryClient.invalidateQueries({ queryKey: ['payouts'] });
    void queryClient.invalidateQueries({ queryKey: ['payout-accounts'] });
  }

  const reveal = useMutation({
    mutationFn: () =>
      api.get<{ practitionerName: string; accounts: OfficerAccount[] }>(
        `/api/v1/payout-accounts/practitioner/${practitionerId}`,
      ),
    onSuccess: setDetails,
    onError: (error) => {
      if (stepUp.handle(error, () => reveal.mutate())) return;
      toast.error('Could not show it', { description: errorMessage(error) });
    },
  });

  const decide = useMutation({
    mutationFn: ({ account, decision }: { account: OfficerAccount; decision: 'verify' | 'reject' }) =>
      api.post(`/api/v1/payout-accounts/${account.id}/review`, {
        decision,
        ...(decision === 'reject' ? { note: text.trim() } : { overrideReason: text.trim() || undefined }),
      }),
    onSuccess: (_data, { decision }) => {
      toast.success(decision === 'verify' ? 'Verified' : 'Refused', {
        description: 'The practitioner has been told.',
      });
      setDeciding(null);
      setText('');
      changed();
    },
    onError: (error, variables) => {
      if (stepUp.handle(error, () => decide.mutate(variables))) return;
      toast.error('Could not do that', { description: errorMessage(error) });
    },
  });

  const wait = readyAt && new Date(readyAt) > new Date() ? new Date(readyAt) : null;
  const note = standing ? STANDING[standing] : null;
  const needsReason = deciding?.decision === 'verify' && deciding.account.problems.length > 0;
  const canConfirm = deciding?.decision === 'reject' ? text.trim().length > 0 : !needsReason || text.trim().length >= 10;

  return (
    <>
      {stepUp.dialog}
      <Dialog
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeciding(null);
            setText('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deciding?.decision === 'reject' ? 'Refuse this account' : 'Verify this account'}
            </DialogTitle>
            <DialogDescription>
              {deciding?.decision === 'reject'
                ? 'The practitioner is sent your reason, and can give another account.'
                : 'Check the account number and name with the bank first. From now on payouts go to this account.'}
            </DialogDescription>
          </DialogHeader>
          {needsReason && deciding ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {deciding.account.problems.map((problem) => (
                    <li key={problem}>{PROBLEM_TEXT[problem]}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {deciding?.decision === 'reject' || needsReason ? (
            <div className="space-y-1.5">
              <Label htmlFor="account-reason">
                {deciding?.decision === 'reject' ? 'Why is it being refused?' : 'Why is it still the right account?'}
              </Label>
              <Textarea
                id="account-reason"
                value={text}
                rows={3}
                maxLength={500}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Back
            </Button>
            <Button
              variant={deciding?.decision === 'reject' ? 'destructive' : 'success'}
              disabled={!canConfirm}
              loading={decide.isPending}
              onClick={() => deciding && decide.mutate(deciding)}
            >
              {deciding?.decision === 'reject' ? 'Refuse account' : 'Verify account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Landmark className="size-4" aria-hidden="true" />
            Where to pay them
          </CardTitle>
          <Button variant="outline" size="sm" loading={reveal.isPending} onClick={() => reveal.mutate()}>
            <Eye />
            Show account details
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {note ? (
            <Alert variant={note.tone}>
              <AlertDescription>
                {note.text}
                {standing === 'cooling_off' && wait ? ` Payouts can go to it from ${formatWhen(wait.toISOString())}.` : ''}
              </AlertDescription>
            </Alert>
          ) : null}

          {details ? (
            details.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">They have given no account.</p>
            ) : (
              details.accounts.map((account) => (
                <div key={account.id} className="space-y-3 rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{account.bankName}</p>
                      <p className="mt-1 font-mono text-lg tracking-wide">{account.accountNumber}</p>
                      <p className="mt-1 text-sm">{account.accountName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Registered as {details.practitionerName} · given {formatDate(account.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={account.status} />
                  </div>

                  {account.problems.length > 0 ? (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4">
                          {account.problems.map((problem) => (
                            <li key={problem}>{PROBLEM_TEXT[problem]}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {account.status === 'PENDING' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="success" onClick={() => setDeciding({ account, decision: 'verify' })}>
                        Verify
                      </Button>
                      <Button variant="outline" onClick={() => setDeciding({ account, decision: 'reject' })}>
                        Refuse
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              The number is not shown until you ask, and each time you do is recorded.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
