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
  Lock,
  ScanLine,
  ScrollText,
  Send,
  ShieldCheck,
  Stethoscope,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { SupportContact } from '@/components/app/support-contact';
import { TextSizeControl } from '@/components/app/text-size-control';
import { LandingNav } from '@/components/landing/landing-nav';
import { cn } from '@/lib/utils';

/**
 * The public front door.
 *
 * One promise, said once: verified healthcare professionals, reliable clinical cover. Everything
 * after it is evidence for that promise, in the order a doubtful visitor asks for it — who are
 * the people, how do I know they turned up, what is written down.
 *
 * **One sign-in.** Medilink has one, and which console opens is decided by the grants on the
 * account rather than by the link somebody followed. The three ways of *registering* are
 * different, because they are different jobs — a practitioner claims an account, a hospital's
 * representative registers it and waits to be verified, and hospital staff are added by their
 * owner — and the page says so in one place (#get-started) instead of leaving a scheduler to
 * find out at the end of a form.
 *
 * **Nothing is claimed that the system does not do.** There are no figures, testimonials, partner
 * logos, payment claims or regulator approvals here, because none exist to cite; a section that
 * would need one is left out rather than filled. The pilot and pricing statements are the
 * product's own current behaviour and are listed for the owner's sign-off in docs/ui-ux-audit.md.
 */

export const metadata: Metadata = {
  title: 'Medilink — verified healthcare professionals, reliable clinical cover',
  description:
    'Medilink takes a shift from the facility’s request to the practitioner’s attendance and the hours a facility approves — with verified practitioners and verified facilities, in one accountable record.',
};

const proofPoints = [
  {
    title: 'Verified people',
    description:
      'Practitioners are checked before they are offered work: identity, professional registration and credentials, with expiry tracked. Facilities are verified before they can publish a shift.',
    icon: BadgeCheck,
  },
  {
    title: 'Accountable attendance',
    description:
      'Check-in is by a code from the facility. When the network fails, a supervised fallback records attendance by hand — marked as such, with a written reason.',
    icon: ScanLine,
  },
  {
    title: 'Recorded decisions',
    description:
      'Every offer, confirmation, correction and approval is on the record. Correcting a timesheet keeps the earlier figures as a revision rather than overwriting them.',
    icon: ScrollText,
  },
];

const facilityPoints = [
  'Publish the cover you need and see the practitioners who fit — with the reasons, not just a score.',
  'Offer, then confirm: only a confirmed offer becomes a shift, and the screen says so.',
  'Follow attendance as it happens, with a written fallback for a failed network.',
  'Approve or correct timesheets, and raise an incident or a dispute from the shift it belongs to.',
  'Add your own staff, each with their own sign-in, so every action carries a name.',
];

const practitionerPoints = [
  'One profile, with your credentials and their expiry tracked for you.',
  'If you cannot yet be offered shifts, the page lists every reason by name — never just “ineligible”.',
  'You set your availability, and every offer shows its terms in full before you answer.',
  'Check in on the ward, submit your hours, and keep the record of what was approved.',
  'A facility sees your phone number only when it asks for it, and every showing is recorded.',
];

const steps = [
  {
    number: '1',
    title: 'Publish the shift',
    description:
      'A verified facility describes the cover it needs — role, ward, date and hours — and publishes it.',
    icon: ClipboardList,
  },
  {
    number: '2',
    title: 'Review ranked candidates',
    description:
      'Eligible practitioners are ranked on proximity, experience, recent hours and reliability. Every score shows the factors behind it, and everyone left out is explained.',
    icon: UsersRound,
  },
  {
    number: '3',
    title: 'Offer, then confirm',
    description:
      'An offer goes out with its terms. The practitioner answers; the facility confirms. Only a confirmed offer becomes a shift.',
    icon: Send,
  },
  {
    number: '4',
    title: 'Attend, then approve the hours',
    description:
      'The practitioner checks in, works, and submits hours. The facility approves or corrects them, and the approved hours are the record that invoices are built from.',
    icon: ScanLine,
  },
];

const assurances = [
  {
    title: 'Verified before matched',
    description:
      'Registration and credentials are reviewed by a person and their expiry tracked. Eligibility is checked before anyone is put forward for work, and a practitioner who is not eligible is told every reason.',
    icon: ShieldCheck,
  },
  {
    title: 'Facilities are checked too',
    description:
      'A facility is verified and its licence recorded before it can publish work. Verification runs in both directions.',
    icon: Building2,
  },
  {
    title: 'A record that survives',
    description:
      'Check-in events are append-only. The audit trail answers what happened to a record — and deliberately cannot be used to ask what one person has been doing all week.',
    icon: FileClock,
  },
  {
    title: 'Private by default',
    description:
      'Documents and phone numbers are shown only to people with a reason to see them, and each showing is logged. Anybody who signs in can download what is held about them.',
    icon: Lock,
  },
];

