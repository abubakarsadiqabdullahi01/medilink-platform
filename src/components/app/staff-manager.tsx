'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, LockKeyhole, Mail, Search, UserPlus, Users } from 'lucide-react';
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
import { ErrorState } from '@/components/app/states';
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

interface Invitation {
  id: string;
  /** Masked: the facility typed it and can recognise it. */
  phone: string;
  roleKey: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  invitedBy: { id: string; fullName: string };
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  text: 'waiting' | 'sent' | 'failed';
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

  // ---- inviting somebody to a facility, who answers it themselves
  const isFacility = scopeType === 'FACILITY' && Boolean(scopeId);
  // Medilink's own people may still add somebody directly while onboarding a hospital.
  const holdsPlatform = session.grants.some(
    (grant) => grant.permission === 'role.grant' && grant.scopeType === 'PLATFORM',
  );
  const invitationsKey = ['staff-invitations', scopeId ?? 'none'];
  const invitations = useQuery({
    queryKey: invitationsKey,
    queryFn: () => api.get<{ invitations: Invitation[] }>(`/api/v1/staff-invitations?facilityId=${scopeId}`),
    enabled: isFacility,
    retry: false,
  });
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<string>(roles[0]?.key ?? '');

  const invite = useMutation({
    mutationFn: () =>
      api.post('/api/v1/staff-invitations', {
        facilityId: scopeId,
        phone: invitePhone.trim(),
        roleKey: inviteRole,
      }),
    onSuccess: () => {
      toast.success('Invitation sent', {
        description: 'They get one text. Nothing changes until they say yes, and it lasts a week.',
      });
      setInvitePhone('');
      void queryClient.invalidateQueries({ queryKey: invitationsKey });
    },
    onError: (error) => onFailure(error, 'Could not send the invitation'),
  });

  const cancelInvite = useMutation({
    mutationFn: (target: Invitation) =>
      api.post(`/api/v1/staff-invitations/${target.id}/cancel`, { facilityId: scopeId }),
    onSuccess: () => {
      toast.success('Invitation cancelled');
      void queryClient.invalidateQueries({ queryKey: invitationsKey });
    },
    onError: (error) => onFailure(error, 'Could not cancel the invitation'),
  });

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

  // ---- changing somebody's role, in one step
  const [changing, setChanging] = useState<Grant | null>(null);
  const [newRoleKey, setNewRoleKey] = useState('');
  const [changeReason, setChangeReason] = useState('');

  const change = useMutation({
    mutationFn: (target: Grant) =>
      api.post(`/api/v1/grants/${target.id}/change-role`, {
        scopeType,
        scopeId,
        roleKey: newRoleKey,
        reason: changeReason.trim(),
      }),
    onSuccess: (_data, target) => {
      toast.success(`${target.fullName} is now ${labelOf(newRoleKey).toLowerCase()}`, {
        description: 'The old role ended as the new one began, so there was no gap.',
      });
      setChanging(null);
      setNewRoleKey('');
      setChangeReason('');
      void queryClient.invalidateQueries({ queryKey: queueKey });
    },
    onError: (error) => onFailure(error, 'Could not change the role'),
  });

  // ---- removing everything somebody has here, at once
  const [removingAll, setRemovingAll] = useState<Grant | null>(null);
  const [emergencyReason, setEmergencyReason] = useState('');

