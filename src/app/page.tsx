import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  ClipboardList,
  FileClock,
  History,
  LayoutDashboard,
  MapPin,
  ScanLine,
  Send,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { SupportContact } from '@/components/app/support-contact';
import { TextSizeControl } from '@/components/app/text-size-control';
import { cn } from '@/lib/utils';

/**
 * The public front door.
 *
 * It carries **one** sign-in. An earlier version offered a card per audience,
 * which read as three separate login systems; Medilink has one, and which
 * console opens is decided by the grants on the account rather than by the
 * link somebody follows. The three workspaces are still described here —
 * people want to know what they are signing in to — but as explanation, not
 * as a choice to make before authenticating.
 *
 * Signing up is a separate path and only a practitioner can take it: facility
 * and operations accounts are granted, not claimed. That is said in the hero
 * rather than left for a scheduler to discover at the end of a form.
 *
 * Everything claimed below is something the system does today.
 */

export const metadata: Metadata = {
  title: 'Medilink — healthcare workforce management for Nigeria',
  description:
    'Medilink connects verified healthcare practitioners with facilities that need dependable clinical cover — from the first request through attendance, hours and sign-off.',
};

const proofPoints = ['Verified credentials', 'Attendance as it happens', 'Decisions on the record'];

const workspaces = [
  {
    name: 'Operations',
    icon: LayoutDashboard,
    description:
      'Medilink administrators work the queues: credential reviews, facility verification, clinical incidents, disputes, invoices, payouts and the audit trail.',
  },
  {
    name: 'Facility',
    icon: Building2,
    description:
      'Hospital owners and their administrators publish shifts, review ranked candidates, confirm offers, follow attendance, approve timesheets and manage their own staff.',
  },
  {
    name: 'Practitioner',
    icon: UserRound,
    description:
      'Practitioners keep their profile, credentials and availability current, respond to offers with their terms, check in, and submit their hours.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Publish the shift',
    description:
      'A facility describes the cover it needs — role, ward, date and hours — and publishes it.',
    icon: ClipboardList,
  },
  {
    number: '02',
    title: 'Review ranked candidates',
    description:
      'Eligible practitioners are ranked on proximity, experience, recent hours and reliability. Every score shows the factors behind it.',
    icon: BadgeCheck,
  },
  {
    number: '03',
    title: 'Offer, then confirm',
    description:
      'An invitation goes out and the practitioner responds. Only a confirmed offer becomes a shift, and the card says so.',
    icon: Send,
  },
  {
    number: '04',
    title: 'Attendance and hours',
    description:
      'Check-in by code, with a supervised fallback when the network is not there. Hours are then submitted, reviewed and signed off.',
    icon: ScanLine,
  },
];

const facilityPoints = [
  'Publish a staffing need and see suitable practitioners against it',
  'Every candidate shows its factors, not just a score out of 100',
  'Offers, acceptances and confirmations tracked in one place',
  'Attendance as it happens, with a manual fallback for a failed network',
  'Timesheets, fault decisions and incidents raised without leaving the shift',
];

const practitionerPoints = [
  'One profile, with credentials and their expiry tracked for you',
  'Eligibility that lists every blocker by name, never just “ineligible”',
  'Availability you set, and offers with their terms in full',
  'Check in on the ward, submit your hours, keep the record',
  'Decline reasons reach the platform without your name attached',
];

const assurances = [
  {
    title: 'Verified before matched',
    description:
      'Registration and credentials are reviewed and their expiry tracked, and eligibility is checked before anyone is put forward for work.',
    icon: ShieldCheck,
  },
  {
    title: 'Facilities checked too',
    description:
      'A facility is verified and its licence recorded before it can publish work. Verification runs in both directions.',
    icon: Building2,
  },
  {
    title: 'A record that survives',
    description:
      'Check-in events are append-only, and correcting a timesheet keeps the earlier figures as a revision rather than overwriting them.',
    icon: FileClock,
  },
  {
    title: 'Audit, not surveillance',
    description:
      'The audit trail answers what happened to a record. It deliberately cannot be used to ask what a person has been doing all week.',
    icon: History,
  },
];

// The contact line is configuration read at request time, not baked in at build.
export const dynamic = 'force-dynamic';

