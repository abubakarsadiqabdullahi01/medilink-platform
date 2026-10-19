'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import {
  BLOCKER_GUIDE,
  THEIR_BLOCKERS,
  useProfile,
  type CredentialSubmission,
} from '@/lib/ui/practitioner';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { SuccessScreen } from '@/components/app/success-screen';
import { formatWhen } from '@/components/app/format';
import { AvailabilitySection } from './availability-section';
import { CredentialsSection } from './credentials-section';
import { INTRO } from './copy';
import { ProfileForm, TRAVEL } from './profile-form';
import { stepName } from './step-name';

const STEPS = [
  {
    label: 'Your details',
    caption: 'Profession, location and travel',
    title: 'Tell us about your practice',
    intro: INTRO.profile,
  },
  {
    label: 'When you can work',
    caption: 'Weekly pattern and time away',
    title: 'When can you work?',
    intro: INTRO.availability,
  },
  {
    label: 'Your documents',
    caption: 'Credentials for review',
    title: 'Submit your documents',
    intro: INTRO.credentials,
  },
  {
    label: 'Review and submit',
    caption: 'Send it for approval',
    title: 'Review and submit',
    intro:
      'Check everything is in, then send it for approval. An officer does not start reviewing until you do.',
  },
] as const;

/**
 * Starting out, one decision at a time.
 *
 * Four tabs of forms are a fine place to *maintain* a profile and a poor place
 * to *begin* one: a newcomer has no way to know which tab is first or that
 * there are only three things standing between them and their first offer.
 * So the first visit is a sequence, opened at the first thing not yet done.
 *
 * **What is saved, and when.** Not as you type. Details are saved by the button under them, a
 * weekly slot is saved the moment you add it, and a document is sent when you press Submit. Leaving
 * keeps all of that and loses only what was typed but not saved on the step you were on — and the
 * page says so, rather than promising that everything is kept.
 */
