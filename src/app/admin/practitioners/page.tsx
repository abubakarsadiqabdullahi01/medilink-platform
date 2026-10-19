'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BadgeCheck, CircleAlert, CircleCheck, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { useReference } from '@/lib/ui/reference';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader } from '@/components/app/page-shell';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type Column } from '@/components/app/data-table';
import { FilterBar } from '@/components/app/filter-bar';
import { Pager } from '@/components/app/pager';
import { QueueAge } from '@/components/app/queue-age';
import { ErrorState, FilteredEmpty, ListSkeleton, TableSkeleton } from '@/components/app/states';
import { formatDate, formatWhen } from '@/components/app/format';
import { DecisionDialog } from '@/app/admin/credentials/credential-decision';
import { CredentialsTab } from './credentials-tab';
import { EvidenceReview } from './evidence-review';
import { StandingPanel } from './standing-panel';

/**
 * The practitioner directory, and recording what a practitioner cannot record
 * for themselves.
 *
 * Identity and professional registration are `PLATFORM`-scoped because a
 * practitioner does not verify their own identity — that is the point of the
 * step. No screen called either endpoint for a long time, so the practitioner's
 * own page said "waiting on Medilink" about something Medilink had no way to
 * do, and nobody who registered could become eligible through the interface.
 *
 * This was a phone lookup first, on anti-enumeration reasoning borrowed from
 * `/grants/find`. That was the wrong call for this job: an officer clearing a
 * morning's onboarding has no number to type, only a queue of people who
 * registered overnight. A list is what the work actually needs.
 */

interface Entry {
  userId: string;
  fullName: string;
  phone: string;
  status: string;
  photoUrl: string | null;
  professionalCategoryId: string | null;
  yearsOfExperience: number | null;
  identityRecorded: boolean;
  registrationRecorded: boolean;
  /** When they said "I am done, review me"; null while they have not. */
  submittedForReviewAt: string | null;
  createdAt: string;
}

/**
 * The officer's queues. Everybody who has registered is not a queue: most of
 * them are half-way through a form, and an officer opening one then would be
 * reviewing something its owner has not finished. So the list opens on those
 * who have asked, longest-waiting first, with the rest a click away.
 */
type Queue = 'waiting' | 'draft' | 'all';

const QUEUES: [Queue, string][] = [
  ['waiting', 'Waiting for approval'],
  ['draft', 'Not submitted yet'],
  ['all', 'Everyone'],
];

interface Identity {
  ninLast4: string;
  nameMatch: boolean;
  method: string;
  verifiedAt: string;
}

interface Registration {
  id: string;
  regulator: string;
  folioNumber: string;
  registrationStatus: string;
  expiresAt: string | null;
  usable: boolean;
  cadreLevel: { id: string; name: string; rank: number } | null;
  registrationCategory: { id: string; name: string; supervisionRequired: boolean } | null;
}

interface Verification {
  identity: Identity | null;
  registrations: Registration[];
}

interface Eligibility {
  eligible: boolean;
  blockers: string[];
}

const REGISTRATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'STRUCK_OFF', 'UNKNOWN'] as const;

/** Each eligibility blocker as the officer would say it, and where it is fixed. */
const BLOCKER_LABELS: Record<string, string> = {
  account_not_usable: 'The account is suspended or closed',
  profile_incomplete: 'No profile yet — the practitioner creates it',
  identity_unverified: 'Identity (NIN) not recorded — below',
  identity_name_mismatch: 'The name on the NIN slip does not match the account',
  registration_missing: 'No regulator registration recorded — below',
  registration_not_active: 'The regulator registration is not active',
  registration_evidence_stale: 'The registration was last checked more than a year ago',
  credential_missing: 'A mandatory credential is not verified yet — Credentials tab',
  credential_expired: 'A mandatory credential has expired',
  screening_not_clear: 'Sanctions screening is flagged — see Sanctions screening',
};

/** Short enough that the whole page is scannable without scrolling past it. */
const PAGE_SIZE = 20;

