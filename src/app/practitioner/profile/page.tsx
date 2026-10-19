'use client';

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, CircleCheck, Clock } from 'lucide-react';
import { usePractitionerSetup } from '@/lib/ui/practitioner';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/app/page-shell';
import { ErrorState, LoadingStatus } from '@/components/app/states';
import { formatWhen } from '@/components/app/format';
import { AvailabilitySection } from './availability-section';
import { CredentialsSection } from './credentials-section';
import { INTRO } from './copy';
import { PrivacySection } from './privacy-section';
import { ProfileForm } from './profile-form';
import { OnRecord, ProfileSummary } from './profile-summary';
import { ReturnedNotice } from './returned-notice';
import { SetupWizard } from './setup-wizard';

/** What the setup checks stand on; the keys `usePractitionerSetup` reads. */
const SETUP_QUERIES = ['profile', 'eligibility', 'availability', 'my-credentials'] as const;

const TABS = [
  ['profile', 'Profile'],
  ['credentials', 'Credentials'],
  ['availability', 'Availability'],
  ['privacy', 'Privacy'],
] as const;

/**
 * Everything about the practitioner as a person, in one place: who they are,
 * what they have proved, when they can work and what Medilink may do with it.
 *
 * It used to be four sidebar items — Profile, Credentials, Availability, Your
 * data — and a newcomer had to discover that all four were the same job. A
 * practitioner who has not finished starting out is walked through it as a
 * wizard; once they have, or if they choose to skip, it is a tabbed page they
 * can come back to. `?tab=` deep-links a tab, which is how the overview and the
 * old URLs point at the one thing somebody has to do.
 */
export default function MyProfilePage() {
  return (
    <Suspense
      fallback={
        <>
          <LoadingStatus label="Loading your profile" />
          <Skeleton className="h-96 w-full" />
        </>
      }
    >
      <MyProfile />
    </Suspense>
  );
}

function MyProfile() {
  const session = useSession();
  const router = useRouter();
  const tab = useSearchParams().get('tab');
  const setup = usePractitionerSetup();

  // Decided once, when the data first arrives. Finishing the last step makes
  // setup "complete" and would otherwise throw the practitioner out of the
  // wizard before they had seen the final screen.
  const startedInSetup = useRef<boolean | null>(null);
  if (setup.ready && startedInSetup.current === null) startedInSetup.current = setup.setupNeeded;
  const inWizard = !tab && startedInSetup.current === true;

  function goTab(next: string) {
    router.replace(`/practitioner/profile?tab=${next}`, { scroll: false });
  }
  function resumeSetup() {
    startedInSetup.current = true;
    router.replace('/practitioner/profile', { scroll: false });
  }

  // A request that failed with nothing to show is a failure, not "no profile yet": left alone the
  // setup checks read it as an empty answer and invite a person who already has a profile to
  // create one. (A refetch that fails over data already on screen is not this: the page stays.)
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const failedKey = SETUP_QUERIES.find((key) => {
    const state = queryClient.getQueryState([key]);
    return state?.status === 'error' && state.data === undefined;
  });

  if (failedKey) {
    return (
      <div>
        <PageHeader
          title="My profile"
          description={`${session.user.fullName} · ${session.user.phone}`}
        />
        <ErrorState
          error={queryClient.getQueryState([failedKey])?.error}
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            void Promise.all(
              SETUP_QUERIES.map((key) => queryClient.refetchQueries({ queryKey: [key] })),
            ).finally(() => setRetrying(false));
          }}
        />
      </div>
    );
  }

  if (!setup.ready) {
    return (
      <div>
        <PageHeader
          title="My profile"
          description={`${session.user.fullName} · ${session.user.phone}`}
        />
        <LoadingStatus label="Loading your profile" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (inWizard) {
    return (
      <SetupWizard
        done={setup.steps.map((step) => step.done)}
        categoryId={setup.categoryId}
        blockers={setup.blockers}
        submissions={setup.submissions}
        submittedAt={setup.submittedForReviewAt}
        onSkip={() => goTab('profile')}
        onFinish={() => goTab('profile')}
      />
    );
  }

  const current = TABS.some(([value]) => value === tab) ? (tab as string) : 'profile';
  // A dot on the tab that still has something for them to do.
  const needsAttention: Record<string, boolean> = {
    profile: !setup.hasProfile,
    credentials: setup.hasProfile && (!setup.documentsDone || setup.rejected.length > 0),
    availability: setup.hasProfile && !setup.hasAvailability,
  };

  return (
    <div>
      <PageHeader
        title="My profile"
        description="Your details, documents, availability and privacy settings, in one place."
      />

      {setup.profile ? <ProfileSummary profile={setup.profile} state={setup.state} /> : null}

      {setup.state === 'CHANGES_NEEDED' ? (
        <ReturnedNotice rejected={setup.rejected} className="mb-6" />
      ) : null}

      {setup.state === 'WAITING' ? (
        <Alert variant="info" className="mb-6">
          <Clock />
          <AlertDescription>
            <strong>Waiting for approval.</strong> You submitted{' '}
            {formatWhen(setup.submittedForReviewAt)}; an officer is checking your identity,
            professional registration and documents. You can keep editing — they review what is on
            file when they get to it.
          </AlertDescription>
        </Alert>
      ) : null}

      {setup.state === 'READY' ? (
        <Alert variant="info" className="mb-6">
          <CircleCheck />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>Everything is in.</strong> An officer does not start reviewing until you
              submit it for approval.
            </span>
            <Button size="sm" onClick={resumeSetup}>
              Review and submit
              <ArrowRight />
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {setup.state === 'DRAFT' ? (
        <Alert variant="warning" className="mb-6">
          <CircleAlert />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Your setup is not finished
              {!setup.hasProfile
                ? ': you have no profile yet'
                : !setup.hasAvailability
                  ? ': you have not said when you can work'
                  : ': a required document is missing'}
              . Until it is, you cannot be offered shifts.
            </span>
            <Button size="sm" onClick={resumeSetup}>
              Continue setup
              <ArrowRight />
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={current} onValueChange={goTab}>
        {/* Scrolls sideways on a phone rather than wrapping to a second row, which
            reads as two separate controls. */}
        <div className="-mx-1 mb-5 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            {TABS.map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="gap-2 whitespace-nowrap">
                {label}
                {needsAttention[value] ? (
                  <>
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                    <span className="sr-only">needs your attention</span>
                  </>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* The form takes two thirds and what Medilink has recorded sits beside it,
            so a wide screen reads both at once; a phone stacks them. */}
        <TabsContent
          value="profile"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
        >
          <ProfileForm />
          <OnRecord blockers={setup.blockers} eligible={setup.eligible} />
        </TabsContent>

        <TabsContent value="credentials">
          <Intro>{INTRO.credentials}</Intro>
          <CredentialsSection professionalCategoryId={setup.categoryId} />
        </TabsContent>

        <TabsContent value="availability">
          <Intro>{INTRO.availability}</Intro>
          <AvailabilitySection />
        </TabsContent>

        <TabsContent value="privacy">
          <Intro>{INTRO.privacy}</Intro>
          <PrivacySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Intro({ children }: { children: string }) {
  return <p className="mb-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{children}</p>;
}