export function SetupWizard({
  done,
  categoryId,
  blockers,
  submissions,
  submittedAt,
  onSkip,
  onFinish,
}: {
  /** Details, availability, documents — in that order. */
  done: boolean[];
  /** When they submitted for approval; null while they have not. */
  submittedAt: string | null;
  categoryId: string | null;
  blockers: string[];
  submissions: CredentialSubmission[];
  onSkip: () => void;
  onFinish: () => void;
}) {
  const hasProfile = done[0] === true;
  const hasAvailability = done[1] === true;
  const documentsDone = done[2] === true;
  // Seeded once; the wizard stays mounted, so completing a step underneath the
  // person using it does not move them.
  const [step, setStep] = useState(!hasProfile ? 0 : !hasAvailability ? 1 : !documentsDone ? 2 : 3);
  // The fourth tick on the step list is "submitted", not a thing to do.
  const marks = [...done, Boolean(submittedAt)];
  const current = STEPS[step] ?? STEPS[0];
  const tasksDone = done.filter(Boolean).length;

  // Moving to another step puts focus on its heading and the heading at the top of the screen.
  // Without this the button that was pressed has gone, focus falls to the top of the document, and
  // a keyboard or screen-reader user has to find their way back to the form; on a phone the new
  // step opens scrolled to wherever the old one ended.
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const goToStep = useCallback((next: number) => {
    moved.current = true;
    setStep(next);
  }, []);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    // The finished screen takes focus itself, on its own heading.
    if (step === 3 && submittedAt) return;
    panel.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  }, [step, submittedAt]);

  return (
    <div>
      <PageHeader
        title="Set up your profile"
        description="Three short steps, then send it for approval. What you save stays saved, so you can leave and come back. Anything you have typed but not saved on the step you are on is not kept."
        action={
          <Button variant="ghost" className="-ml-3 sm:-mr-3 sm:ml-0" onClick={onSkip}>
            I&apos;ll do this later
          </Button>
        }
      />

      {/* A step list beside the content on a wide screen, so the page uses the
          width instead of stretching a form across it; a row of numbered
          circles above it everywhere narrower. */}
      <div className="grid items-start gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(0,1fr)]">
        <div>
          <div className="lg:hidden">
            <Stepper step={step} done={marks} reachable={hasProfile} onStep={goToStep} />
            <p className="tabular mt-1 text-sm text-muted-foreground">
              {tasksDone} of 3 tasks done. Step 4 sends it for approval.
            </p>
          </div>
          <div className="hidden lg:sticky lg:top-20 lg:block">
            <StepList
              step={step}
              done={marks}
              reachable={hasProfile}
              onStep={goToStep}
              tasksDone={tasksDone}
            />
          </div>
        </div>

        <div className="min-w-0">
          <div ref={panel} className="mb-5">
            <p className="tabular text-sm font-semibold uppercase tracking-wide text-primary">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2
              ref={heading}
              tabIndex={-1}
              className="mt-1 text-xl font-semibold tracking-tight outline-none"
            >
              {current.title}
            </h2>
            <p className="mt-1 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {current.intro}
            </p>
          </div>

          {step === 0 ? (
            <>
              <ProfileForm embedded onSaved={(created) => created && goToStep(1)} />
              <StepNav
                onNext={hasProfile ? () => goToStep(1) : undefined}
                nextLabel="Continue"
                note={hasProfile ? undefined : 'Create your profile to continue.'}
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <AvailabilitySection />
              <StepNav
                onBack={() => goToStep(0)}
                onNext={() => goToStep(2)}
                nextLabel={hasAvailability ? 'Continue' : 'Skip for now'}
                note={
                  hasAvailability ? undefined : 'Add at least one slot to be matched to shifts.'
                }
              />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <CredentialsSection
                professionalCategoryId={categoryId}
                leading={<RequiredDocuments categoryId={categoryId} submissions={submissions} />}
              />
              <StepNav
                onBack={() => goToStep(1)}
                onNext={() => goToStep(3)}
                nextLabel={documentsDone ? 'Continue' : 'Skip for now'}
                note={documentsDone ? undefined : 'A required document is still missing.'}
              />
            </>
          ) : null}

          {step === 3 ? (
            <ReviewStep
              done={done}
              blockers={blockers}
              submissions={submissions}
              submittedAt={submittedAt}
              onGo={goToStep}
              onFinish={onFinish}
              onBack={() => goToStep(2)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The vertical version, for a wide screen: every step named and described, with progress under it. */
function StepList({
  step,
  done,
  reachable,
  onStep,
  tasksDone,
}: {
  step: number;
  done: boolean[];
  reachable: boolean;
  onStep: (step: number) => void;
  tasksDone: number;
}) {
  return (
    <div className="space-y-5">
      <ol className="space-y-1" aria-label="Setup steps">
        {STEPS.map((item, index) => {
          const complete = done[index] === true;
          const enabled = index === 0 || reachable;
          return (
            <li key={item.label}>
              <button
                type="button"
                disabled={!enabled}
                onClick={() => onStep(index)}
                aria-label={stepName(index, STEPS.length, item.label, step, complete)}
                aria-current={step === index ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-start gap-3 rounded-lg p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  step === index ? 'bg-accent' : 'hover:bg-muted/60',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold',
                    complete
                      ? 'border-success bg-success text-success-foreground'
                      : step === index
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {complete ? <Check className="size-4" /> : index + 1}
                </span>
                <span className="min-w-0 pt-0.5" aria-hidden="true">
                  <span className="block text-base font-medium leading-tight">{item.label}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                    {item.caption}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="px-3">
        <div
          role="progressbar"
          aria-label="Tasks done"
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={tasksDone}
          aria-valuetext={`${tasksDone} of 3 tasks done`}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-success transition-[width] motion-reduce:transition-none"
            style={{ width: `${(tasksDone / 3) * 100}%` }}
          />
        </div>
        <p className="tabular mt-2 text-sm text-muted-foreground">{tasksDone} of 3 tasks done</p>
      </div>
    </div>
  );
}

/**
 * Numbered circles on a line, labels beside them.
 *
 * Labels are dropped on a phone: four do not fit across 375px, and the
 * heading under the stepper already names the step. Each button still carries its whole name.
 */
function Stepper({
  step,
  done,
  reachable,
  onStep,
}: {
  step: number;
  done: boolean[];
  reachable: boolean;
  onStep: (step: number) => void;
}) {
  return (
    <ol className="mb-1 flex items-center" aria-label="Setup steps">
      {STEPS.map((item, index) => {
        // The last step is where you arrive, not something you do, so it is
        // never ticked — it would read as finished before it had been opened.
        const complete = done[index] === true;
        const last = index === STEPS.length - 1;
        const enabled = index === 0 || reachable;
        return (
          <li key={item.label} className={cn('flex items-center', !last && 'flex-1')}>
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onStep(index)}
              aria-label={stepName(index, STEPS.length, item.label, step, complete)}
              aria-current={step === index ? 'step' : undefined}
              className="group flex min-h-11 min-w-11 items-center justify-center gap-2.5 rounded-md py-1 text-left disabled:cursor-not-allowed"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                  complete
                    ? 'border-success bg-success text-success-foreground'
                    : step === index
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground',
                  // Ticked and current at once (going back to a finished step):
                  // keep the tick, and mark where you are with a ring.
                  step === index && 'ring-4 ring-primary/20',
                  !enabled && 'opacity-60',
                  enabled && step !== index && 'group-hover:border-primary/60',
                )}
              >
                {complete ? <Check className="size-4" /> : index + 1}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  // Labels only where there is room for all four; on a phone the
                  // heading below already names the step you are on.
                  'hidden text-sm leading-tight sm:inline',
                  step === index ? 'font-semibold' : 'text-muted-foreground',
                  !enabled && 'opacity-60',
                )}
              >
                {item.label}
              </span>
            </button>
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  'mx-1 h-0.5 flex-1 rounded-full sm:mx-3',
                  complete ? 'bg-success' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
  note,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel: string;
  note?: string;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {onBack ? (
          <Button variant="outline" onClick={onBack} className="w-full sm:w-auto">
            <ArrowLeft />
            Back
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        {note ? (
          <span id="step-nav-note" className="text-sm text-muted-foreground">
            {note}
          </span>
        ) : null}
        {onNext ? (
          <Button
            onClick={onNext}
            variant={nextLabel === 'Skip for now' ? 'outline' : 'default'}
            aria-describedby={note ? 'step-nav-note' : undefined}
            className="w-full sm:w-auto"
          >
            {nextLabel}
            <ArrowRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The documents this profession must have, as a checklist, above the form that submits them. */
function RequiredDocuments({
  categoryId,
  submissions,
}: {
  categoryId: string | null;
  submissions: CredentialSubmission[];
}) {
  const reference = useReference();
  const required = (reference.data?.credentialTypes ?? []).filter(
    (type) => categoryId && type.requiredForCategoryIds.includes(categoryId),
  );

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">What your profession requires</CardTitle>
      </CardHeader>
      <CardContent>
        {reference.isPending ? (
          <ListSkeleton rows={2} label="Loading the documents your profession requires" />
        ) : reference.isError ? (
          <ErrorState
            compact
            error={reference.error}
            onRetry={() => void reference.refetch()}
            retrying={reference.isFetching}
          />
        ) : required.length === 0 ? (
          <p className="text-base text-muted-foreground">
            No documents are required for your profession right now. You can still add optional ones
            below; a reviewer checks each by hand.
          </p>
        ) : (
          <ul className="divide-y">
            {required.map((type) => {
              const mine = submissions.find(
                (row) =>
                  row.credentialTypeId === type.id &&
                  row.status !== 'REJECTED' &&
                  row.status !== 'EXPIRED',
              );
              return (
                <li
                  key={type.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-base first:pt-0 last:pb-0"
                >
                  <span className="flex items-center gap-2">
                    {mine?.status === 'VERIFIED' ? (
                      <CircleCheck className="size-4 text-success" aria-hidden="true" />
                    ) : (
                      <CircleAlert className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    {type.name}
                  </span>
                  <StatusBadge status={mine ? mine.status : 'NOT_SUBMITTED'} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** What each of the three things is, and where to go when it is not done. */
const CHECKLIST = [
  {
    label: 'Your details',
    todo: 'Create your profile.',
    action: 'Add details',
  },
  {
    label: 'When you can work',
    todo: 'Add at least one weekly slot.',
    action: 'Set availability',
  },
  {
    label: 'Your documents',
    todo: 'A required document has not been submitted.',
    action: 'Add documents',
  },
] as const;

/** What happens after the button, in order, with who does it. No promise about how long. */
const WHAT_HAPPENS_NEXT = [
  'An officer checks your identity, your professional registration and the documents you sent, by hand.',
  'If something is wrong or missing, they say what, in their own words, here and on your overview. You fix it and send it again.',
  'When it is approved you can be offered shifts. Until then none are offered.',
];

/**
 * The last step: read it back, then send it.
 *
 * Nothing is reviewed until this is pressed, and the page says so — a practitioner who has filled
 * everything in and then waits has no way to know that nobody has been told. So the page lists
 * what the officer will be given (the details, the availability, each document and where it
 * stands), with a way to change each, and says what happens next. Until the checklist is complete
 * the button stays off, and each missing item is a button that goes to where it is fixed, so "you
 * are not finished" always comes with the way to finish.
 */
function ReviewStep({
  done,
  blockers,
  submissions,
  submittedAt,
  onGo,
  onFinish,
  onBack,
}: {
  done: boolean[];
  blockers: string[];
  submissions: CredentialSubmission[];
  submittedAt: string | null;
  onGo: (step: number) => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const reference = useReference();
  const profile = useProfile();
  // The same key and request the setup checks use, so this costs no second fetch.
  const availability = useQuery({
    queryKey: ['availability'],
    queryFn: () =>
      api.get<{ slots: unknown[]; blocks: unknown[] }>('/api/v1/availability?scopeType=SELF'),
  });
  const waiting = blockers.filter((blocker) => !THEIR_BLOCKERS.includes(blocker));
  const complete = done.every(Boolean);

  const submit = useMutation({
    mutationFn: () => api.post('/api/v1/practitioners/me/submit', {}),
    onSuccess: () => {
      toast.success('Submitted for approval');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
    },
  });

  if (submittedAt) {
    return (
      <div className="space-y-5">
        <SuccessScreen
          title="Submitted — waiting for approval"
          description={`Sent ${formatWhen(submittedAt)}. There is nothing more for you to do.`}
          steps={WHAT_HAPPENS_NEXT}
          actions={<Button onClick={onFinish}>Go to my profile</Button>}
        />

        {waiting.length > 0 ? (
          <Card className="mx-auto max-w-xl">
            <CardContent className="pt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                What the officer is checking
              </h3>
              <ul className="mt-2 space-y-1.5 text-base text-muted-foreground">
                {waiting.map((blocker) => (
                  <li key={blocker}>· {BLOCKER_GUIDE[blocker]?.says ?? humanise(blocker)}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  const category = profile.data
    ? nameOf(reference.data?.professionalCategories, profile.data.professionalCategoryId)
    : null;
  const specialty = profile.data?.specialtyId
    ? nameOf(reference.data?.specialties, profile.data.specialtyId)
    : null;
  const place = profile.data
    ? [
        profile.data.homeLgaId ? nameOf(reference.data?.lgas, profile.data.homeLgaId) : null,
        profile.data.homeStateId ? nameOf(reference.data?.states, profile.data.homeStateId) : null,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const travel = TRAVEL.find(([value]) => value === profile.data?.travelPreference)?.[1];
  const slots = availability.data?.slots.length;
  const sent = submissions.filter((row) => row.status !== 'REJECTED' && row.status !== 'EXPIRED');

  const facts: Record<number, React.ReactNode> = {
    0: profile.data ? (
      <>
        {[
          category,
          specialty,
          `${profile.data.yearsOfExperience} year${profile.data.yearsOfExperience === 1 ? '' : 's'} of experience`,
        ]
          .filter(Boolean)
          .join(' · ')}
        <span className="block">{place || 'No home area given'}</span>
        <span className="block">Will travel: {travel ? travel.toLowerCase() : '—'}</span>
      </>
    ) : null,
    1:
      slots === undefined ? null : `${slots} weekly slot${slots === 1 ? '' : 's'} in your pattern.`,
    2:
      sent.length === 0 ? (
        'Nothing sent yet.'
      ) : (
        <ul className="mt-1 space-y-1.5">
          {sent.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <span>{nameOf(reference.data?.credentialTypes, row.credentialTypeId)}</span>
              <StatusBadge status={row.status} />
            </li>
          ))}
        </ul>
      ),
  };

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex items-start gap-3">
          {complete ? (
            <Sparkles className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          )}
          <div>
            <p className="text-base font-semibold">
              {complete ? 'Everything is in. Ready to submit.' : 'Not quite ready to submit'}
            </p>
            <p className="mt-1 text-base leading-relaxed text-muted-foreground">
              {complete
                ? 'Nothing is reviewed until you submit. This is what the officer will be given.'
                : 'Finish what is marked below, then come back here to submit. An officer does not start until you do.'}
            </p>
          </div>
        </div>

        <ul className="divide-y rounded-md border">
          {CHECKLIST.map((item, index) => (
            <li
              key={item.label}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                {done[index] ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                )}
                <div className="min-w-0 text-base">
                  <p className="font-medium">
                    {item.label}
                    <span className="sr-only">{done[index] ? ' — done' : ' — still to do'}</span>
                  </p>
                  <div className="text-muted-foreground">
                    {done[index] ? (facts[index] ?? 'On file.') : item.todo}
                  </div>
                </div>
              </div>
              {done[index] ? (
                <Button
                  variant="ghost"
                  onClick={() => onGo(index)}
                  aria-label={`Change ${item.label.toLowerCase()}`}
                  className="shrink-0 self-start"
                >
                  <Pencil />
                  Change
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => onGo(index)}
                  className="shrink-0 self-start"
                >
                  {item.action}
                  <ArrowRight />
                </Button>
              )}
            </li>
          ))}
        </ul>

        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What happens next
          </h3>
          <ol className="space-y-2">
            {WHAT_HAPPENS_NEXT.map((line, index) => (
              <li key={line} className="flex gap-3 text-base leading-relaxed">
                <span
                  aria-hidden="true"
                  className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                >
                  {index + 1}
                </span>
                <span className="pt-0.5">{line}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            You can keep editing after you submit; the officer reviews what is on file when they get
            to it.
          </p>
        </div>

        {submit.isError ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-base font-medium text-destructive-text"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Could not submit. {errorMessage(submit.error)}</span>
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" onClick={onBack} className="w-full sm:w-auto">
            <ArrowLeft />
            Back
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            {complete ? null : (
              <span id="submit-note" className="text-sm text-muted-foreground">
                Complete the items above to submit.
              </span>
            )}
            <Button
              disabled={!complete}
              loading={submit.isPending}
              aria-describedby={complete ? undefined : 'submit-note'}
              onClick={() => {
                submit.reset();
                submit.mutate();
              }}
              className="w-full sm:w-auto"
            >
              Submit for approval
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
