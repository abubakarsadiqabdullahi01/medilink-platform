'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** The server's answer when a permission needs the password re-entered (step 4.8). */
export function isStepUpRequired(error: unknown): boolean {
  return error instanceof ApiError && error.failure.code === 'step_up_required';
}

/**
 * Re-entering the password before a sensitive action.
 *
 * The server has refused `role.grant` and `payout.account.change` without a
 * fresh step-up since Stage 4.8, and no screen could supply one, so both
 * permissions were unusable from the consoles. This is the one place that
 * asks; the caller decides what to retry once it succeeds.
 */
export function StepUpDialog({
  open,
  onOpenChange,
  onConfirmed,
  purpose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
  purpose: string;
}) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: () => api.post('/api/v1/auth/step-up', { password }),
    onSuccess: () => {
      setPassword('');
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      onOpenChange(false);
      onConfirmed();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPassword('');
          setFailure(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="size-4" aria-hidden="true" />
            Confirm it is you
          </DialogTitle>
          <DialogDescription>
            {purpose} Enter your password to continue. You will not be asked again for a few
            minutes.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (password) confirm.mutate();
          }}
        >
          <Label htmlFor="step-up-password">Password</Label>
          <Input
            id="step-up-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {failure ? (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          ) : null}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!password} loading={confirm.isPending}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
