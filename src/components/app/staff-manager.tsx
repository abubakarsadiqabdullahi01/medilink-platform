'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, LockKeyhole, Search, TriangleAlert, UserPlus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, ApiError, errorMessage } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, QueueSkeleton } from '@/components/app/page-shell';
import { StatusBadge } from '@/components/app/status-badge';
import { StepUpDialog, isStepUpRequired } from '@/components/app/step-up';
import { formatDate } from '@/components/app/format';

export interface StaffRole {
  key: string;
  label: string;
  description: string;
}

interface Grant {
  id: string;
  userId: string;
  fullName: string;
  roleKey: string;
  grantedAt: string;
  revokedAt: string | null;
}

interface FoundUser {
  id: string;
  fullName: string;
  phone: string;
  status: string;
}

const MIN_REVOKE_REASON = 5;

/**
 * Who has access to a facility, or to the platform, and changing it.
 *
 * Granting and revoking were API-only since Stage 4. That left an owner with
 * no way to add the colleague who runs the rota, and every platform
 * appointment needing somebody at a terminal. The rules all stay on the
 * server — nobody can grant what they do not hold, the last super
 * administrator cannot be removed — so this screen only has to ask, show the
 * answer, and make each role's reach plain before anybody picks it.
 *
 * Every call here needs a freshly re-entered password, so the list itself
 * sits behind one.
 */
