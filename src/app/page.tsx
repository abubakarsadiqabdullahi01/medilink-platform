import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  ClipboardList,
  FileClock,
  History,
  LayoutDashboard,
  MapPin,
  ScanLine,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { SupportContact } from '@/components/app/support-contact';
import { Logo } from '@/components/app/logo';
import { Reveal } from '@/components/app/reveal';
import { SiteImage } from '@/components/app/site-image';
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
  openGraph: {
    type: 'website',
    locale: 'en_NG',
    siteName: 'Medilink',
    title: 'Medilink — the right practitioner, on the right shift',
    description:
      'Verified healthcare practitioners and the facilities that need them, from the first request to the signed-off hours.',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Medilink: the right practitioner, on the right shift.' }],
  },
  twitter: { card: 'summary_large_image' },
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

const faqs = [
  {
    question: 'Who can create an account?',
    answer:
      'A practitioner can sign up on their own. A hospital registers, and Medilink verifies it before it can publish shifts. Hospital staff create a staff account and are then added by their owner. Facility and operations access is granted, not claimed.',
  },
  {
    question: 'What is checked before a practitioner is offered a shift?',
    answer:
      'Registration and credentials are reviewed and their expiry tracked, and eligibility is checked before anyone is put forward. A practitioner who is not eligible sees every reason by name, so nobody has to ring support to find out why.',
  },
  {
    question: 'Who can see a practitioner’s phone number?',
    answer:
      'Candidate lists show initials only. A facility sees the phone number of somebody it has booked from 48 hours before the shift until 24 hours after it, and every showing is recorded.',
  },
  {
    question: 'What if the network fails at check-in?',
    answer:
      'Check-in is by a code from the ward. When the network is not there, there is a supervised fallback: attendance recorded by hand is kept, and marked as recorded by hand.',
  },
  {
    question: 'Can I see what Medilink holds about me?',
    answer:
      'Yes. Everyone who can sign in can download their data from the account menu. The privacy notice sets out what is kept and why.',
  },
  {
    question: 'Who do I contact if I am stuck?',
    answer:
      'The contact page has the support line, and the sign-in screen links to it. Nothing there is a number nobody answers: the page shows only what has been set up.',
  },
];

// The contact line is configuration read at request time, not baked in at build.
export const dynamic = 'force-dynamic';

/**
 * A frame for a screenshot, so it reads as a screen and not as a picture of one. Plain on purpose: the
 * product is the subject, not the bezel.
 */
function DesktopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-raised">
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3.5 py-2.5" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
      </div>
      {children}
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-[230px] rounded-[2.25rem] border-[7px] border-brand-night bg-brand-night shadow-raised">
      <div className="overflow-hidden rounded-[1.7rem]">{children}</div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-white text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Logo />
          <nav
            className="hidden items-center gap-7 text-sm font-medium text-foreground/75 lg:flex"
            aria-label="Main navigation"
          >
            <a href="#how-it-works" className="hover:text-primary">
              How it works
            </a>
            <a href="#product" className="hover:text-primary">
              The product
            </a>
            <a href="#for-facilities" className="hover:text-primary">
              For facilities
            </a>
            <a href="#for-practitioners" className="hover:text-primary">
              For practitioners
            </a>
            <a href="#faq" className="hover:text-primary">
              Questions
            </a>
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <TextSizeControl className="hidden sm:flex" />
            {/* Visible on a phone too: somebody returning to the app should not have to find it. */}
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-foreground/75 underline-offset-4 hover:text-primary hover:underline"
            >
              Sign in
            </Link>
            <Link href="/register" className={cn(buttonVariants({ size: 'lg' }), 'shrink-0')}>
              <span className="sm:hidden">Sign up</span>
              <span className="hidden sm:inline">Create account</span>
              {/* No arrow on a phone: the header has to fit 360px beside the logo and Sign in. */}
              <ArrowRight className="hidden sm:block" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate flex min-h-[560px] items-center overflow-hidden bg-brand-night lg:min-h-[640px]">
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
            className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-night/95 via-brand-night/85 to-brand-night/70 sm:hidden"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-brand-night via-brand-night/90 to-brand-night/10 sm:block"
            aria-hidden="true"
          />
          <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
            <div className="max-w-[600px]">
              <p className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-mint">
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
                  className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-7 text-base')}
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
                    <Check className="size-4 shrink-0 text-brand-mint" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 border-b bg-white py-16 sm:py-20">
          <Reveal className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                One connected workflow
              </p>
              <h2 className="mt-3 text-h1 sm:text-4xl">
                From the request to the record
              </h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                A shift is one thread, not four systems. Nothing is re-keyed between publishing the
                request and signing off the hours.
              </p>
            </div>
            {/* A line runs through the four steps so they read as one thing happening in order. */}
            <ol className="relative mt-12 grid gap-8 sm:grid-cols-2 md:gap-10 lg:grid-cols-4">
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 top-3 hidden border-t border-dashed border-primary/30 lg:block"
              />
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.number} className="relative">
                    <div className="flex items-center justify-between text-primary">
                      <span className="bg-white pr-3">
                        <Icon className="size-6" aria-hidden="true" />
                      </span>
                      <span className="tabular bg-white pl-3 text-sm font-semibold">{step.number}</span>
                    </div>
                    <h3 className="mt-5 text-h3">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Reveal>
        </section>

        <section id="product" className="scroll-mt-24 border-b bg-tint py-16 sm:py-20">
          <Reveal className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                One sign-in for everyone
              </p>
              <h2 className="mt-3 text-h1 sm:text-4xl">
                Your workspace opens itself
              </h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                There is one sign-in. What opens after it is decided by the permissions on your
                account — not by a link you have to pick first, and not by a role you have to
                remember. Three jobs, three workspaces, one front door.
              </p>
            </div>

            {/* The real screens, from the demonstration environment: a facility's dashboard and a
                practitioner's offers on a phone. */}
            <div className="mt-12 grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-10">
              <DesktopFrame>
                <SiteImage
                  src="images/landing/preview-desktop.webp"
                  alt="A facility’s Medilink dashboard: timesheets waiting for approval, shifts still to fill, and who is due on the floor today."
                  width={1280}
                  height={800}
                  sizes="(min-width: 1280px) 800px, (min-width: 1024px) 60vw, 100vw"
                  className="rounded-none"
                />
              </DesktopFrame>
              <PhoneFrame>
                <SiteImage
                  src="images/landing/preview-phone.webp"
                  alt="A practitioner’s offers screen on a phone, showing a shift offer with its time, rate and the date to answer by."
                  width={600}
                  height={1298}
                  sizes="230px"
                  className="rounded-none"
                />
              </PhoneFrame>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Screens from the demonstration environment. Names, figures and shifts are invented.
            </p>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {workspaces.map((workspace) => {
                const Icon = workspace.icon;
                return (
                  <div
                    key={workspace.name}
                    className="rounded-xl border bg-white p-6 transition-transform duration-base ease-out hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 sm:p-7"
                  >
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-h3">{workspace.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {workspace.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </Reveal>
        </section>

        <section id="for-facilities" className="scroll-mt-24 bg-white py-16 sm:py-20">
          <Reveal className="mx-auto grid max-w-7xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                For facilities
              </p>
              <h2 className="mt-3 text-h1 sm:text-4xl">Fill shifts with confidence.</h2>
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
              <Link
                href="/register?as=facility"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-8')}
              >
                Register a hospital <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <SiteImage
              src="images/landing/facility-ward-manager.webp"
              alt="A nurse and a ward manager at a nurses’ station, checking a roster together beside a computer."
              width={1600}
              height={1067}
              sizes="(min-width: 1024px) 560px, 100vw"
              className="shadow-card"
            />
          </Reveal>
        </section>

        <section id="for-practitioners" className="scroll-mt-24 border-t bg-tint py-16 sm:py-20">
          <Reveal className="mx-auto grid max-w-7xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
            <SiteImage
              src="images/landing/practitioner-phone.webp"
              alt="A nurse in teal scrubs checking her phone in a busy ward corridor, with patients waiting on benches behind her."
              width={1600}
              height={1067}
              sizes="(min-width: 1024px) 560px, 100vw"
              className="shadow-card lg:order-first"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                For practitioners
              </p>
              <h2 className="mt-3 text-h1 sm:text-4xl">Make every shift count.</h2>
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
              <Link href="/register" className={cn(buttonVariants({ size: 'lg' }), 'mt-8')}>
                Create a practitioner account <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
        </section>

        <section className="bg-brand-night py-16 text-white sm:py-20">
          <Reveal className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-mint">
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
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-mint">
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
          </Reveal>
        </section>

        <section id="faq" className="scroll-mt-24 border-b bg-white py-16 sm:py-20">
          <Reveal className="mx-auto max-w-3xl px-5 sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Questions</p>
            <h2 className="mt-3 text-h1 sm:text-4xl">What people ask first</h2>
            {/* Native disclosure elements: they work with no script, open from the keyboard and are
                announced as what they are, and cost nothing to load. */}
            <div className="mt-8 divide-y border-y">
              {faqs.map((item) => (
                <details key={item.question} className="group py-1">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <ChevronDown
                      className="size-5 shrink-0 text-muted-foreground transition-transform duration-base group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="pb-4 pr-9 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="border-b bg-tint py-14 sm:py-16">
          <Reveal className="mx-auto flex max-w-7xl flex-col gap-7 px-5 sm:px-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-h1">Ready to manage your next shift?</h2>
              <p className="mt-2 text-muted-foreground">
                One sign-in. Your workspace opens according to your account access.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href="/register"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'h-11 w-fit shrink-0 px-7 text-base',
                )}
              >
                Create an account <ArrowRight aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="bg-brand-deeper px-5 py-10 text-sm text-white/65 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <Logo tone="reverse" />
            <p className="mt-3">Healthcare workforce management for Nigeria</p>
          </div>
          <nav className="flex flex-wrap gap-x-7 gap-y-1 md:max-w-xl md:justify-end" aria-label="Footer navigation">
            <a href="#how-it-works" className="inline-flex min-h-11 items-center hover:text-white">
              How it works
            </a>
            <a href="#product" className="inline-flex min-h-11 items-center hover:text-white">
              The product
            </a>
            <a href="#for-facilities" className="inline-flex min-h-11 items-center hover:text-white">
              For facilities
            </a>
            <a href="#for-practitioners" className="inline-flex min-h-11 items-center hover:text-white">
              For practitioners
            </a>
            <Link href="/login" className="inline-flex min-h-11 items-center hover:text-white">
              Sign in
            </Link>
            <Link href="/register" className="inline-flex min-h-11 items-center hover:text-white">
              Create an account
            </Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-white">
              Terms
            </Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-white">
              Privacy notice
            </Link>
            <Link href="/contact" className="inline-flex min-h-11 items-center hover:text-white">
              Contact
            </Link>
          </nav>
        </div>
        {/* Shown only when a line has been configured: nothing here invents one. */}
        <div className="mx-auto mt-6 max-w-7xl">
          <SupportContact tone="dark" />
        </div>
        <div className="mx-auto mt-8 flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs">
          <span>© {new Date().getFullYear()} Medilink</span>
          <TextSizeControl tone="dark" />
        </div>
      </footer>
    </div>
  );
}