function Avatar({ entry, size = 'sm' }: { entry: Entry; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted',
        size === 'lg' ? 'size-16' : 'size-11',
      )}
    >
      {entry.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.photoUrl} alt="" className="size-full object-cover" />
      ) : (
        <UserRound
          className={cn('text-muted-foreground', size === 'lg' ? 'size-7' : 'size-5')}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

/**
 * The level and registration category on a registration, as the officer sets them.
 *
 * Only a profession that compliance has defined levels for shows a level picker; until
 * then there is nothing to choose and the row says so. Saved together, so what is on the
 * screen is what is recorded.
 */
function StandingEditor({
  registration,
  professionId,
  levels,
  categories,
  value,
  onChange,
  onSave,
  saving,
}: {
  registration: Registration;
  professionId: string | null;
  levels: { id: string; name: string; rank: number; categoryId: string }[];
  categories: { id: string; name: string; supervisionRequired: boolean }[];
  value: { level: string; category: string };
  onChange: (next: { level: string; category: string }) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const own = levels.filter((level) => level.categoryId === professionId);
  const level = value.level || registration.cadreLevel?.id || '__none__';
  const category = value.category || registration.registrationCategory?.id || '__none__';
  const unchanged =
    level === (registration.cadreLevel?.id ?? '__none__') &&
    category === (registration.registrationCategory?.id ?? '__none__');

  if (own.length === 0 && categories.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No levels or registration categories are defined yet, so there is nothing to record here.
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      {own.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor={`standing-level-${registration.id}`}>Level</Label>
          <Select value={level} onValueChange={(next) => onChange({ level: next, category })}>
            <SelectTrigger id={`standing-level-${registration.id}`} aria-label="Level">
              <SelectValue placeholder="Not recorded" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not recorded</SelectItem>
              {own.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No levels are defined for their profession yet.
        </p>
      )}
      {categories.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor={`standing-category-${registration.id}`}>Registration category</Label>
          <Select value={category} onValueChange={(next) => onChange({ level, category: next })}>
            <SelectTrigger
              id={`standing-category-${registration.id}`}
              aria-label="Registration category"
            >
              <SelectValue placeholder="Not recorded" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not recorded</SelectItem>
              {categories.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                  {row.supervisionRequired ? ' (supervised)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <span />
      )}
      <Button size="sm" variant="outline" disabled={unchanged} loading={saving} onClick={onSave}>
        Save
      </Button>
    </div>
  );
}

/**
 * `?user=<id>` opens that practitioner directly — what the credentials queue
 * links to for a NIN or a licence, which are confirmed here, beside the rest of
 * their record, rather than approved in place.
 */
export default function PractitionersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Practitioners />
    </Suspense>
  );
}

function Practitioners() {
  const router = useRouter();
  const wanted = useSearchParams().get('user');
  const queryClient = useQueryClient();
  const reference = useReference();

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [queue, setQueue] = useState<Queue>('waiting');
  const [selected, setSelected] = useState<Entry | null>(null);
  const [tab, setTab] = useState('record');

  const linked = useQuery({
    queryKey: ['practitioner-by-id', wanted],
    queryFn: () =>
      api.get<{ practitioners?: Entry[] }>(
        `/api/v1/practitioners?scopeType=PLATFORM&limit=1&userId=${wanted}`,
      ),
    enabled: Boolean(wanted) && !selected,
    retry: false,
  });
  useEffect(() => {
    const found = linked.data?.practitioners?.[0];
    if (found && !selected) {
      setSelected(found);
      setTab('record');
    }
  }, [linked.data, selected]);

  const [nin, setNin] = useState('');
  const [nameMatch, setNameMatch] = useState('true');
  const [confirmIdentity, setConfirmIdentity] = useState(false);
  const [confirmRegistration, setConfirmRegistration] = useState(false);

  const [regulator, setRegulator] = useState('MDCN');
  const [folioNumber, setFolioNumber] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('ACTIVE');
  const [expiresAt, setExpiresAt] = useState('');

  /**
   * Cursor paging, not page numbers: the endpoint pages by cursor, which has no notion of
   * "page 7" and no total to divide — the right trade for a list people are inserted into
   * constantly, because offset paging quietly shows the same person twice when somebody
   * registers between one page and the next.
   */
  const pager = useCursorPager();

  const directory = useQuery({
    queryKey: ['practitioner-directory', applied, pager.cursor, queue],
    queryFn: async () => {
      const search = applied ? `&search=${encodeURIComponent(applied)}` : '';
      const from = pager.cursor ? `&cursor=${pager.cursor}` : '';
      const which = queue === 'all' ? '' : `&application=${queue}`;
      return api.get<{ practitioners?: Entry[]; nextCursor?: string | null }>(
        `/api/v1/practitioners?scopeType=PLATFORM&limit=${PAGE_SIZE}${which}${search}${from}`,
      );
    },
    // Keeps the page under the cursor while the next one loads, instead of
    // collapsing to skeletons every time somebody steps forward.
    placeholderData: (previous) => previous,
  });

  const userId = selected?.userId ?? null;

  const verification = useQuery({
    queryKey: ['verification', userId],
    queryFn: () =>
      api.get<Verification>(
        `/api/v1/practitioners/verification?scopeType=PLATFORM&scopeId=${userId}`,
      ),
    enabled: Boolean(userId),
    retry: false,
  });

  const eligibility = useQuery({
    queryKey: ['eligibility-of', userId],
    queryFn: () =>
      api.get<Eligibility>(
        `/api/v1/practitioners/eligibility?scopeType=PLATFORM&scopeId=${userId}`,
      ),
    enabled: Boolean(userId),
    retry: false,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['verification', userId] });
    void queryClient.invalidateQueries({ queryKey: ['eligibility-of', userId] });
    void queryClient.invalidateQueries({ queryKey: ['practitioner-directory'] });
  }

  const recordIdentity = useMutation({
    mutationFn: () =>
      api.post('/api/v1/practitioners/verification/identity', {
        userId,
        nin: nin.trim(),
        nameMatch: nameMatch === 'true',
      }),
    onSuccess: () => {
      toast.success('Identity recorded', {
        description: 'The number itself is not stored — only its last four digits.',
      });
      setNin('');
      setConfirmIdentity(false);
      refresh();
    },
  });

  const recordRegistration = useMutation({
    mutationFn: () =>
      api.post('/api/v1/practitioners/verification/registration', {
        userId,
        regulator: regulator.trim(),
        folioNumber: folioNumber.trim(),
        registrationStatus,
        expiresAt: expiresAt || undefined,
      }),
    onSuccess: () => {
      toast.success('Registration recorded');
      setFolioNumber('');
      setExpiresAt('');
      setConfirmRegistration(false);
      refresh();
    },
  });

  // Where they stand on the register: their level within the profession and their
  // registration category, read off it by the officer (PRA-01, PRA-02).
  const [standing, setStanding] = useState<{ level: string; category: string }>({
    level: '',
    category: '',
  });
  const [standingFor, setStandingFor] = useState<Registration | null>(null);
  const NONE = '__none__';

  const recordStanding = useMutation({
    mutationFn: () =>
      api.post('/api/v1/practitioners/verification/standing', {
        userId,
        cadreLevelId: standing.level && standing.level !== NONE ? standing.level : null,
        registrationCategoryId:
          standing.category && standing.category !== NONE ? standing.category : null,
      }),
    onSuccess: () => {
      toast.success('Level and category recorded');
      setStandingFor(null);
      refresh();
    },
  });

  const categoryName = (id: string | null) =>
    (reference.data?.professionalCategories ?? []).find((row) => row.id === id)?.name ?? null;
  const levelName = (id: string) =>
    id === NONE
      ? 'Not recorded'
      : ((reference.data?.cadreLevels ?? []).find((row) => row.id === id)?.name ?? 'Not recorded');
  const categoryOfStanding = (id: string) =>
    id === NONE
      ? 'Not recorded'
      : ((reference.data?.registrationCategories ?? []).find((row) => row.id === id)?.name ??
        'Not recorded');

  if (selected) {
    return (
      <>
        <PageHeader
          title={selected.fullName}
          description={selected.phone}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSelected(null);
                // Otherwise the link that opened this would open it again.
                if (wanted) router.replace('/admin/practitioners');
              }}
            >
              <ArrowLeft />
              All practitioners
            </Button>
          }
        />

        <div className="space-y-6">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
              <div className="flex min-w-0 items-center gap-4">
                <Avatar entry={selected} size="lg" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{selected.fullName}</p>
                  <p className="mt-0.5 font-mono text-sm text-muted-foreground">{selected.phone}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {categoryName(selected.professionalCategoryId) ?? 'No profile yet'}
                    {selected.yearsOfExperience !== null
                      ? ` · ${selected.yearsOfExperience} years`
                      : ''}
                    {' · joined '}
                    {formatWhen(selected.createdAt)}
                  </p>
                </div>
              </div>
              <StatusBadge status={selected.status} />
            </CardContent>
          </Card>

          {/* Everything that decides whether this person can work, in one
              place. Identity, registration and credentials gate the same
              outcome, and reviewing them on three different screens is how an
              officer verifies two of the three and moves on. */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="record">Identity and registration</TabsTrigger>
              <TabsTrigger value="credentials">Credentials</TabsTrigger>
            </TabsList>

            <TabsContent value="record" className="space-y-6 pt-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Can they be offered work?</CardTitle>
                </CardHeader>
                <CardContent>
                  {eligibility.isPending ? (
                    <Skeleton className="h-16 w-full" />
                  ) : eligibility.isError ? (
                    <ErrorState
                      error={eligibility.error}
                      onRetry={() => void eligibility.refetch()}
                      retrying={eligibility.isFetching}
                      compact
                    />
                  ) : eligibility.data?.eligible ? (
                    <p className="flex items-center gap-2 text-sm">
                      <CircleCheck className="size-4 text-success" aria-hidden="true" />
                      Yes — everything the platform requires is in place.
                    </p>
                  ) : (
                    <>
                      <p className="flex items-center gap-2 text-sm">
                        <CircleAlert className="size-4 text-warning" aria-hidden="true" />
                        Not yet. What is outstanding:
                      </p>
                      <ul className="mt-2 space-y-1">
                        {(eligibility.data?.blockers ?? []).map((blocker) => (
                          <li key={blocker} className="text-sm text-muted-foreground">
                            · {BLOCKER_LABELS[blocker] ?? humanise(blocker)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>

              <EvidenceReview
                userId={selected.userId}
                practitionerName={selected.fullName}
                regulator={
                  (reference.data?.professionalCategories ?? []).find(
                    (row) => row.id === selected.professionalCategoryId,
                  )?.regulator ?? null
                }
              />

              <StandingPanel
                userId={selected.userId}
                practitionerName={selected.fullName}
                onChanged={refresh}
              />

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">On record</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {verification.isPending ? (
                    <Skeleton className="h-24 w-full" />
                  ) : verification.isError ? (
                    <ErrorState
                      error={verification.error}
                      onRetry={() => void verification.refetch()}
                      retrying={verification.isFetching}
                      compact
                    />
                  ) : (
                    <>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Identity
                        </p>
                        {verification.data?.identity ? (
                          <DetailGrid>
                            <Detail label="NIN">
                              <span className="tabular">
                                ••••• {verification.data.identity.ninLast4}
                              </span>
                            </Detail>
                            <Detail label="Name matched">
                              {verification.data.identity.nameMatch ? 'Yes' : 'No'}
                            </Detail>
                            <Detail label="Method">
                              {humanise(verification.data.identity.method)}
                            </Detail>
                            <Detail label="Recorded">
                              {formatWhen(verification.data.identity.verifiedAt)}
                            </Detail>
                          </DetailGrid>
                        ) : (
                          <p className="mt-1 text-sm text-muted-foreground">
                            Nothing recorded. They cannot be matched to work until it is.
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Professional registration
                        </p>
                        {(verification.data?.registrations ?? []).length === 0 ? (
                          <p className="mt-1 text-sm text-muted-foreground">Nothing recorded.</p>
                        ) : (
                          <ul className="mt-2 space-y-3">
                            {(verification.data?.registrations ?? []).map((registration) => (
                              <li key={registration.id} className="rounded-md border p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-medium">
                                    {registration.regulator}{' '}
                                    <span className="font-mono text-sm text-muted-foreground">
                                      {registration.folioNumber}
                                    </span>
                                  </p>
                                  <StatusBadge status={registration.registrationStatus} />
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {registration.usable
                                    ? 'Currently permits practice'
                                    : 'Does not currently permit practice'}
                                  {registration.expiresAt
                                    ? ` · expires ${formatWhen(registration.expiresAt)}`
                                    : ''}
                                </p>
                                <StandingEditor
                                  registration={registration}
                                  professionId={selected?.professionalCategoryId ?? null}
                                  levels={reference.data?.cadreLevels ?? []}
                                  categories={reference.data?.registrationCategories ?? []}
                                  value={standing}
                                  onChange={setStanding}
                                  onSave={() => setStandingFor(registration)}
                                  saving={recordStanding.isPending}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* The fallback. Somebody who sent nothing — verified in person, or by
                  telephone — still has to be recordable, so the forms stay; they are
                  just no longer the way every identity and registration gets in. */}
              <details className="group rounded-xl border bg-card">
                <summary className="cursor-pointer select-none px-6 py-4 text-sm font-medium">
                  Record by hand{' '}
                  <span className="font-normal text-muted-foreground">
                    — for somebody who has submitted nothing to confirm
                  </span>
                </summary>
                <div className="grid gap-6 p-6 pt-0 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Record an identity</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="space-y-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          setConfirmIdentity(true);
                        }}
                      >
                        <div className="space-y-1.5">
                          <Label htmlFor="nin">NIN, as it appears on the slip</Label>
                          <Input
                            id="nin"
                            value={nin}
                            onChange={(event) => setNin(event.target.value.replace(/\D/g, ''))}
                            inputMode="numeric"
                            className="tabular tracking-wider"
                            autoComplete="off"
                          />
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            The number is turned into a keyed digest and its last four digits. It is
                            never stored, logged or returned — so check it before you submit,
                            because nobody can read it back afterwards.
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="nin-name-match">
                            Does the name on the slip match the account?
                          </Label>
                          <Select value={nameMatch} onValueChange={setNameMatch}>
                            <SelectTrigger id="nin-name-match">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Yes, it matches</SelectItem>
                              <SelectItem value="false">No, it does not</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Recording a mismatch is not a rejection. It stays on the record as its
                            own blocker until somebody settles which name is right.
                          </p>
                        </div>

                        <Button type="submit" disabled={nin.trim().length < 11}>
                          <BadgeCheck />
                          Record identity
                        </Button>
                        {nin.trim().length < 11 ? (
                          <p className="text-sm text-muted-foreground" aria-live="polite">
                            {nin.trim().length} of 11 digits entered.
                          </p>
                        ) : null}
                      </form>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Record a registration</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="space-y-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          setConfirmRegistration(true);
                        }}
                      >
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="regulator">Regulator</Label>
                            <Input
                              id="regulator"
                              value={regulator}
                              onChange={(event) => setRegulator(event.target.value.toUpperCase())}
                              placeholder="MDCN"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="folio">Folio or licence number</Label>
                            <Input
                              id="folio"
                              value={folioNumber}
                              onChange={(event) => setFolioNumber(event.target.value)}
                              placeholder="MDCN/12345"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="registration-status">Status on the register</Label>
                            <Select
                              value={registrationStatus}
                              onValueChange={setRegistrationStatus}
                            >
                              <SelectTrigger id="registration-status">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {REGISTRATION_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {humanise(status)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="expires">Expires (optional)</Label>
                            <Input
                              id="expires"
                              type="date"
                              value={expiresAt}
                              onChange={(event) => setExpiresAt(event.target.value)}
                            />
                          </div>
                        </div>

                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Only an active registration permits practice. Recording one that is
                          suspended or struck off is still worth doing — it is what the record
                          should say.
                        </p>

                        <Button
                          type="submit"
                          disabled={regulator.trim().length < 2 || folioNumber.trim().length < 3}
                        >
                          <BadgeCheck />
                          Record registration
                        </Button>
                        {regulator.trim().length < 2 || folioNumber.trim().length < 3 ? (
                          <p className="text-sm text-muted-foreground" aria-live="polite">
                            Enter the regulator and the licence number to continue.
                          </p>
                        ) : null}
                      </form>
                    </CardContent>
                  </Card>
                </div>
              </details>
            </TabsContent>

            <TabsContent value="credentials" className="pt-5">
              <CredentialsTab
                userId={selected.userId}
                practitionerName={selected.fullName}
                onConfirm={() => setTab('record')}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DecisionDialog
          open={confirmIdentity}
          onOpenChange={(next) => {
            if (next) return;
            setConfirmIdentity(false);
            recordIdentity.reset();
          }}
          title="Record this identity"
          object={`${selected.fullName} · NIN ending ${nin.trim().slice(-4)}`}
          consequence={
            <p>
              Their identity is recorded from this number, with the name on the slip{' '}
              <strong>{nameMatch === 'true' ? 'matching' : 'not matching'}</strong> the account.
              {nameMatch === 'true'
                ? ''
                : ' A mismatch is not a rejection; it stays as a blocker until somebody settles which name is right.'}{' '}
              The number is turned into a keyed digest and its last four digits. It is never stored,
              logged or returned.
            </p>
          }
          reversibility={{
            tone: 'open',
            label: 'You can correct this.',
            detail:
              'Recording it again replaces what is kept. Nobody can read the number back to check it, so check it first.',
          }}
          confirmLabel="Record identity"
          loading={recordIdentity.isPending}
          error={recordIdentity.isError ? errorMessage(recordIdentity.error) : null}
          onConfirm={() => recordIdentity.mutate()}
        />

        <DecisionDialog
          open={confirmRegistration}
          onOpenChange={(next) => {
            if (next) return;
            setConfirmRegistration(false);
            recordRegistration.reset();
          }}
          title="Record this registration"
          object={`${selected.fullName} · ${regulator.trim()} ${folioNumber.trim()}`}
          consequence={
            <p>
              The registration is recorded as{' '}
              <strong>{humanise(registrationStatus).toLowerCase()}</strong>
              {expiresAt ? `, expiring ${formatDate(expiresAt)}` : ', with no expiry date'}.{' '}
              {registrationStatus === 'ACTIVE'
                ? 'An active registration permits practice.'
                : 'Only an active registration permits practice; this is recorded because it is what the record should say.'}
            </p>
          }
          reversibility={{
            tone: 'open',
            label: 'You can correct this.',
            detail: 'Recording it again for the same regulator replaces what is kept.',
          }}
          confirmLabel="Record registration"
          loading={recordRegistration.isPending}
          error={recordRegistration.isError ? errorMessage(recordRegistration.error) : null}
          onConfirm={() => recordRegistration.mutate()}
        />

        <ConfirmDialog
          open={standingFor !== null}
          onOpenChange={(next) => !next && setStandingFor(null)}
          title="Record their level and category"
          object={`${selected.fullName}${standingFor ? ` · ${standingFor.regulator} ${standingFor.folioNumber}` : ''}`}
          consequence={
            standingFor ? (
              <>
                Level:{' '}
                <strong>
                  {standingFor.cadreLevel?.name ?? 'Not recorded'} →{' '}
                  {levelName(standing.level || standingFor.cadreLevel?.id || NONE)}
                </strong>
                . Registration category:{' '}
                <strong>
                  {standingFor.registrationCategory?.name ?? 'Not recorded'} →{' '}
                  {categoryOfStanding(
                    standing.category || standingFor.registrationCategory?.id || NONE,
                  )}
                </strong>
                . Saved on their registration and written to the audit trail.
              </>
            ) : null
          }
          reversible="Set it again from here; each change is kept in the audit trail."
          confirmLabel="Record level and category"
          loading={recordStanding.isPending}
          onConfirm={() => recordStanding.mutate()}
        />
      </>
    );
  }

  const rows = directory.data?.practitioners ?? [];
  const nextCursor = directory.data?.nextCursor ?? null;
  const outstanding = rows.filter(
    (row) => !row.identityRecorded || !row.registrationRecorded,
  ).length;
  const activeCount = applied ? 1 : 0;

  function clearFilters() {
    setSearch('');
    setApplied('');
    pager.startOver();
  }

  // Arrived on `?user=` from the credentials queue: say so while that person is being fetched, and
  // say so if they cannot be, rather than showing the directory as though nothing was asked.
  if (wanted && linked.isPending) {
    return (
      <>
        <PageHeader title="Practitioner" description="Opening their record." />
        <ListSkeleton rows={2} label="Opening their record" />
      </>
    );
  }
  if (wanted && (linked.isError || (linked.data && !linked.data.practitioners?.length))) {
    return (
      <>
        <PageHeader title="Practitioner" />
        {linked.isError ? (
          <ErrorState
            error={linked.error}
            onRetry={() => void linked.refetch()}
            retrying={linked.isFetching}
          />
        ) : (
          <EmptyState
            icon={<UserRound />}
            title="That practitioner could not be found"
            description="The link may be out of date. Open the directory to look for them."
          />
        )}
        <div className="mt-4">
          <Button variant="outline" onClick={() => router.replace('/admin/practitioners')}>
            <ArrowLeft />
            All practitioners
          </Button>
        </div>
      </>
    );
  }

  const waiting = queue === 'waiting';
  const columns: Column<Entry>[] = [
    {
      id: 'practitioner',
      header: 'Practitioner',
      role: 'identity',
      cell: (row) => (
        <span className="flex items-center gap-3">
          <Avatar entry={row} />
          <span className="min-w-0">
            <span className="block">{row.fullName}</span>
            <span className="block font-mono text-sm font-normal text-muted-foreground">
              {row.phone}
            </span>
            <span className="block text-sm font-normal text-muted-foreground">
              {categoryName(row.professionalCategoryId) ?? 'No profile yet'}
              {row.yearsOfExperience !== null ? ` · ${row.yearsOfExperience} years` : ''}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: 'application',
      header: 'Application',
      cell: (row) =>
        row.submittedForReviewAt ? (
          <QueueAge since={row.submittedForReviewAt} label="Submitted" />
        ) : (
          'Not submitted'
        ),
    },
    {
      id: 'identity',
      header: 'Identity',
      cell: (row) => <Recorded recorded={row.identityRecorded} />,
    },
    {
      id: 'registration',
      header: 'Registration',
      cell: (row) => <Recorded recorded={row.registrationRecorded} />,
    },
    {
      id: 'status',
      header: 'Account',
      role: 'status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Practitioners"
        description="Practitioners join the queue when they submit for approval, so you are never reviewing something half-finished. Open one to see what is on record and to enter an identity or a professional registration — neither is something a practitioner can do for themselves."
      />

      <Tabs
        value={queue}
        onValueChange={(next) => {
          setQueue(next as Queue);
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Which practitioners">
          {QUEUES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        searchLabel="Search by name or number"
        searchPlaceholder="Adaeze, or 0803 123 4567"
        searchValue={search}
        onSearchChange={setSearch}
        onSubmit={() => {
          setApplied(search.trim());
          pager.startOver();
        }}
        activeCount={activeCount}
        onClear={clearFilters}
        busy={directory.isFetching && !directory.isPending}
        summary={
          !directory.isPending && rows.length > 0
            ? `${rows.length} on this page${
                outstanding > 0 ? ` · ${outstanding} missing identity or registration` : ''
              }`
            : undefined
        }
      />

      {directory.isPending ? (
        <TableSkeleton label="Loading practitioners" columns={5} />
      ) : directory.isError && !directory.data ? (
        <ErrorState
          error={directory.error}
          onRetry={() => void directory.refetch()}
          retrying={directory.isFetching}
        />
      ) : rows.length === 0 ? (
        applied ? (
          <FilteredEmpty noun="practitioners" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<UserRound />}
            title={
              queue === 'waiting'
                ? 'Nobody is waiting for approval'
                : queue === 'draft'
                  ? 'Everybody has submitted'
                  : 'No practitioners yet'
            }
            description={
              queue === 'waiting'
                ? 'Somebody appears here the moment they submit their application.'
                : queue === 'draft'
                  ? 'Anybody still filling in their profile, availability or documents would be listed here.'
                  : 'They appear here as soon as somebody completes registration.'
            }
          />
        )
      ) : (
        <>
          {directory.isError ? (
            <p
              role="alert"
              className="mb-3 flex flex-wrap items-center gap-3 text-sm font-medium text-destructive-text"
            >
              Could not refresh this list, so it may be out of date.
              <Button
                variant="outline"
                size="sm"
                loading={directory.isFetching}
                onClick={() => void directory.refetch()}
              >
                Try again
              </Button>
            </p>
          ) : null}
          <DataTable
            caption={
              queue === 'all'
                ? 'All practitioners'
                : `Practitioners: ${queueLabel(queue).toLowerCase()}`
            }
            rows={rows}
            columns={columns}
            getKey={(row) => row.userId}
            actionHeader="Next step"
            action={(row) => (
              <Button
                size="sm"
                variant={waiting && row.submittedForReviewAt ? 'default' : 'outline'}
                aria-label={`${waiting && row.submittedForReviewAt ? 'Review' : 'Open'} ${row.fullName}`}
                onClick={() => setSelected(row)}
              >
                {waiting && row.submittedForReviewAt ? 'Review' : 'Open'}
              </Button>
            )}
          />
        </>
      )}

      <Pager
        pageIndex={pager.pageIndex}
        hasNext={Boolean(nextCursor)}
        busy={directory.isFetching}
        onPrevious={pager.goPrevious}
        onNext={() => pager.goNext(nextCursor)}
      />
    </>
  );
}

const queueLabel = (queue: Queue) => QUEUES.find(([value]) => value === queue)?.[1] ?? queue;

/** Whether an identity or a registration is on record: icon and word, never colour alone. */
function Recorded({ recorded }: { recorded: boolean }) {
  return recorded ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
      Recorded
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-medium text-warning">
      <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
      Missing
    </span>
  );
}