const faqs = [
  {
    q: 'Who can register?',
    a: 'Practitioners register themselves. A facility is registered by its representative and verified by Medilink before it can publish shifts. Facility staff create a staff account and are then added by their facility’s owner. Everyone signs in the same way, at the same place.',
  },
  {
    q: 'How are practitioners checked?',
    a: 'A Medilink officer reviews each person’s identity, professional registration and credentials, and the system tracks when each one expires. A practitioner is only offered work while everything that is required is in place; if something is missing or has lapsed, they are told which one.',
  },
  {
    q: 'Who can see my phone number and documents?',
    a: 'A facility sees a practitioner’s phone number only when it asks for it, and each time is recorded. Credential documents are opened only by authorised Medilink staff, and each opening is recorded too. You can download what Medilink holds about you from the menu once you are signed in.',
  },
  {
    q: 'What if the network is down when I check in?',
    a: 'A supervisor at the facility can record your attendance by hand. It needs a written reason and is marked as recorded manually, so nobody mistakes it for a code-backed check-in.',
  },
  {
    q: 'What does it cost?',
    a: 'There is no published price. Medilink is in a pilot, the platform fee on invoices is currently zero, and the revenue model has not been settled. See “Pilot and pricing” above for what we can and cannot say yet.',
  },
  {
    q: 'Who do I contact if something goes wrong?',
    a: 'Use the contact page. If a shift, an hours figure or a decision is wrong, you can dispute it from the record itself, and a person reviews it.',
  },
];

// The contact line is configuration read at request time, not baked in at build.
export const dynamic = 'force-dynamic';

