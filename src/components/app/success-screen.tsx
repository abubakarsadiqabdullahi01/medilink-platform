'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CircleCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * What a completed task says: what just happened, and what happens next.
 *
 * A toast that fades is the wrong place for the thing a person most needs after submitting
 * hours, publishing a shift or sending credentials: *what now?* This is a screen, so it stays
 * until they have read it. It takes focus when it appears and is announced as a status, so a
 * keyboard or screen-reader user is not left on a button that has just disappeared.
 *
 * `steps` is the honest account of what follows, including who does it and roughly when. If
 * there is no good answer to "what happens next", that is a product question, not one to
 * paper over with a green tick.
 */
export function SuccessScreen({
  title,
  description,
  steps,
  actions,
  bare = false,
}: {
  title: string;
  description?: ReactNode;
  /** "What happens next", in order. */
  steps?: ReactNode[];
  /** The next thing to do: usually one primary link and one quiet one. */
  actions?: ReactNode;
  /** Without its own card, for use inside a dialog that already is one. */
  bare?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const Frame = bare ? 'div' : Card;
  return (
    <Frame
      role="status"
      className={bare ? 'space-y-5' : 'mx-auto max-w-xl space-y-5 p-6 sm:p-8'}
    >
      <div className="flex items-start gap-3">
        <CircleCheck className="mt-1 size-7 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0">
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold leading-snug tracking-tight outline-none"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>

      {steps && steps.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What happens next
          </h3>
          <ol className="space-y-2.5">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3 leading-relaxed">
                <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {actions ? <div className="flex flex-wrap items-center gap-3 pt-1">{actions}</div> : null}
    </Frame>
  );
}
