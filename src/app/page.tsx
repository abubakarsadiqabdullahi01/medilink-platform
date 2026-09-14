import Link from 'next/link';
import { Building2, ShieldCheck, Stethoscope, UserRound } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The front door.
 *
 * Three consoles rather than one, because the three jobs are genuinely
 * different: operations works queues, a facility creates work, a practitioner
 * does it. Which one somebody lands in is decided by the grants on their
 * account, not by which link they clicked — every page behind these refuses a
 * caller who does not hold the permission.
 */
const DOORS = [
  {
    href: '/practitioner',
    label: 'Practitioner',
    description: 'Your offers, your shifts, your timesheets.',
    icon: UserRound,
  },
  {
    href: '/facility',
    label: 'Facility',
    description: 'Publish a shift, find staff, approve the hours.',
    icon: Building2,
  },
  {
    href: '/admin',
    label: 'Operations',
    description: 'Credentials, incidents, disputes, fault decisions.',
    icon: ShieldCheck,
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
      <Stethoscope className="size-8 text-primary" />

      <p className="mt-6 text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground">
        Medilink
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        Verified healthcare workforce management
      </h1>
      <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
        Locum staffing for Nigeria, built so that every decision has a name and a reason against it.
        Nothing closes itself, and no correction destroys the value it replaces.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {DOORS.map((door) => {
          const Icon = door.icon;
          return (
            <Link key={door.href} href={door.href} className="group">
              <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
                <CardContent className="pt-6">
                  <Icon className="size-5 text-primary" />
                  <p className="mt-3 font-medium">{door.label}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {door.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/login" className={cn(buttonVariants())}>
          Sign in
        </Link>
        <Link
          href="/api/health"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
          Health check
        </Link>
      </div>

      <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
        Rates and billing are not live: the commercial terms they depend on are a business decision
        that has not been made, and inventing one in code would be the wrong place to make it.
      </p>
    </main>
  );
}