export default function LandingPage() {
  return (
    <div className="bg-white text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-xl font-semibold text-primary"
            aria-label="Medilink home"
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-white">
              <Stethoscope className="size-5" aria-hidden="true" />
            </span>
            Medilink
          </Link>
          <nav
            className="hidden items-center gap-7 text-sm font-medium text-foreground/75 lg:flex"
            aria-label="Main navigation"
          >
            <a href="#workspaces" className="hover:text-primary">
              Workspaces
            </a>
            <a href="#how-it-works" className="hover:text-primary">
              How it works
            </a>
            <a href="#for-facilities" className="hover:text-primary">
              For facilities
            </a>
            <a href="#for-practitioners" className="hover:text-primary">
              For practitioners
            </a>
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <TextSizeControl className="hidden sm:flex" />
            <Link
              href="/login"
              className="hidden text-sm font-medium text-foreground/75 underline-offset-4 hover:text-primary hover:underline sm:inline"
            >
              Sign in
            </Link>
            <Link href="/register" className={cn(buttonVariants({ size: 'lg' }), 'shrink-0')}>
              Create account <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate flex min-h-[560px] items-center overflow-hidden bg-[#062a2e] lg:min-h-[640px]">
          <Image
            src="/medilink-hero.webp"
            alt="A nurse and a doctor reviewing a shift together on a tablet in a hospital corridor"
            fill
            priority
            sizes="100vw"
            className="-z-20 object-cover object-[66%_center]"
          />
          {/*
            Two scrims rather than one responsive gradient. The subjects sit
            right of centre, so the copy needs a vertical wash when the page is
            one column and a horizontal one when it is not — and the text must
            never be asked to hold its own against a bright corridor window.
          */}
          <div
            className="absolute inset-0 -z-10 bg-gradient-to-b from-[#062a2e]/95 via-[#062a2e]/85 to-[#062a2e]/70 sm:hidden"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-[#062a2e] via-[#062a2e]/90 to-[#062a2e]/10 sm:block"
            aria-hidden="true"
          />
          <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
            <div className="max-w-[600px]">
              <p className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#7fd3cf]">
                <MapPin className="size-4" aria-hidden="true" /> Healthcare workforce management ·
                Nigeria
              </p>
              <h1 className="text-4xl font-semibold leading-[1.08] text-white sm:text-5xl lg:text-6xl">
                The right practitioner, on the right shift.
              </h1>
              <p className="mt-6 max-w-[520px] text-base leading-relaxed text-white/80 sm:text-lg">
                Medilink connects verified healthcare practitioners with facilities that need
                dependable cover — from the first request through attendance, hours and sign-off, in
                one accountable record.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link
                  href="/register"
                  className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-7 text-[15px]')}
                >
                  Create an account <ArrowRight aria-hidden="true" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-11 items-center gap-2 rounded-md text-sm font-semibold text-white underline-offset-4 hover:underline"
                >
                  Sign in <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
              {/* Said here rather than discovered on the sign-up form: the
                  button above is the practitioner's door, and a hospital or a
                  member of its staff each has their own. */}
              <p className="mt-4 text-xs leading-relaxed text-white/60">
                Practitioners sign up in minutes.{' '}
                <Link href="/register?as=facility" className="font-semibold text-white underline-offset-4 hover:underline">
                  Register a hospital
                </Link>{' '}
                and Medilink verifies it before it can publish shifts. Hospital staff{' '}
                <Link href="/register?as=staff" className="font-semibold text-white underline-offset-4 hover:underline">
                  create a staff account
                </Link>{' '}
                and are added by their owner.
              </p>
              <ul className="mt-12 flex flex-col gap-3 border-t border-white/15 pt-6 text-sm text-white/75 sm:flex-row sm:flex-wrap sm:gap-x-7">
                {proofPoints.map((point) => (
                  <li key={point} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-[#7fd3cf]" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="workspaces" className="scroll-mt-24 border-b bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                One sign-in for everyone
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
                Your workspace opens itself
              </h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                There is one sign-in. What opens after it is decided by the permissions on your
                account — not by a link you have to pick first, and not by a role you have to
                remember. Three jobs, three workspaces, one front door.
              </p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {workspaces.map((workspace) => {
                const Icon = workspace.icon;
                return (
                  <div key={workspace.name} className="rounded-xl border bg-[#f7faf9] p-6 sm:p-7">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-lg font-semibold">{workspace.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {workspace.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 border-b bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                One connected workflow
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
                From the request to the record
              </h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                A shift is one thread, not four systems. Nothing is re-keyed between publishing the
                request and signing off the hours.
              </p>
            </div>
            <div className="mt-10 grid gap-8 border-t pt-8 sm:grid-cols-2 md:gap-10 lg:grid-cols-4">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.number}>
                    <div className="flex items-center justify-between text-primary">
                      <Icon className="size-6" aria-hidden="true" />
                      <span className="tabular text-sm font-semibold">{step.number}</span>
                    </div>
                    <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#f2f7f6] py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-20">
            <div id="for-facilities" className="scroll-mt-24">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                For facilities
              </p>
              <h2 className="mt-3 text-3xl font-semibold">Fill shifts with confidence.</h2>
              <p className="mt-4 max-w-lg leading-relaxed text-muted-foreground">
                Publish your staffing need, see why a practitioner is a suitable match, and manage
                offers and confirmations in one place — then follow the shift through attendance and
                sign-off.
              </p>
              <ul className="mt-6 space-y-3 border-t border-primary/15 pt-6 text-sm leading-relaxed">
                {facilityPoints.map((point) => (
                  <li key={point} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div id="for-practitioners" className="scroll-mt-24">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                For practitioners
              </p>
              <h2 className="mt-3 text-3xl font-semibold">Make every shift count.</h2>
              <p className="mt-4 max-w-lg leading-relaxed text-muted-foreground">
                Keep your profile, credentials and availability up to date, review offers and their
                terms in full, and keep a clear record of the hours you have worked.
              </p>
              <ul className="mt-6 space-y-3 border-t border-primary/15 pt-6 text-sm leading-relaxed">
                {practitionerPoints.map((point) => (
                  <li key={point} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="bg-[#062a2e] py-16 text-white sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#7fd3cf]">
                Trust and safety
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
                Built for the questions asked months later
              </h2>
              <p className="mt-4 leading-relaxed text-white/70">
                A staffing platform in healthcare is judged by what it can still prove long after
                the shift is over.
              </p>
            </div>
            <div className="mt-10 grid gap-8 border-t border-white/15 pt-8 sm:grid-cols-2 lg:gap-x-16">
              {assurances.map((assurance) => {
                const Icon = assurance.icon;
                return (
                  <div key={assurance.title} className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#7fd3cf]">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold">{assurance.title}</h3>
                      <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70">
                        {assurance.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b bg-white py-14 sm:py-16">
          <div className="mx-auto flex max-w-7xl flex-col gap-7 px-5 sm:px-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold sm:text-3xl">
                Ready to manage your next shift?
              </h2>
              <p className="mt-2 text-muted-foreground">
                One sign-in. Your workspace opens according to your account access.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href="/register"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'h-11 w-fit shrink-0 px-7 text-[15px]',
                )}
              >
                Create an account <ArrowRight aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="text-sm font-semibold underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#04201f] px-5 py-10 text-sm text-white/65 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="flex items-center gap-2 font-semibold text-white">
              <Stethoscope className="size-4" aria-hidden="true" /> Medilink
            </span>
            <p className="mt-2">Healthcare workforce management for Nigeria</p>
          </div>
          <nav className="flex flex-wrap gap-x-7 gap-y-2" aria-label="Footer navigation">
            <a href="#workspaces" className="hover:text-white">
              Workspaces
            </a>
            <a href="#how-it-works" className="hover:text-white">
              How it works
            </a>
            <a href="#for-facilities" className="hover:text-white">
              For facilities
            </a>
            <a href="#for-practitioners" className="hover:text-white">
              For practitioners
            </a>
            <Link href="/login" className="hover:text-white">
              Sign in
            </Link>
            <Link href="/register" className="hover:text-white">
              Create an account
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-white">
              Privacy notice
            </Link>
            <Link href="/contact" className="hover:text-white">
              Contact
            </Link>
          </nav>
        </div>
        {/* Shown only when a line has been configured: nothing here invents one. */}
        <div className="mx-auto mt-6 max-w-7xl">
          <SupportContact tone="dark" />
        </div>
        <div className="mx-auto mt-8 max-w-7xl border-t border-white/10 pt-6 text-xs">
          © {new Date().getFullYear()} Medilink
        </div>
      </footer>
    </div>
  );
}
