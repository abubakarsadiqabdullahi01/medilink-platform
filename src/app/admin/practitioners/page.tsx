'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Search,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { formatAgo, formatWhen } from '@/components/app/format';
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

  const [regulator, setRegulator] = useState('MDCN');
  const [folioNumber, setFolioNumber] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('ACTIVE');
  const [expiresAt, setExpiresAt] = useState('');

  /**
   * Cursor paging, not page numbers.
   *
   * The endpoint pages by cursor, which has no notion of "page 7" and no total
   * to divide — and that is the right trade for a list people are inserted
   * into constantly, because offset paging quietly shows the same person twice
   * when somebody registers between one page and the next. Keeping the cursor
   * that opened each page is what buys a working Previous on top of it.
   */
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  const directory = useQuery({
    queryKey: ['practitioner-directory', applied, cursor, queue],
    queryFn: async () => {
      const search = applied ? `&search=${encodeURIComponent(applied)}` : '';
      const from = cursor ? `&cursor=${cursor}` : '';
      const which = queue === 'all' ? '' : `&application=${queue}`;
      return api.get<{ practitioners?: Entry[]; nextCursor?: string | null }>(
        `/api/v1/practitioners?scopeType=PLATFORM&limit=${PAGE_SIZE}${which}${search}${from}`,
      );
    },
    // Keeps the page under the cursor while the next one loads, instead of
    // collapsing to skeletons every time somebody steps forward.
    placeholderData: (previous) => previous,
  });

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

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
      refresh();
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
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
      refresh();
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
  });

  const categoryName = (id: string | null) =>
    (reference.data?.professionalCategories ?? []).find((row) => row.id === id)?.name ?? null;

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
                    <Alert variant="destructive">
                      <TriangleAlert />
                      <AlertDescription>Their eligibility could not be loaded.</AlertDescription>
                    </Alert>
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

              <StandingPanel userId={selected.userId} onChanged={refresh} />

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">On record</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {verification.isPending ? (
                    <Skeleton className="h-24 w-full" />
                  ) : verification.isError ? (
                    <Alert variant="destructive">
                      <TriangleAlert />
                      <AlertDescription>
                        Their verification record could not be loaded.
                      </AlertDescription>
                    </Alert>
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
                          recordIdentity.mutate();
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
                          <Label>Does the name on the slip match the account?</Label>
                          <Select value={nameMatch} onValueChange={setNameMatch}>
                            <SelectTrigger>
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

                        <Button
                          type="submit"
                          loading={recordIdentity.isPending}
                          disabled={nin.trim().length < 11}
                        >
                          <BadgeCheck />
                          Record identity
                        </Button>
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
                          recordRegistration.mutate();
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
                            <Label>Status on the register</Label>
                            <Select
                              value={registrationStatus}
                              onValueChange={setRegistrationStatus}
                            >
                              <SelectTrigger>
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
                          loading={recordRegistration.isPending}
                          disabled={regulator.trim().length < 2 || folioNumber.trim().length < 3}
                        >
                          <BadgeCheck />
                          Record registration
                        </Button>
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
      </>
    );
  }

  const rows = directory.data?.practitioners ?? [];
  const nextCursor = directory.data?.nextCursor ?? null;
  const outstanding = rows.filter(
    (row) => !row.identityRecorded || !row.registrationRecorded,
  ).length;

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
          startOver();
        }}
        className="mb-4"
      >
        <TabsList>
          {QUEUES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
              startOver();
            }}
          >
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label htmlFor="search">Search by name or number</Label>
              <Input
                id="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Adaeze, or 0803 123 4567"
              />
            </div>
            <Button type="submit" loading={directory.isFetching}>
              <Search />
              Search
            </Button>
            {applied ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setApplied('');
                  startOver();
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>

          {!directory.isPending && rows.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {rows.length} on this page
              {outstanding > 0 ? ` · ${outstanding} missing identity or registration` : null}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {directory.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : directory.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>The directory could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UserRound />}
          title={
            applied
              ? 'Nobody matches that'
              : queue === 'waiting'
                ? 'Nobody is waiting for approval'
                : queue === 'draft'
                  ? 'Everybody has submitted'
                  : 'No practitioners yet'
          }
          description={
            applied
              ? 'Try part of a name, or the number they registered with.'
              : queue === 'waiting'
                ? 'Somebody appears here the moment they submit their application.'
                : queue === 'draft'
                  ? 'Anybody still filling in their profile, availability or documents would be listed here.'
                  : 'They appear here as soon as somebody completes registration.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.userId}>
              <button
                type="button"
                onClick={() => setSelected(row)}
                className="w-full rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex items-center gap-4">
                  <Avatar entry={row} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.fullName}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {row.phone}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {categoryName(row.professionalCategoryId) ?? 'No profile yet'}
                      {row.yearsOfExperience !== null ? ` · ${row.yearsOfExperience} years` : ''}
                    </p>
                  </div>

                  {/* What an officer is scanning this list for: who still
                      needs something recorded. */}
                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    {row.submittedForReviewAt ? (
                      <span className="rounded-full bg-info/10 px-2 py-0.5 text-[0.7rem] font-medium text-info">
                        Submitted {formatAgo(row.submittedForReviewAt)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
                        Not submitted
                      </span>
                    )}
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
                        row.identityRecorded
                          ? 'bg-success/10 text-success'
                          : 'bg-warning/10 text-warning',
                      )}
                    >
                      {row.identityRecorded ? 'Identity' : 'No identity'}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
                        row.registrationRecorded
                          ? 'bg-success/10 text-success'
                          : 'bg-warning/10 text-warning',
                      )}
                    >
                      {row.registrationRecorded ? 'Registration' : 'No registration'}
                    </span>
                  </div>

                  <StatusBadge status={row.status} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (pageIndex > 0 || nextCursor) ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pageIndex === 0 || directory.isFetching}
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
          >
            <ChevronLeft />
            Previous
          </Button>

          <p className="tabular text-xs text-muted-foreground">
            Page {pageIndex + 1}
            {directory.isFetching ? ' · loading' : ''}
          </p>

          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor || directory.isFetching}
            onClick={() => {
              if (!nextCursor) return;
              // Recorded against the page it opens, so Previous can walk back
              // through exactly the cursors that were used on the way out.
              setCursors((current) => {
                const next = current.slice(0, pageIndex + 1);
                next.push(nextCursor);
                return next;
              });
              setPageIndex((index) => index + 1);
            }}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </>
  );
}
