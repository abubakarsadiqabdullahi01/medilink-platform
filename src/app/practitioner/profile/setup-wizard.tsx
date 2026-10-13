'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { BLOCKER_GUIDE, THEIR_BLOCKERS, type CredentialSubmission } from '@/lib/ui/practitioner';
import { useReference } from '@/lib/ui/reference';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { formatWhen } from '@/components/app/format';
import { AvailabilitySection } from './availability-section';
import { CredentialsSection } from './credentials-section';
import { INTRO } from './copy';
import { ProfileForm } from './profile-form';

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
 * So the first visit is a sequence, opened at the first thing not yet done,
 * and everything entered is saved as it goes — leaving halfway loses nothing.
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

  return (
    <div>
      <PageHeader
        title="Set up your profile"
        description="Three short steps, then send it for approval. Everything you enter is saved as you go, so you can leave and come back."
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
            <Stepper step={step} done={marks} reachable={hasProfile} onStep={setStep} />
          </div>
          <div className="hidden lg:sticky lg:top-20 lg:block">
            <StepList step={step} done={marks} reachable={hasProfile} onStep={setStep} />
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-5">
            {step < 3 ? (
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Step {step + 1} of 3
              </p>
            ) : null}
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{current.title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {current.intro}
            </p>
          </div>

          {step === 0 ? (
            <>
              <ProfileForm embedded onSaved={(created) => created && setStep(1)} />
              <StepNav
                onNext={hasProfile ? () => setStep(1) : undefined}
                nextLabel="Continue"
                note={hasProfile ? undefined : 'Create your profile to continue.'}
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <AvailabilitySection />
              <StepNav
                onBack={() => setStep(0)}
                onNext={() => setStep(2)}
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
                onBack={() => setStep(1)}
                onNext={() => setStep(3)}
                nextLabel={documentsDone ? 'Continue' : 'Skip for now'}
                note={documentsDone ? undefined : 'A required document is still missing.'}
              />
            </>
          ) : null}

          {step === 3 ? (
            <ReviewStep
              done={done}
              blockers={blockers}
              submittedAt={submittedAt}
              onGo={setStep}
              onFinish={onFinish}
              onBack={() => setStep(2)}
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
}: {
  step: number;
  done: boolean[];
  reachable: boolean;
  onStep: (step: number) => void;
}) {
  const doneCount = done.slice(0, 3).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <ol className="space-y-1" aria-label="Setup progress">
        {STEPS.map((item, index) => {
          const complete = done[index] === true;
          const enabled = index === 0 || reachable;
          return (
            <li key={item.label}>
              <button
                type="button"
                disabled={!enabled}
                onClick={() => onStep(index)}
                aria-current={step === index ? 'step' : undefined}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  step === index ? 'bg-accent' : 'hover:bg-muted/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold',
                    complete
                      ? 'border-success bg-success text-success-foreground'
                      : step === index
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {complete ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                  <span className="sr-only">{complete ? ' (done)' : ''}</span>
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block text-sm font-medium leading-tight">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
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
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={doneCount}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-success transition-[width]"
            style={{ width: `${(doneCount / 3) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{doneCount} of 3 steps done</p>
      </div>
    </div>
  );
}

/**
 * Numbered circles on a line, labels beside them.
 *
 * Labels are dropped on a phone: four do not fit across 375px, and the
 * heading under the stepper already names the step.
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
    <ol className="mb-2 flex items-center" aria-label="Setup progress">
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
              aria-current={step === index ? 'step' : undefined}
              className="group flex items-center gap-2.5 rounded-md py-1 text-left disabled:cursor-not-allowed"
            >
              <span
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
                  enabled && step !== index && 'group-hover:border-primary/60',
                )}
              >
                {complete ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                <span className="sr-only">{complete ? ' (done)' : ''}</span>
              </span>
              <span
                className={cn(
                  // Labels only where there is room for all four; on a phone the
                  // heading below already names the step you are on.
                  'hidden text-sm leading-tight sm:inline',
                  step === index ? 'font-semibold' : 'text-muted-foreground',
                  !enabled && 'opacity-50',
                )}
              >
                {item.label}
              </span>
            </button>
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  'mx-3 h-0.5 flex-1 rounded-full',
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
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
      <div>
        {onBack ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
        {onNext ? (
          <Button onClick={onNext} variant={nextLabel === 'Skip for now' ? 'outline' : 'default'}>
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
        <CardTitle className="text-sm">What your profession requires</CardTitle>
      </CardHeader>
      <CardContent>
        {required.length === 0 ? (
          <p className="text-sm text-muted-foreground">
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
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm first:pt-0 last:pb-0"
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

/**
 * The last step: say you are done.
 *
 * Nothing is reviewed until this is pressed, and the page says so — a
 * practitioner who has filled everything in and then waits has no way to know
 * that nobody has been told. Until the checklist is complete the button stays
 * off, and each missing item is a button that goes to where it is fixed, so
 * "you are not finished" always comes with the way to finish.
 */
function ReviewStep({
  done,
  blockers,
  submittedAt,
  onGo,
  onFinish,
  onBack,
}: {
  done: boolean[];
  blockers: string[];
  submittedAt: string | null;
  onGo: (step: number) => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const waiting = blockers.filter((blocker) => !THEIR_BLOCKERS.includes(blocker));
  const complete = done.every(Boolean);

  const submit = useMutation({
    mutationFn: () => api.post('/api/v1/practitioners/me/submit', {}),
    onSuccess: () => {
      toast.success('Submitted for approval');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
    },
    onError: (error) => toast.error('Could not submit', { description: errorMessage(error) }),
  });

  if (submittedAt) {
    return (
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
            <div>
              <p className="font-medium">Submitted — waiting for approval</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Sent {formatWhen(submittedAt)}. An officer will check your identity, your
                professional registration and your documents. There is nothing more for you to do;
                you will be offered shifts as soon as it is done.
              </p>
            </div>
          </div>

          {waiting.length > 0 ? (
            <div className="rounded-md border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What the officer is checking
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                {waiting.map((blocker) => (
                  <li key={blocker}>· {BLOCKER_GUIDE[blocker]?.says ?? humanise(blocker)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex justify-end border-t pt-5">
            <Button onClick={onFinish}>Go to my profile</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex items-start gap-3">
          {complete ? (
            <Sparkles className="mt-0.5 size-5 shrink-0 text-success" />
          ) : (
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          )}
          <div>
            <p className="font-medium">
              {complete ? 'Everything is in. Ready to submit.' : 'Not quite ready to submit'}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {complete
                ? 'Nothing is reviewed until you submit. Once you do, an officer checks your identity, your professional registration and your documents.'
                : 'Finish what is marked below, then come back here to submit. An officer does not start until you do.'}
            </p>
          </div>
        </div>

        <ul className="divide-y rounded-md border">
          {CHECKLIST.map((item, index) => (
            <li
              key={item.label}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex items-center gap-2.5 text-sm">
                {done[index] ? (
                  <CircleCheck className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <CircleAlert className="size-4 text-warning" aria-hidden="true" />
                )}
                <span>
                  <span className="font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {done[index] ? item.done : item.todo}
                  </span>
                </span>
              </span>
              {done[index] ? null : (
                <Button variant="outline" size="sm" onClick={() => onGo(index)}>
                  {item.action}
                  <ArrowRight />
                </Button>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {complete ? null : (
              <span className="text-xs text-muted-foreground">
                Complete the items above to submit.
              </span>
            )}
            <Button disabled={!complete} loading={submit.isPending} onClick={() => submit.mutate()}>
              Submit for approval
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** What each of the three things is, and where to go when it is not done. */
const CHECKLIST = [
  {
    label: 'Your details',
    done: 'Profession and location are on file.',
    todo: 'Create your profile.',
    action: 'Add details',
  },
  {
    label: 'When you can work',
    done: 'Your weekly pattern is set.',
    todo: 'Add at least one weekly slot.',
    action: 'Set availability',
  },
  {
    label: 'Your documents',
    done: 'Every document your profession requires has been sent.',
    todo: 'A required document has not been submitted.',
    action: 'Add documents',
  },
] as const;