function SectionHeading({
  eyebrow,
  title,
  children,
  inverse = false,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  inverse?: boolean;
}) {
  return (
    <div className="max-w-2xl">
      <p
        className={cn(
          'text-sm font-semibold uppercase tracking-wider',
          inverse ? 'text-brand-glow' : 'text-primary',
        )}
      >
        {eyebrow}
      </p>
      <h2 className="mt-2 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        {title}
      </h2>
      {children ? (
        <p
          className={cn(
            'mt-4 text-lg leading-relaxed',
            inverse ? 'text-white/75' : 'text-muted-foreground',
          )}
        >
          {children}
        </p>
      ) : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <LandingNav />

      <main id="main">
        <section className="relative isolate flex min-h-[560px] items-center overflow-hidden bg-brand-deep lg:min-h-[620px]">
          <Image
            src="/medilink-hero.webp"
            alt="A nurse and a doctor reviewing a shift together on a tablet in a hospital corridor"
            fill
            priority
            sizes="100vw"
            className="-z-20 object-cover object-[66%_center]"
          />
          {/*
            Two scrims rather than one responsive gradient. The subjects sit right of centre, so the
            copy needs a vertical wash when the page is one column and a horizontal one when it is
            not — and the text must never be asked to hold its own against a bright corridor window.
          */}
          <div
            className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-deep/95 via-brand-deep/90 to-brand-deep/80 sm:hidden"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-brand-deep via-brand-deep/90 to-brand-deep/10 sm:block"
            aria-hidden="true"
          />
          <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-8 sm:py-20">
            <div className="max-w-[640px]">
              <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Verified healthcare professionals. Reliable clinical cover.
              </h1>
              <p className="mt-6 max-w-[560px] text-lg leading-relaxed text-white/85">
                A facility publishes the cover it needs. Medilink shows it practitioners whose
                registration and credentials have been checked. They accept, check in, and the
                facility approves the hours — one accountable record from the request to the
                approved timesheet.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Link
                  href="/register"
                  className={cn(buttonVariants({ size: 'lg' }), 'h-12 px-7 text-base')}
                >
                  Register as a practitioner <ArrowRight aria-hidden="true" />
                </Link>
                <Link
                  href="/register?as=facility"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'lg' }),
                    'h-12 border-white/70 bg-transparent px-7 text-base text-white hover:bg-white hover:text-brand-deep',
                  )}
                >
                  Register your facility
                </Link>
              </div>
              <p className="mt-5 text-base text-white/85">
                Already registered?{' '}
                <Link
                  href="/login"
                  className="font-semibold text-white underline underline-offset-4"
                >
                  Sign in
                </Link>{' '}
                — one sign-in for everyone.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="proof-heading" className="border-b bg-background">
          <h2 id="proof-heading" className="sr-only">
            What Medilink stands behind
          </h2>
          <ul className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-8 md:grid-cols-3 md:gap-10 md:py-14">
            {proofPoints.map((point) => {
              const Icon = point.icon;
              return (
                <li key={point.title} className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-6" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold leading-snug">{point.title}</h3>
                    <p className="mt-1.5 leading-relaxed text-muted-foreground">
                      {point.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="bg-brand-wash py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-8 lg:grid-cols-2 lg:gap-8">
            <div
              id="for-facilities"
              className="scroll-mt-24 rounded-xl border bg-card p-6 shadow-card sm:p-8"
            >
              <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <Building2 className="size-4" aria-hidden="true" /> For facilities
              </p>
              <h2 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-tight">
                Fill shifts with people you can account for.
              </h2>
              <ul className="mt-6 space-y-3.5 leading-relaxed">
                {facilityPoints.map((point) => (
                  <li key={point} className="flex gap-3">
                    <Check className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link
                  href="/register?as=facility"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'lg' }),
                    'border-primary text-primary',
                  )}
                >
                  Register your facility
                </Link>
                <p className="text-base text-muted-foreground">
                  Verified by Medilink before it can publish shifts.
                </p>
              </div>
            </div>

            <div
              id="for-practitioners"
              className="scroll-mt-24 rounded-xl border bg-card p-6 shadow-card sm:p-8"
            >
              <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <UserRound className="size-4" aria-hidden="true" /> For practitioners
              </p>
              <h2 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-tight">
                Know where you stand, and what you will be paid for.
              </h2>
              <ul className="mt-6 space-y-3.5 leading-relaxed">
                {practitionerPoints.map((point) => (
                  <li key={point} className="flex gap-3">
                    <Check className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link href="/register" className={cn(buttonVariants({ size: 'lg' }))}>
                  Register as a practitioner
                </Link>
                <p className="text-base text-muted-foreground">Set up on a phone, in minutes.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-16 border-b py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-8">
            <SectionHeading
              eyebrow="How Medilink works"
              title="From the request to the approved hours"
            >
              A shift is one thread, not four systems. Nothing is re-keyed between publishing the
              request and approving the hours.
            </SectionHeading>
            <ol className="mt-10 grid gap-8 border-t pt-8 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.number}>
                    <div className="flex items-center gap-3">
                      <span className="tabular flex size-9 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
                        {step.number}
                      </span>
                      <Icon className="size-6 text-primary" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold leading-snug">{step.title}</h3>
                    <p className="mt-2 leading-relaxed text-muted-foreground">{step.description}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section id="safety" className="scroll-mt-16 bg-brand-deep py-16 text-white sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-8">
            <SectionHeading
              inverse
              eyebrow="Safety, verification, privacy and audit"
              title="Built for the questions asked months later"
            >
              A staffing platform in healthcare is judged by what it can still prove long after the
              shift is over.
            </SectionHeading>
            <div className="mt-10 grid gap-8 border-t border-white/15 pt-8 sm:grid-cols-2 lg:gap-x-16">
              {assurances.map((assurance) => {
                const Icon = assurance.icon;
                return (
                  <div key={assurance.title} className="flex gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-glow">
                      <Icon className="size-6" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold leading-snug">{assurance.title}</h3>
                      <p className="mt-2 max-w-md leading-relaxed text-white/80">
                        {assurance.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-10 border-t border-white/15 pt-6 text-base text-white/80">
              Read the{' '}
              <Link
                href="/privacy"
                className="font-semibold text-white underline underline-offset-4"
              >
                privacy notice
              </Link>{' '}
              and the{' '}
              <Link href="/terms" className="font-semibold text-white underline underline-offset-4">
                terms
              </Link>{' '}
              before you register.
            </p>
          </div>
        </section>

        <section id="pilot" className="scroll-mt-16 border-b py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-8 lg:grid-cols-2 lg:gap-16">
            <SectionHeading eyebrow="Pilot and pricing" title="Early, and honest about it">
              Medilink is being piloted. This is what we can say today, and nothing beyond it.
            </SectionHeading>
            <ul className="space-y-5 text-lg leading-relaxed">
              <li className="flex gap-3">
                <Check className="mt-1.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">The product is still changing.</strong> Decline
                  reasons and suggestions from the people using it are read by the team and shape
                  what is built next.
                </span>
              </li>
              <li className="flex gap-3">
                <Check className="mt-1.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">There is no published price.</strong> The
                  platform fee on invoices is currently zero, and the revenue model has not been
                  settled.
                </span>
              </li>
              <li className="flex gap-3">
                <Check className="mt-1.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">A fee would not be hidden.</strong> If one is
                  introduced it will be its own line on the invoice, not folded into a rate.
                </span>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Ask about the pilot <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </div>
        </section>

        <section id="faq" className="scroll-mt-16 border-b bg-brand-wash py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-8">
            <SectionHeading eyebrow="Questions" title="Things people ask before they register" />
            <div className="mt-8 divide-y rounded-xl border bg-card shadow-card">
              {faqs.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-lg font-medium leading-snug marker:content-none [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown
                      className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="px-5 pb-5 text-base leading-relaxed text-muted-foreground">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="get-started" className="scroll-mt-16 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-8">
            <SectionHeading eyebrow="Get started" title="Choose how you will use Medilink">
              You register once, in the way that fits your job — and after that everybody signs in
              the same way, at the same place.
            </SectionHeading>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <Link
                href="/register"
                className="group flex flex-col rounded-xl border-2 border-primary bg-card p-6 shadow-card transition-colors hover:bg-accent/40"
              >
                <UserRound className="size-7 text-primary" aria-hidden="true" />
                <span className="mt-4 text-xl font-semibold">I am a practitioner</span>
                <span className="mt-2 flex-1 leading-relaxed text-muted-foreground">
                  Create your account and profile, add your credentials, and be offered shifts once
                  you are approved.
                </span>
                <span className="mt-5 inline-flex items-center gap-1.5 font-semibold text-primary">
                  Register as a practitioner <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </Link>
              <Link
                href="/register?as=facility"
                className="group flex flex-col rounded-xl border bg-card p-6 shadow-card transition-colors hover:bg-accent/40"
              >
                <Building2 className="size-7 text-primary" aria-hidden="true" />
                <span className="mt-4 text-xl font-semibold">I run a facility</span>
                <span className="mt-2 flex-1 leading-relaxed text-muted-foreground">
                  Register your facility as its owner. Medilink verifies it before it can publish
                  shifts.
                </span>
                <span className="mt-5 inline-flex items-center gap-1.5 font-semibold text-primary">
                  Register your facility <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </Link>
              <Link
                href="/register?as=staff"
                className="group flex flex-col rounded-xl border bg-card p-6 shadow-card transition-colors hover:bg-accent/40"
              >
                <UsersRound className="size-7 text-primary" aria-hidden="true" />
                <span className="mt-4 text-xl font-semibold">I work at a facility</span>
                <span className="mt-2 flex-1 leading-relaxed text-muted-foreground">
                  Create a staff account. Your facility’s owner adds you and decides what you can
                  do.
                </span>
                <span className="mt-5 inline-flex items-center gap-1.5 font-semibold text-primary">
                  Create a staff account <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </Link>
            </div>
            <p className="mt-8 text-lg">
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-semibold text-primary underline underline-offset-4"
              >
                Sign in
              </Link>
              . It is the same sign-in whichever of the three you are.
            </p>
          </div>
        </section>
      </main>

      <footer className="bg-brand-deeper px-4 py-12 text-base text-white/75 sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <span className="flex items-center gap-2 text-lg font-semibold text-white">
              <Stethoscope className="size-5" aria-hidden="true" /> Medilink
            </span>
            <p className="mt-3 max-w-xs leading-relaxed">
              Verified healthcare professionals. Reliable clinical cover. Healthcare workforce
              management for Nigeria.
            </p>
            <div className="mt-5">
              <p className="mb-1.5 text-sm font-medium text-white/60">Text size</p>
              <TextSizeControl className="[&_button:hover]:bg-white/10 [&_button[aria-pressed=true]]:bg-white [&_button[aria-pressed=true]]:text-brand-deeper [&_button]:text-white" />
            </div>
          </div>
          <nav aria-label="Product">
            <p className="font-semibold text-white">Medilink</p>
            <ul className="mt-3 space-y-1">
              {(
                [
                  ['#how-it-works', 'How it works'],
                  ['#for-facilities', 'For facilities'],
                  ['#for-practitioners', 'For practitioners'],
                  ['#safety', 'Safety and privacy'],
                  ['#pilot', 'Pilot and pricing'],
                  ['#faq', 'Questions'],
                ] as [string, string][]
              ).map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    className="inline-flex min-h-11 items-center hover:text-white hover:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Accounts">
            <p className="font-semibold text-white">Your account</p>
            <ul className="mt-3 space-y-1">
              {(
                [
                  ['/login', 'Sign in'],
                  ['/register', 'Register as a practitioner'],
                  ['/register?as=facility', 'Register your facility'],
                  ['/register?as=staff', 'Create a staff account'],
                ] as [string, string][]
              ).map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-11 items-center hover:text-white hover:underline"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Legal and contact">
            <p className="font-semibold text-white">Legal and help</p>
            <ul className="mt-3 space-y-1">
              {(
                [
                  ['/terms', 'Terms'],
                  ['/privacy', 'Privacy notice'],
                  ['/contact', 'Contact'],
                ] as [string, string][]
              ).map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-11 items-center hover:text-white hover:underline"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        {/* Shown only when a line has been configured: nothing here invents one. */}
        <div className="mx-auto mt-8 max-w-7xl">
          <SupportContact tone="dark" />
        </div>
        <div className="mx-auto mt-8 max-w-7xl border-t border-white/10 pt-6 text-sm text-white/60">
          © {new Date().getFullYear()} Medilink
        </div>
      </footer>
    </div>
  );
}