export function StaffManager({
  scopeType,
  scopeId,
  roles,
  signupPath,
}: {
  scopeType: 'FACILITY' | 'PLATFORM';
  scopeId?: string;
  roles: StaffRole[];
  signupPath: string;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const scope = `scopeType=${scopeType}${scopeId ? `&scopeId=${scopeId}` : ''}`;
  const queueKey = ['staff', scopeType, scopeId ?? 'platform'];

  const [stepUpOpen, setStepUpOpen] = useState(false);
  const retry = useRef<(() => void) | null>(null);

  /** Runs `action`; if the server wants the password first, asks and runs it again. */
  function guarded(action: () => void) {
    retry.current = action;
    action();
  }

  function onFailure(error: unknown, title: string) {
    if (isStepUpRequired(error)) {
      setStepUpOpen(true);
      return;
    }
    toast.error(title, { description: errorMessage(error) });
  }

  const grants = useQuery({
    queryKey: queueKey,
    queryFn: () => api.get<{ grants: Grant[] }>(`/api/v1/grants?${scope}`),
    retry: false,
  });

  const labelOf = (key: string) => roles.find((role) => role.key === key)?.label ?? key;
  const live = (grants.data?.grants ?? []).filter(
    (grant) => !grant.revokedAt && roles.some((role) => role.key === grant.roleKey),
  );
  const past = (grants.data?.grants ?? []).filter(
    (grant) => grant.revokedAt && roles.some((role) => role.key === grant.roleKey),
  );

  // ---- adding somebody
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<FoundUser | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [roleKey, setRoleKey] = useState<string>(roles[0]?.key ?? '');

  const find = useMutation({
    mutationFn: () =>
      api.get<FoundUser>(`/api/v1/grants/find?${scope}&phone=${encodeURIComponent(phone.trim())}`),
    onSuccess: (user) => {
      setFound(user);
      setNotFound(false);
    },
    onError: (error) => {
      setFound(null);
      if (error instanceof ApiError && error.failure.code === 'user_not_found') {
        setNotFound(true);
        return;
      }
      onFailure(error, 'Could not look that number up');
    },
  });

  const grant = useMutation({
    mutationFn: () =>
      api.post('/api/v1/grants', { userId: found?.id, roleKey, scopeType, scopeId }),
    onSuccess: () => {
      toast.success(`${found?.fullName ?? 'They'} now has access`, {
        description: `As ${labelOf(roleKey).toLowerCase()}. It applies from their next page load.`,
      });
      setPhone('');
      setFound(null);
      void queryClient.invalidateQueries({ queryKey: queueKey });
    },
    onError: (error) => onFailure(error, 'Could not give access'),
  });

  // ---- removing somebody
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [reason, setReason] = useState('');

  const revoke = useMutation({
    mutationFn: (target: Grant) =>
      api.post(`/api/v1/grants/${target.id}/revoke`, { scopeType, scopeId, reason: reason.trim() }),
    onSuccess: (_data, target) => {
      toast.success(`${target.fullName} no longer has access as ${labelOf(target.roleKey).toLowerCase()}`);
      setRevoking(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: queueKey });
    },
    onError: (error) => onFailure(error, 'Could not remove access'),
  });

  const locked = grants.isError && isStepUpRequired(grants.error);

  return (
    <div className="space-y-6">
      <StepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        purpose="Changing who has access is protected."
        onConfirmed={() => {
          void queryClient.invalidateQueries({ queryKey: queueKey });
          retry.current?.();
          retry.current = null;
        }}
      />

      {locked ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <LockKeyhole className="size-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">Confirm your password to manage staff</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Who can act for this {scopeType === 'FACILITY' ? 'facility' : 'platform'} is the
                most sensitive setting there is, so it is behind your password.
              </p>
            </div>
            <Button
              onClick={() => {
                retry.current = null;
                setStepUpOpen(true);
              }}
            >
              <LockKeyhole />
              Confirm password
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <UserPlus className="size-4 text-muted-foreground" aria-hidden="true" />
                Give someone access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (phone.trim()) guarded(() => find.mutate());
                }}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="staff-phone">Their phone number</Label>
                  <Input
                    id="staff-phone"
                    inputMode="tel"
                    placeholder="0803 123 4567"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value);
                      setFound(null);
                      setNotFound(false);
                    }}
                  />
                </div>
                <Button type="submit" variant="outline" disabled={!phone.trim()} loading={find.isPending}>
                  <Search />
                  Find
                </Button>
              </form>

              {notFound ? (
                <Alert variant="warning">
                  <AlertDescription>
                    Nobody has an account with that number yet. Ask them to create one at{' '}
                    <span className="font-mono">{signupPath}</span>, then find them again.
                  </AlertDescription>
                </Alert>
              ) : null}

              {found ? (
                <div className="space-y-4 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{found.fullName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{found.phone}</p>
                    </div>
                    <StatusBadge status={found.status} />
                  </div>

                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-medium">What they can do</legend>
                    {roles.map((role) => (
                      <button
                        key={role.key}
                        type="button"
                        onClick={() => setRoleKey(role.key)}
                        aria-pressed={roleKey === role.key}
                        className={cn(
                          'flex w-full gap-3 rounded-lg border p-3 text-left transition-colors',
                          roleKey === role.key ? 'border-primary bg-accent/50' : 'hover:border-primary/40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                            roleKey === role.key ? 'border-primary bg-primary' : 'border-input',
                          )}
                          aria-hidden="true"
                        >
                          {roleKey === role.key ? (
                            <CircleCheck className="size-3 text-primary-foreground" />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{role.label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {role.description}
                          </span>
                        </span>
                      </button>
                    ))}
                  </fieldset>

                  <Button
                    disabled={!roleKey || found.status === 'SUSPENDED'}
                    loading={grant.isPending}
                    onClick={() => guarded(() => grant.mutate())}
                  >
                    Give access as {labelOf(roleKey).toLowerCase()}
                  </Button>
                  {found.status === 'SUSPENDED' ? (
                    <p className="text-xs text-muted-foreground">
                      This account is suspended and cannot be given access.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              Who has access
            </h2>
            {grants.isPending ? (
              <QueueSkeleton rows={2} />
            ) : grants.isError ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>The staff list could not be loaded.</AlertDescription>
              </Alert>
            ) : live.length === 0 ? (
              <EmptyState icon={<Users />} title="Nobody yet" description="Add someone above." />
            ) : (
              <div className="space-y-2">
                {live.map((row) => (
                  <Card key={row.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          {row.fullName}
                          {row.userId === session.user.id ? <Badge variant="secondary">You</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {labelOf(row.roleKey)} · since {formatDate(row.grantedAt)}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setRevoking(row)}>
                        Remove access
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {past.length > 0 ? (
              <details className="rounded-md border px-4 py-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Past access ({past.length})
                </summary>
                <ul className="mt-3 space-y-2">
                  {past.map((row) => (
                    <li key={row.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{row.fullName}</span> ·{' '}
                      {labelOf(row.roleKey)} · {formatDate(row.grantedAt)} to{' '}
                      {row.revokedAt ? formatDate(row.revokedAt) : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </>
      )}

      <Dialog open={Boolean(revoking)} onOpenChange={(next) => !next && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {revoking?.fullName}&apos;s access</DialogTitle>
            <DialogDescription>
              They lose {revoking ? labelOf(revoking.roleKey).toLowerCase() : ''} access on their
              next request. The grant stays in the record with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="revoke-reason">Why</Label>
            <Textarea
              id="revoke-reason"
              rows={3}
              placeholder="Left the hospital, changed role, access given in error…"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Keep their access
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < MIN_REVOKE_REASON}
              loading={revoke.isPending}
              onClick={() => {
                const target = revoking;
                if (target) guarded(() => revoke.mutate(target));
              }}
            >
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
