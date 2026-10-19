'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
import { REASON_GUIDE, type CredentialNeed } from '@/modules/practitioners/domain/not-offered';

export interface Profile {
  id: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  yearsOfExperience: number;
  bio: string | null;
  photoObjectKey: string | null;
  homeStateId: string | null;
  homeLgaId: string | null;
  travelPreference: string;
  /** Null until they submit for approval. */
  submittedForReviewAt: string | null;
}

/**
 * Where their application stands, in the order they live it:
 * DRAFT (something of theirs is missing) → READY (all done, not yet sent) →
 * WAITING (sent; an officer has it) → APPROVED (they can be offered work).
 * An officer refusing something they must supply puts them in CHANGES_NEEDED:
 * they replace it, then send the application again.
 */
export type ApplicationState = 'DRAFT' | 'CHANGES_NEEDED' | 'READY' | 'WAITING' | 'APPROVED';

export interface Eligibility {
  eligible: boolean;
  blockers: string[];
  /** The required documents still outstanding and where each stands (absent from an older answer). */
  credentials?: CredentialNeed[];
  /** What keeps an approved practitioner from being offered shifts although the rule is met. */
  alsoStopsOffers?: string[];
}

export interface CredentialSubmission {
  id: string;
  credentialTypeId: string;
  status: string;
  reviewNotes?: string | null;
}

/**
 * The practitioner's own profile, or `null` until they create one.
 *
 * A missing profile is the *normal* state of a newcomer, not a failure, so a
 * 404 is turned into a value. Left as an error it caused a loop: TanStack
 * Query puts an errored query with no data back to "pending" every time it
 * refetches, and it refetches on every new observer — so a page that waited
 * for `isPending` to clear, and mounted a form that read the same query once
 * it did, unmounted that form again a moment later, indefinitely. As `null` it
 * is cached data like any other: fresh for `staleTime`, not retried on mount.
 */
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      try {
        return await api.get<Profile>('/api/v1/practitioners/me');
      } catch (error) {
        if (error instanceof ApiError && error.failure.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  });
}

/**
 * The caller's own photograph as a displayable URL, or `null` when there is
 * none. One query, shared by the top bar, the profile header and the upload
 * control, so uploading or removing a photograph changes all three at once.
 *
 * The URL is signed and lives five minutes, so it is refreshed a little before
 * that rather than left to turn into a broken image in a tab left open.
 */
export function usePhoto() {
  const profile = useProfile();
  const hasPhoto = Boolean(profile.data?.photoObjectKey);
  const photo = useQuery({
    queryKey: ['photo-url'],
    queryFn: () => api.post<{ url: string }>('/api/v1/practitioners/me/photo-url'),
    enabled: hasPhoto,
    retry: false,
    staleTime: 4 * 60_000,
    refetchInterval: 4 * 60_000,
  });
  return { hasPhoto, url: hasPhoto ? (photo.data?.url ?? null) : null };
}

export function useEligibility() {
  return useQuery({
    queryKey: ['eligibility'],
    queryFn: () => api.get<Eligibility>('/api/v1/practitioners/eligibility?scopeType=SELF'),
    retry: false,
  });
}

/** The blockers a practitioner can clear themselves; every other one waits on Medilink. */
export const THEIR_BLOCKERS = ['profile_incomplete', 'credential_missing', 'credential_expired'];

/**
 * How far through starting out somebody is.
 *
 * One place, because two screens ask — the overview, to offer a way back in,
 * and the profile page, to decide whether to walk somebody through it — and
 * two copies of "what counts as done" drift. They share query keys with the
 * sections themselves (`availability`, `my-credentials`), so finishing a step
 * updates both without a second request.
 *
 * Availability is a step although it is not an eligibility blocker: with no
 * weekly pattern the matcher has nothing to check a shift against, so the
 * outcome for the practitioner is identical — no offers.
 */
