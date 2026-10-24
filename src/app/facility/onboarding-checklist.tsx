'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Circle, CircleCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { buttonVariants, Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { FacilitySummary } from '@/lib/ui/facility';

type StepState = 'done' | 'todo' | 'waiting';

interface Step {
  key: string;
  label: string;
  state: StepState;
  href: string;
  /** What "waiting" is waiting for, in a few words. */
  waitingOn?: string;
}

const DISMISS_KEY = 'medilink:onboarding-hidden:';

/**
 * What a new facility has to do before the console is any use, and how far along it is (UXF-16).
 *
 * The dashboard used to show a verification banner and then nothing: a hospital that had just
 * registered saw three tiles reading zero and no hint that the thing to do was upload a licence.
 * This is the same idea as the practitioner's setup card, for the people who create the work.
 *
 * Three steps are tracked because three can be known from what the facility already holds: the
 * licence on file, the verification, a rate card, a first shift. Staff are a fourth thing a new
 * owner needs, but who holds access is behind a password re-entry, so it is offered as a link and
 * never counted as done or not done.
 *
 * It goes away by itself when everything is done, and can be hidden before then: a facility that
 * does not use night or holiday rates would otherwise carry an unfinished checklist for ever.
 * Hiding is remembered on this device, per facility.
 */
export function OnboardingChecklist({
  facilityId,
  facility,
  hasShifted,
  canSetRates,
  canInviteStaff,
}: {
  facilityId: string;
  facility: FacilitySummary | undefined;
  /** At least one shift has been published, at any time. */
  hasShifted: boolean;
  canSetRates: boolean;
  canInviteStaff: boolean;
}) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(DISMISS_KEY + facilityId) === 'yes');
    } catch {
      setHidden(false);
    }
  }, [facilityId]);

  // The same key the rates page reads, so opening it afterwards costs nothing.
  const rates = useQuery({
    queryKey: ['rate-cards', facilityId],
    queryFn: () => api.get<{ rateCards: unknown[] }>(`/api/v1/rate-cards?facilityId=${facilityId}`),
    enabled: canSetRates,
    retry: false,
  });

  // Nothing is drawn until what it would say is known: a checklist that flickers from "not done"
  // to "done" on every visit teaches people to ignore it.
  if (hidden || !facility || (canSetRates && rates.isPending)) return null;

  const licenceOnFile = Boolean(facility.licenceObjectKey);
  const verified = facility.status === 'VERIFIED';

  const steps: Step[] = [
    {
      key: 'licence',
      label: 'Upload your licence',
      state: licenceOnFile ? 'done' : 'todo',
      href: '/facility/profile',
    },
    {
      key: 'verified',
      label: 'Verified by Medilink',
      state: verified ? 'done' : licenceOnFile && facility.status === 'PENDING' ? 'waiting' : 'todo',
      href: '/facility/profile',
      waitingOn: 'Medilink is checking',
    },
    ...(canSetRates
      ? [
          {
            key: 'rates',
            label: 'Set your rates',
            state: (rates.data?.rateCards.length ?? 0) > 0 ? 'done' : 'todo',
            href: '/facility/rates',
          } satisfies Step,
        ]
      : []),
    {
      key: 'shift',
      label: 'Publish your first shift',
      state: hasShifted ? 'done' : 'todo',
      href: '/facility/shifts',
    },
  ];

  const doneCount = steps.filter((step) => step.state === 'done').length;
  if (doneCount === steps.length) return null;

  // The first step that is yours to do; a step waiting on Medilink is nobody's to click.
  const next = steps.find((step) => step.state === 'todo');

  function hide() {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY + facilityId, 'yes');
    } catch {
      // Hidden for this visit, which is all a blocked store allows.
    }
  }

  return (
    <Card className="mb-6 border-primary/30 bg-accent/30">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-h3">Get set up to publish shifts</p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {doneCount} of {steps.length} steps done
              {next ? `. Next up: ${next.label.toLowerCase()}.` : '. The rest is waiting on Medilink.'}
            </p>
          </div>
          {next ? (
            <Link href={next.href} className={buttonVariants()}>
              {next.label}
              <ArrowRight />
            </Link>
          ) : null}
        </div>

        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-slow"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {steps.map((step) => (
            <li key={step.key}>
              {step.state === 'done' ? (
                <span className="flex items-center gap-1.5">
                  <CircleCheck className="size-4 text-success" aria-hidden="true" />
                  {step.label}
                </span>
              ) : step.state === 'waiting' ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-4 text-info" aria-hidden="true" />
                  {step.label} — {step.waitingOn}
                </span>
              ) : (
                <Link
                  href={step.href}
                  className={cn(
                    'flex items-center gap-1.5 text-muted-foreground underline-offset-4',
                    'hover:text-foreground hover:underline',
                  )}
                >
                  <Circle className="size-4" aria-hidden="true" />
                  {step.label}
                </Link>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {canInviteStaff ? (
            <p className="text-muted-foreground">
              Somebody else will run the rota?{' '}
              <Link
                href="/facility/staff"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Invite them from Staff
              </Link>
              .
            </p>
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" size="sm" onClick={hide}>
            Hide this
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
