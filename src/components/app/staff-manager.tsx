'use client';

import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, LockKeyhole, Mail, Search, UserPlus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, ApiError, errorMessage } from '@/lib/ui/api';
import { phoneProblem } from '@/lib/ui/phone-problem';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { EmptyState } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { SuccessScreen } from '@/components/app/success-screen';
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
 *
 * Changing who can act for a hospital is the most consequential thing on these screens, so every
 * change that takes something away — removing a role, changing one, removing everything — is
 * read back first: who, what they lose, and the way back. Giving access is read back too.
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

  const roleOf = (key: string) => roles.find((role) => role.key === key);
  const labelOf = (key: string) => roleOf(key)?.label ?? key;
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
    queryFn: () =>
      api.get<{ invitations: Invitation[] }>(`/api/v1/staff-invitations?facilityId=${scopeId}`),
    enabled: isFacility,
    retry: false,
  });
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteTouched, setInviteTouched] = useState(false);
  const [inviteRole, setInviteRole] = useState<string>(roles[0]?.key ?? '');
  const [invited, setInvited] = useState<{ phone: string; roleKey: string } | null>(null);
  const invitePhoneRef = useRef<HTMLInputElement>(null);
  const inviteProblem = phoneProblem(invitePhone);

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
      setInvited({ phone: invitePhone.trim(), roleKey: inviteRole });
      setInvitePhone('');
      setInviteTouched(false);
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
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [found, setFound] = useState<FoundUser | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [roleKey, setRoleKey] = useState<string>(roles[0]?.key ?? '');
  const [granting, setGranting] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const findProblem = phoneProblem(phone);

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
      setPhoneTouched(false);
      setFound(null);
      setGranting(false);
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
      toast.success(
        `${target.fullName} no longer has access as ${labelOf(target.roleKey).toLowerCase()}`,
      );
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
  const wayBack = isFacility
    ? 'Invite them again and they accept; the removal stays in the record.'
    : 'Find them by phone number and give access again; the removal stays in the record.';

  const grantColumns: Column<Grant>[] = [
    {
      id: 'person',
      header: 'Person',
      role: 'identity',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          {row.fullName}
          {row.userId === session.user.id ? <Badge variant="secondary">You</Badge> : null}
        </span>
      ),
    },
    { id: 'role', header: 'Role', cell: (row) => labelOf(row.roleKey) },
    { id: 'since', header: 'Since', cell: (row) => formatDate(row.grantedAt) },
  ];

  const invitationColumns: Column<Invitation>[] = [
    {
      id: 'phone',
      header: 'Phone number',
      role: 'identity',
      cell: (row) => <span className="tabular">{row.phone}</span>,
    },
    { id: 'role', header: 'Role', cell: (row) => labelOf(row.roleKey) },
    {
      id: 'sent',
      header: 'Sent',
      cell: (row) => `${formatDate(row.createdAt)} by ${row.invitedBy.fullName}`,
    },
    { id: 'answer', header: 'Answer by', cell: (row) => formatDate(row.expiresAt) },
    {
      id: 'text',
      header: 'Text message',
      cell: (row) => (
        <span className={cn(row.text === 'failed' && 'font-medium text-destructive-text')}>
          {row.text === 'sent'
            ? 'The text was sent.'
            : row.text === 'failed'
              ? 'The text has not reached them yet. It is being tried again.'
              : 'The text is about to be sent.'}
        </span>
      ),
    },
  ];

  const newRole = roleOf(newRoleKey);

  return (
    <div className="space-y-8">
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="size-5 text-muted-foreground" aria-hidden="true" />
                  Invite someone
                </CardTitle>
              </CardHeader>
              <CardContent>
                {invited ? (
                  <SuccessScreen
                    bare
                    title="Invitation sent"
                    description={
                      <>
                        To <span className="tabular font-medium">{invited.phone}</span>, as{' '}
                        {labelOf(invited.roleKey).toLowerCase()}.
                      </>
                    }
                    steps={[
                      'They get one text and say yes or no themselves. Nothing changes until they do.',
                      <>
                        If they have not registered yet, they can do it at{' '}
                        <span className="font-mono">{signupPath}</span> with this number and the
                        invitation will be waiting.
                      </>,
                      'It lasts a week. You can see it, and cancel it, under Invitations below.',
                    ]}
                    actions={
                      <Button size="lg" variant="outline" onClick={() => setInvited(null)}>
                        Invite someone else
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    <p className="text-base leading-relaxed text-muted-foreground">
                      They get one text and say yes or no themselves; nothing changes until they do.
                      They do not need an account yet: if they have not registered, they can do it
                      at <span className="font-mono">{signupPath}</span> with this number and the
                      invitation will be waiting.
                    </p>
                    <form
                      className="space-y-4"
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault();
                        setInviteTouched(true);
                        if (inviteProblem) {
                          invitePhoneRef.current?.focus();
                          return;
                        }
                        if (inviteRole) guarded(() => invite.mutate());
                      }}
                    >
                      <Field
                        label="Their phone number"
                        required
                        hint="A Nigerian mobile number, for example 0803 123 4567."
                        error={inviteTouched ? inviteProblem : undefined}
                      >
                        <Input
                          ref={invitePhoneRef}
                          inputMode="tel"
                          autoComplete="off"
                          placeholder="0803 123 4567"
                          value={invitePhone}
                          onBlur={() => invitePhone && setInviteTouched(true)}
                          onChange={(event) => setInvitePhone(event.target.value)}
                        />
                      </Field>

                      <RoleChoice
                        legend="What they would be able to do"
                        roles={roles}
                        value={inviteRole}
                        onChange={setInviteRole}
                      />

                      <Button
                        type="submit"
                        loading={invite.isPending}
                        disabled={!inviteRole}
                        className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto"
                      >
                        Send invitation as {labelOf(inviteRole).toLowerCase()}
                      </Button>
                    </form>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {!isFacility || holdsPlatform ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="size-5 text-muted-foreground" aria-hidden="true" />
                  {isFacility ? 'Add someone directly (Medilink only)' : 'Give someone access'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="space-y-3"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    setPhoneTouched(true);
                    if (findProblem) {
                      phoneRef.current?.focus();
                      return;
                    }
                    guarded(() => find.mutate());
                  }}
                >
                  <Field
                    label="Their phone number"
                    required
                    hint="A Nigerian mobile number, for example 0803 123 4567."
                    error={phoneTouched ? findProblem : undefined}
                  >
                    <Input
                      ref={phoneRef}
                      inputMode="tel"
                      autoComplete="off"
                      placeholder="0803 123 4567"
                      value={phone}
                      onBlur={() => phone && setPhoneTouched(true)}
                      onChange={(event) => {
                        setPhone(event.target.value);
                        setFound(null);
                        setNotFound(false);
                      }}
                    />
                  </Field>
                  <Button type="submit" variant="outline" loading={find.isPending}>
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
                        <p className="tabular text-sm text-muted-foreground">{found.phone}</p>
                      </div>
                      <StatusBadge status={found.status} />
                    </div>

                    <RoleChoice
                      legend="What they can do"
                      roles={roles}
                      value={roleKey}
                      onChange={setRoleKey}
                    />

                    <Button
                      className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto"
                      disabled={!roleKey || found.status === 'SUSPENDED'}
                      onClick={() => {
                        grant.reset();
                        setGranting(true);
                      }}
                    >
                      Give access as {labelOf(roleKey).toLowerCase()}
                    </Button>
                    {found.status === 'SUSPENDED' ? (
                      <p className="text-sm text-muted-foreground">
                        This account is suspended and cannot be given access.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {isFacility ? (
            <section aria-labelledby="staff-invitations-heading" className="space-y-3">
              <h2
                id="staff-invitations-heading"
                className="flex items-center gap-2 text-lg font-semibold"
              >
                <Mail className="size-5 text-muted-foreground" aria-hidden="true" />
                Invitations
              </h2>
              {invitations.isPending ? (
                <ListSkeleton rows={1} label="Loading invitations" />
              ) : invitations.isError && !invitations.data ? (
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
                  columns={invitationColumns}
                  cancellingId={cancelInvite.isPending ? cancelInvite.variables?.id : undefined}
                  onCancel={(row) => guarded(() => cancelInvite.mutate(row))}
                />
              )}
            </section>
          ) : null}

          <section aria-labelledby="staff-access-heading" className="space-y-3">
            <h2 id="staff-access-heading" className="flex items-center gap-2 text-lg font-semibold">
              <Users className="size-5 text-muted-foreground" aria-hidden="true" />
              Who has access
            </h2>
            {grants.isPending ? (
              <ListSkeleton rows={2} label="Loading who has access" />
            ) : grants.isError && !grants.data ? (
              <ErrorState
                error={grants.error}
                onRetry={() => void grants.refetch()}
                retrying={grants.isFetching}
                compact
              />
            ) : live.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="Nobody yet"
                description={
                  isFacility && !holdsPlatform ? 'Invite someone above.' : 'Add someone above.'
                }
              />
            ) : (
              <DataTable
                caption="People with access"
                rows={live}
                columns={grantColumns}
                getKey={(row) => row.id}
                actionHeader="Change"
                action={(row) => (
                  <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:justify-end">
                    <Button
                      variant="outline"
                      aria-label={`Change role for ${row.fullName}`}
                      onClick={() => {
                        change.reset();
                        setChanging(row);
                        setNewRoleKey('');
                        setChangeReason('');
                      }}
                    >
                      Change role
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={`Remove access for ${row.fullName}`}
                      onClick={() => {
                        revoke.reset();
                        setRevoking(row);
                        setReason('');
                      }}
                    >
                      Remove access
                    </Button>
                    <Button
                      variant="outline"
                      className="text-destructive-text"
                      aria-label={`Remove all access now for ${row.fullName}`}
                      onClick={() => {
                        removeAll.reset();
                        setRemovingAll(row);
                        setEmergencyReason('');
                      }}
                    >
                      Remove all access now
                    </Button>
                  </div>
                )}
              />
            )}

            {past.length > 0 ? (
              <details className="rounded-md border px-4 py-1 text-base">
                <summary className="min-h-11 cursor-pointer py-2.5 text-muted-foreground">
                  Past access ({past.length})
                </summary>
                <ul className="space-y-2 pb-3 pt-1">
                  {past.map((row) => (
                    <li key={row.id} className="text-sm text-muted-foreground">
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

      <ConfirmDialog
        open={granting}
        onOpenChange={setGranting}
        title="Give access"
        object={found ? `${found.fullName} · ${found.phone}` : ''}
        consequence={
          <>
            {found?.fullName ?? 'They'} will be able to act as{' '}
            <strong>{labelOf(roleKey).toLowerCase()}</strong>
            {scopeType === 'FACILITY' ? ' at this facility' : ' on the platform'}:{' '}
            {roleOf(roleKey)?.description}
          </>
        }
        reversible="You can remove it from the list afterwards; the grant stays in the record."
        confirmLabel={`Give access as ${labelOf(roleKey).toLowerCase()}`}
        loading={grant.isPending}
        onConfirm={() => guarded(() => grant.mutate())}
      />

      <ConfirmDialog
        open={changing !== null}
        onOpenChange={(open) => !open && setChanging(null)}
        title={`Change ${changing?.fullName ?? ''}’s role`}
        object={
          changing
            ? `${changing.fullName} · now ${labelOf(changing.roleKey).toLowerCase()}${
                newRole ? ` → ${newRole.label.toLowerCase()}` : ''
              }`
            : ''
        }
        consequence={
          newRole ? (
            <>
              From their next request they can act as <strong>{newRole.label.toLowerCase()}</strong>
              : {newRole.description} The old role ends as the new one begins, so they are never
              without access in between.
            </>
          ) : (
            <>
              Choose their new role below. The old role ends as the new one begins, so they are
              never without access in between. You can only give a role you hold yourself.
            </>
          )
        }
        reversible="You can change it back the same way."
        confirmLabel="Change role"
        cancelLabel="Leave it as it is"
        loading={change.isPending}
        confirmDisabled={!newRoleKey || changeReason.trim().length < MIN_REVOKE_REASON}
        onConfirm={() => {
          const target = changing;
          if (target) guarded(() => change.mutate(target));
        }}
      >
        <RoleChoice
          legend="Their new role"
          roles={roles.filter((role) => role.key !== changing?.roleKey)}
          value={newRoleKey}
          onChange={setNewRoleKey}
        />
        <Field
          label="Why"
          required
          hint={`At least ${MIN_REVOKE_REASON} characters. Kept in the record.`}
        >
          <Textarea
            rows={2}
            placeholder="Now deputy to the medical director, moved to the night rota…"
            value={changeReason}
            onChange={(event) => setChangeReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Remove access"
        object={revoking ? `${revoking.fullName} · ${labelOf(revoking.roleKey)}` : ''}
        consequence={
          <>
            They lose {revoking ? labelOf(revoking.roleKey).toLowerCase() : ''} access on their next
            request. Anything else they hold is not touched. The grant stays in the record with your
            reason.
          </>
        }
        reversible={wayBack}
        destructive
        confirmLabel="Remove access"
        cancelLabel="Keep their access"
        loading={revoke.isPending}
        confirmDisabled={reason.trim().length < MIN_REVOKE_REASON}
        onConfirm={() => {
          const target = revoking;
          if (target) guarded(() => revoke.mutate(target));
        }}
      >
        <Field
          label="Why"
          required
          hint={`At least ${MIN_REVOKE_REASON} characters. Kept in the record.`}
        >
          <Textarea
            rows={3}
            placeholder="Left the hospital, changed role, access given in error…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={removingAll !== null}
        onOpenChange={(open) => !open && setRemovingAll(null)}
        title="Remove all access now"
        object={
          removingAll
            ? `${removingAll.fullName} · every role ${
                scopeType === 'FACILITY' ? 'at this facility' : 'on the platform'
              }`
            : ''
        }
        consequence={
          <>
            Every role they hold {scopeType === 'FACILITY' ? 'at this facility' : 'on the platform'}{' '}
            ends at once, on their next request. What they hold anywhere else is not touched.
            {scopeType === 'FACILITY'
              ? ' They, and the other people who can manage staff here, are told by text.'
              : ''}{' '}
            Use this when removing one role at a time is the risk.
          </>
        }
        reversible={wayBack}
        destructive
        confirmLabel="Remove all access now"
        cancelLabel="Keep their access"
        loading={removeAll.isPending}
        confirmDisabled={emergencyReason.trim().length < MIN_REVOKE_REASON}
        onConfirm={() => {
          const target = removingAll;
          if (target) guarded(() => removeAll.mutate(target));
        }}
      >
        <Field
          label="Why"
          required
          hint={`At least ${MIN_REVOKE_REASON} characters. Kept in the record.`}
        >
          <Textarea
            rows={3}
            placeholder="Left without notice and still has the keys, account may be in somebody else’s hands…"
            value={emergencyReason}
            onChange={(event) => setEmergencyReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Which role, as a radio group: one tab stop, arrow keys to move, and the choice read out as
 * "selected". Each is a card that says in plain words what the role can and cannot do, because
 * that is the decision being made.
 */
function RoleChoice({
  legend,
  roles,
  value,
  onChange,
}: {
  legend: string;
  roles: StaffRole[];
  value: string;
  onChange: (key: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-base font-medium">{legend}</legend>
      {roles.map((role) => {
        const checked = value === role.key;
        return (
          <label
            key={role.key}
            className={cn(
              'flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
              'focus-within:ring-2 focus-within:ring-ring',
              checked ? 'border-primary bg-accent/50' : 'hover:border-primary/40',
            )}
          >
            <input
              type="radio"
              name={name}
              value={role.key}
              checked={checked}
              onChange={() => onChange(role.key)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                checked ? 'border-primary bg-primary' : 'border-input',
              )}
            >
              {checked ? <CircleCheck className="size-3.5 text-primary-foreground" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-medium">{role.label}</span>
              <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                {role.description}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
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
  columns,
  cancellingId,
  onCancel,
}: {
  rows: Invitation[];
  labelOf: (key: string) => string;
  columns: Column<Invitation>[];
  cancellingId: string | undefined;
  onCancel: (row: Invitation) => void;
}) {
  const waiting = rows.filter((row) => row.status === 'PENDING');
  const earlier = rows.filter((row) => row.status !== 'PENDING');

  return (
    <>
      {waiting.length === 0 ? (
        <EmptyState
          compact
          icon={<Mail />}
          title="Nothing waiting"
          description="Invite someone above."
        />
      ) : (
        <DataTable
          caption="Invitations waiting for an answer"
          rows={waiting}
          columns={columns}
          getKey={(row) => row.id}
          actionHeader="Change"
          action={(row) => (
            <Button
              variant="outline"
              aria-label={`Cancel the invitation to ${row.phone}`}
              loading={cancellingId === row.id}
              onClick={() => onCancel(row)}
            >
              Cancel invitation
            </Button>
          )}
        />
      )}

      {earlier.length > 0 ? (
        <details className="rounded-md border px-4 py-1 text-base">
          <summary className="min-h-11 cursor-pointer py-2.5 text-muted-foreground">
            Earlier invitations ({earlier.length})
          </summary>
          <ul className="space-y-2 pb-3 pt-1">
            {earlier.map((row) => (
              <li key={row.id} className="text-sm text-muted-foreground">
                <span className="tabular text-foreground">{row.phone}</span> ·{' '}
                {labelOf(row.roleKey)} · {INVITATION_STATUS[row.status]} · sent{' '}
                {formatDate(row.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