export function usePractitionerSetup() {
  const profile = useProfile();
  const eligibility = useEligibility();
  const availability = useQuery({
    queryKey: ['availability'],
    queryFn: () =>
      api.get<{ slots: unknown[]; blocks: unknown[] }>('/api/v1/availability?scopeType=SELF'),
  });
  const submissions = useQuery({
    queryKey: ['my-credentials'],
    queryFn: async () =>
      (
        await api.get<{ submissions?: CredentialSubmission[] }>(
          '/api/v1/credentials?scopeType=SELF',
        )
      ).submissions ?? [],
  });

  const reference = useReference();
  const blockers = eligibility.data?.blockers ?? [];
  const hasProfile = Boolean(profile.data);
  const hasAvailability = (availability.data?.slots.length ?? 0) > 0;
  const documentsDone =
    hasProfile &&
    eligibility.isSuccess &&
    !blockers.some((b) => b === 'credential_missing' || b === 'credential_expired');

  const steps = [
    {
      key: 'details',
      label: 'Your details',
      done: hasProfile,
      href: '/practitioner/profile?tab=profile',
    },
    {
      key: 'availability',
      label: 'When you can work',
      done: hasAvailability,
      href: '/practitioner/profile?tab=availability',
    },
    {
      key: 'documents',
      label: 'Your documents',
      done: documentsDone,
      href: '/practitioner/profile?tab=credentials',
    },
  ];

  const eligible = eligibility.data?.eligible ?? false;
  const submittedForReviewAt = profile.data?.submittedForReviewAt ?? null;
  const allDone = steps.every((step) => step.done);
  // Somebody who can already be offered work is approved whether or not they
  // ever pressed the button — accounts that predate it must not be asked to.
  //
  // What an officer refused and the practitioner has not yet replaced. Only
  // for credentials the profession requires — refusing an optional one does not
  // send the application back — and only the latest answer per type, so a
  // replacement that is waiting or verified clears the old rejection.
  const live = new Set(
    (submissions.data ?? [])
      .filter((row) => ['PENDING', 'MORE_INFO_REQUESTED', 'VERIFIED'].includes(row.status))
      .map((row) => row.credentialTypeId),
  );
  const requiredIds = new Set(
    (reference.data?.credentialTypes ?? [])
      .filter((type) => profile.data && type.requiredForCategoryIds.includes(profile.data.professionalCategoryId))
      .map((type) => type.id),
  );
  const rejected = (submissions.data ?? []).filter(
    (row) => row.status === 'REJECTED' && requiredIds.has(row.credentialTypeId) && !live.has(row.credentialTypeId),
  );
  const state: ApplicationState = eligible
    ? 'APPROVED'
    : rejected.length > 0
      ? 'CHANGES_NEEDED'
      : submittedForReviewAt
        ? 'WAITING'
        : allDone
          ? 'READY'
          : 'DRAFT';

  // Latched: once everything has answered, a background refetch must not take
  // the page away again. An errored query flips back to pending while it
  // retries, and "ready" flapping would remount whatever it gates.
  const answered = useRef(false);
  if (!profile.isPending && !availability.isPending && !eligibility.isPending) {
    answered.current = true;
  }

  return {
    ready: answered.current,
    profile: profile.data ?? null,
    categoryId: profile.data?.professionalCategoryId ?? null,
    hasProfile,
    hasAvailability,
    documentsDone,
    blockers,
    eligible,
    credentials: eligibility.data?.credentials,
    alsoStopsOffers: eligibility.data?.alsoStopsOffers ?? [],
    submissions: submissions.data ?? [],
    steps,
    doneCount: steps.filter((step) => step.done).length,
    state,
    rejected,
    submittedForReviewAt,
    // What is still the practitioner's to do: finish a step, or send it.
    setupNeeded: state === 'DRAFT' || state === 'READY' || state === 'CHANGES_NEEDED',
  };
}

export interface BlockerGuide {
  says: string;
  href?: string;
  action?: string;
}

/**
 * What each reason means and who can clear it. Written once, beside the rule, in
 * `modules/practitioners/domain/not-offered.ts`, so that a blocker added to the rule cannot reach
 * a practitioner as its code with the underscores taken out; this keeps the name the older screens
 * already import.
 */
export const BLOCKER_GUIDE: Record<string, BlockerGuide> = REASON_GUIDE;
