'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Clock } from 'lucide-react';
import { api } from '@/lib/ui/api';
import {
  BLOCKER_GUIDE,
  THEIR_BLOCKERS,
  usePhoto,
  type ApplicationState,
  type Profile,
} from '@/lib/ui/practitioner';
import { nameOf, useReference } from '@/lib/ui/reference';
import { useSession } from '@/lib/ui/session';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/app/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatDate } from '@/components/app/format';

interface Verification {
  identity: { ninLast4: string; nameMatch: boolean; verifiedAt: string } | null;
  registrations: {
    id: string;
    regulator: string;
    folioNumber: string;
    registrationStatus: string;
    expiresAt: string | null;
    usable: boolean;
  }[];
}

/**
 * Who this is, as a stranger would read it: the card above the tabs.
 *
 * The tabs below are all *editing* — forms and lists — and none of them says
 * "this is your profile". This does, and it carries the one fact a practitioner
 * returns to check: whether they can currently be offered work.
 */
const STATE_BADGE: Record<
  ApplicationState,
  { variant: 'success' | 'info' | 'default' | 'warning' | 'destructive'; label: string; icon: typeof Clock }
> = {
  APPROVED: { variant: 'success', label: 'Can be offered shifts', icon: CircleCheck },
  WAITING: { variant: 'info', label: 'Waiting for approval', icon: Clock },
  READY: { variant: 'default', label: 'Ready to submit', icon: CircleCheck },
  DRAFT: { variant: 'warning', label: 'Setup incomplete', icon: Clock },
  CHANGES_NEEDED: { variant: 'destructive', label: 'Changes needed', icon: Clock },
};

export function ProfileSummary({ profile, state }: { profile: Profile; state: ApplicationState }) {
  const session = useSession();
  const reference = useReference();

  const photo = usePhoto();
  const badge = STATE_BADGE[state];

  const category = nameOf(reference.data?.professionalCategories, profile.professionalCategoryId);
  const specialty = profile.specialtyId
    ? nameOf(reference.data?.specialties, profile.specialtyId)
    : null;
  const place = [
    profile.homeLgaId ? nameOf(reference.data?.lgas, profile.homeLgaId) : null,
    profile.homeStateId ? nameOf(reference.data?.states, profile.homeStateId) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar name={session.user.fullName} src={photo.url} size="lg" />
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight">{session.user.fullName}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[
                category,
                specialty,
                `${profile.yearsOfExperience} yr${profile.yearsOfExperience === 1 ? '' : 's'} experience`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[session.user.phone, place].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <Badge variant={badge.variant} className="gap-1.5 self-start py-1 sm:self-auto">
          <badge.icon className="size-3.5" aria-hidden="true" />
          {badge.label}
        </Badge>
      </CardContent>
    </Card>
  );
}

/** What Medilink has recorded about them — read-only, under the editable details. */
export function OnRecord({ blockers, eligible }: { blockers: string[]; eligible: boolean }) {
  const verification = useQuery({
    queryKey: ['my-verification'],
    queryFn: () => api.get<Verification>('/api/v1/practitioners/verification?scopeType=SELF'),
    retry: false,
  });
  // The identity and registration rows already say whether those are recorded.
  const other = blockers.filter(
    (blocker) =>
      !THEIR_BLOCKERS.includes(blocker) &&
      !blocker.startsWith('identity_') &&
      !blocker.startsWith('registration_'),
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">What Medilink has on record</CardTitle>
        <p className="text-xs text-muted-foreground">
          Recorded by a compliance officer, not by you. You cannot edit these.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {verification.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Identity
              </p>
              {verification.data?.identity ? (
                <p className="mt-1">
                  NIN ending {verification.data.identity.ninLast4}, recorded{' '}
                  {formatDate(verification.data.identity.verifiedAt)}
                  {verification.data.identity.nameMatch
                    ? ''
                    : ' — the name did not match this account'}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  Not recorded yet. An officer does this.
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Professional registration
              </p>
              {(verification.data?.registrations ?? []).length === 0 ? (
                <p className="mt-1 text-muted-foreground">
                  Not recorded yet. An officer records it against your licence.
                </p>
              ) : (
                verification.data?.registrations.map((row) => (
                  <div key={row.id} className="mt-1 flex flex-wrap items-center gap-2">
                    {row.regulator} {row.folioNumber}
                    <StatusBadge status={row.registrationStatus} />
                    {row.expiresAt ? (
                      <span className="text-xs text-muted-foreground">
                        expires {formatDate(row.expiresAt)}
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {/* Identity and registration are shown above; this only adds what
                they do not cover (a screening check, an inactive account). */}
            {eligible || other.length > 0 ? (
              <div className="border-t pt-3">
                {eligible ? (
                  <p className="flex items-center gap-2">
                    <CircleCheck className="size-4 text-success" aria-hidden="true" />
                    You can be offered shifts.
                  </p>
                ) : (
                  <ul className="space-y-1 text-muted-foreground">
                    {other.map((blocker) => (
                      <li key={blocker}>· {BLOCKER_GUIDE[blocker]?.says ?? humanise(blocker)}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
