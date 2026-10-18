import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, Stethoscope, type LucideIcon } from 'lucide-react';
import { DocumentTitle } from '@/components/app/document-title';
import { TextSizeControl } from '@/components/app/text-size-control';

export interface AuthPoint {
  title: string;
  description: string;
}

/**
 * The frame for signing in, signing up and getting back in.
 *
 * Three pages used to build this themselves, three slightly different ways: no way back to the
 * home page, a text-size control floating in a corner, and — on a phone — nothing at all of the
 * explanation the wide screen showed beside the form. So the person who most needed to know
 * "what happens after I register?" (the one on a 390px phone) was the one who was never told.
 *
 * - The header is the same everywhere: the brand, which goes home, and the text-size control.
 * - The explanation beside the form on a wide screen is the **same content** below it on a
 *   phone, in a disclosure that is closed by default so it never pushes the form down.
 * - The form column is `main`, so "skip to main" and landmark navigation land on the form.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  aside,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  aside?: { icon: LucideIcon; headline: string; points: AuthPoint[]; summary?: string };
}) {
  const Icon = aside?.icon;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <DocumentTitle title={title} />
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight text-primary"
            aria-label="Medilink home"
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Stethoscope className="size-5" aria-hidden="true" />
            </span>
            Medilink
          </Link>
          <TextSizeControl />
        </header>

        <main id="main" className="flex flex-1 justify-center px-4 pb-12 pt-4 sm:px-6 sm:pt-8">
          <div className="w-full max-w-md">
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">{description}</p>
            ) : null}

            <div className="mt-6">{children}</div>

            {aside ? (
              <details className="group mt-6 rounded-xl border bg-card lg:hidden">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                  {aside.summary ?? 'What happens next'}
                  <ChevronDown
                    className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="space-y-4 border-t px-4 py-4">
                  <p className="font-medium leading-snug">{aside.headline}</p>
                  <ul className="space-y-3">
                    {aside.points.map((point) => (
                      <li key={point.title}>
                        <p className="font-medium">{point.title}</p>
                        <p className="text-base leading-relaxed text-muted-foreground">
                          {point.description}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}

            {footer ? (
              <div className="mt-6 space-y-1 text-base text-muted-foreground">{footer}</div>
            ) : null}
          </div>
        </main>
      </div>

      {aside && Icon ? (
        <aside
          aria-label="About Medilink"
          className="hidden bg-brand-deep p-12 text-white lg:flex lg:flex-col lg:justify-center"
        >
          <Icon className="size-10 text-brand-glow" aria-hidden="true" />
          <p className="mt-6 max-w-md text-2xl font-semibold leading-snug tracking-tight">
            {aside.headline}
          </p>
          <ul className="mt-8 max-w-md divide-y divide-white/15 border-y border-white/15">
            {aside.points.map((point) => (
              <li key={point.title} className="py-4">
                <p className="font-semibold">{point.title}</p>
                <p className="mt-1 leading-relaxed text-white/80">{point.description}</p>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}

/** A link in running text, large enough to hit with a thumb. */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 hover:no-underline"
    >
      {children}
    </Link>
  );
}