  const removeAll = useMutation({
    mutationFn: (target: Grant) =>
      api.post('/api/v1/grants/remove-access', {
        userId: target.userId,
        scopeType,
        scopeId,
        reason: emergencyReason.trim(),
      }),
    onSuccess: (_data, target) => {
      toast.success(`${target.fullName} no longer has any access here`);
      setRemovingAll(null);
      setEmergencyReason('');
      void queryClient.invalidateQueries({ queryKey: queueKey });
    },
    onError: (error) => onFailure(error, 'Could not remove their access'),
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
          void queryClient.invalidateQueries({ queryKey: invitationsKey });
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
          {isFacility ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                  Invite someone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  They get one text and say yes or no themselves; nothing changes until they do. They
                  do not need an account yet: if they have not registered, they can do it at{' '}
                  <span className="font-mono">{signupPath}</span> with this number and the invitation
                  will be waiting.
                </p>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (invitePhone.trim() && inviteRole) guarded(() => invite.mutate());
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-phone">Their phone number</Label>
                    <Input
                      id="invite-phone"
                      inputMode="tel"
                      placeholder="0803 123 4567"
                      value={invitePhone}
                      onChange={(event) => setInvitePhone(event.target.value)}
                    />
                  </div>

                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-medium">What they would be able to do</legend>
                    {roles.map((role) => (
                      <button
                        key={role.key}
                        type="button"
                        onClick={() => setInviteRole(role.key)}
                        aria-pressed={inviteRole === role.key}
                        className={cn(
                          'flex w-full gap-3 rounded-lg border p-3 text-left transition-colors',
                          inviteRole === role.key ? 'border-primary bg-accent/50' : 'hover:border-primary/40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                            inviteRole === role.key ? 'border-primary bg-primary' : 'border-input',
                          )}
                          aria-hidden="true"
                        >
                          {inviteRole === role.key ? (
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

                  <Button type="submit" disabled={!invitePhone.trim() || !inviteRole} loading={invite.isPending}>
                    Send invitation as {labelOf(inviteRole).toLowerCase()}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {!isFacility || holdsPlatform ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <UserPlus className="size-4 text-muted-foreground" aria-hidden="true" />
                {isFacility ? 'Add someone directly (Medilink only)' : 'Give someone access'}
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
          ) : null}

          {isFacility ? (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                Invitations
              </h2>
              {invitations.isPending ? (
                <QueueSkeleton rows={1} />
              ) : invitations.isError ? (
                <ErrorState
                  error={invitations.error}
                  onRetry={() => void invitations.refetch()}
                  retrying={invitations.isFetching}
                  compact
                />
              ) : (
                <InvitationList
                  rows={invitations.data?.invitations ?? []}
                  labelOf={labelOf}
                  cancelling={cancelInvite.isPending}
                  onCancel={(row) => guarded(() => cancelInvite.mutate(row))}
                />
              )}
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              Who has access
            </h2>
            {grants.isPending ? (
              <QueueSkeleton rows={2} />
            ) : grants.isError ? (
              <ErrorState
                error={grants.error}
                onRetry={() => void grants.refetch()}
                retrying={grants.isFetching}
                compact
              />
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
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Change role for ${row.fullName}`}
                          onClick={() => {
                            setChanging(row);
                            setNewRoleKey('');
                            setChangeReason('');
                          }}
                        >
                          Change role
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Remove access for ${row.fullName}`}
                          onClick={() => setRevoking(row)}
                        >
                          Remove access
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive-text"
                          aria-label={`Remove all access now for ${row.fullName}`}
                          onClick={() => {
                            setRemovingAll(row);
                            setEmergencyReason('');
                          }}
                        >
                          Remove all access now
                        </Button>
                      </div>
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

      <Dialog open={Boolean(changing)} onOpenChange={(next) => !next && setChanging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change {changing?.fullName}&apos;s role</DialogTitle>
            <DialogDescription>
              Now {changing ? labelOf(changing.roleKey).toLowerCase() : ''}. The old role ends as the
              new one begins, so they are never without access in between. You can only give a role
              you hold yourself.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Their new role</legend>
            {roles
              .filter((role) => role.key !== changing?.roleKey)
              .map((role) => (
                <button
                  key={role.key}
                  type="button"
                  onClick={() => setNewRoleKey(role.key)}
                  aria-pressed={newRoleKey === role.key}
                  className={cn(
                    'flex w-full gap-3 rounded-lg border p-3 text-left transition-colors',
                    newRoleKey === role.key ? 'border-primary bg-accent/50' : 'hover:border-primary/40',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{role.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{role.description}</span>
                  </span>
                </button>
              ))}
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="change-reason">Why</Label>
            <Textarea
              id="change-reason"
              rows={2}
              placeholder="Now deputy to the medical director, moved to the night rota…"
              value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChanging(null)}>
              Leave it as it is
            </Button>
            <Button
              disabled={!newRoleKey || changeReason.trim().length < MIN_REVOKE_REASON}
              loading={change.isPending}
              onClick={() => {
                const target = changing;
                if (target) guarded(() => change.mutate(target));
              }}
            >
              Change role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removingAll)} onOpenChange={(next) => !next && setRemovingAll(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove all of {removingAll?.fullName}&apos;s access now</DialogTitle>
            <DialogDescription>
              Every role they hold {scopeType === 'FACILITY' ? 'at this facility' : 'on the platform'}{' '}
              ends at once, on their next request. What they hold anywhere else is not touched.
              {scopeType === 'FACILITY'
                ? ' They, and the other people who can manage staff here, are told by text.'
                : ''}{' '}
              Use this when removing one role at a time is the risk.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="emergency-reason">Why</Label>
            <Textarea
              id="emergency-reason"
              rows={3}
              placeholder="Left without notice and still has the keys, account may be in somebody else’s hands…"
              value={emergencyReason}
              onChange={(event) => setEmergencyReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingAll(null)}>
              Keep their access
            </Button>
            <Button
              variant="destructive"
              disabled={emergencyReason.trim().length < MIN_REVOKE_REASON}
              loading={removeAll.isPending}
              onClick={() => {
                const target = removingAll;
                if (target) guarded(() => removeAll.mutate(target));
              }}
            >
              Remove all access now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

const INVITATION_STATUS: Record<Invitation['status'], string> = {
  PENDING: 'Waiting for an answer',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Ran out',
};

/**
 * What this facility has sent. The ones still waiting come first and can be cancelled; the rest
 * are kept below as a record of what became of them. The text's delivery is said plainly: a
 * failed one is retried, and the person who sent it should know the invitation may not have
 * reached anyone yet.
 */
function InvitationList({
  rows,
  labelOf,
  cancelling,
  onCancel,
}: {
  rows: Invitation[];
  labelOf: (key: string) => string;
  cancelling: boolean;
  onCancel: (row: Invitation) => void;
}) {
  const waiting = rows.filter((row) => row.status === 'PENDING');
  const earlier = rows.filter((row) => row.status !== 'PENDING');

  return (
    <>
      {waiting.length === 0 ? (
        <EmptyState icon={<Mail />} title="Nothing waiting" description="Invite someone above." />
      ) : (
        <div className="space-y-2">
          {waiting.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="font-mono">{row.phone}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {labelOf(row.roleKey)} · sent {formatDate(row.createdAt)} by {row.invitedBy.fullName} ·
                    answer by {formatDate(row.expiresAt)}
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-xs',
                      row.text === 'failed' ? 'text-destructive-text' : 'text-muted-foreground',
                    )}
                  >
                    {row.text === 'sent'
                      ? 'The text was sent.'
                      : row.text === 'failed'
                        ? 'The text has not reached them yet. It is being tried again.'
                        : 'The text is about to be sent.'}
                  </p>
                </div>
                <Button variant="outline" size="sm" loading={cancelling} onClick={() => onCancel(row)}>
                  Cancel
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {earlier.length > 0 ? (
        <details className="rounded-md border px-4 py-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Earlier invitations ({earlier.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {earlier.map((row) => (
              <li key={row.id} className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{row.phone}</span> · {labelOf(row.roleKey)} ·{' '}
                {INVITATION_STATUS[row.status]} · sent {formatDate(row.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
