'use client';

import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { DURATION, EASE_OUT } from '@/lib/ui/motion-tokens';

/**
 * The console's two pieces of motion, and the restraint around them.
 *
 * Animation on a queue is easy to overdo and the cost lands on the people
 * least able to afford it: an officer clearing forty rows sees every
 * transition forty times, and anything longer than about 200ms starts to feel
 * like the software is thinking. So there are two primitives here and no
 * general-purpose animation kit.
 *
 * **`LazyMotion` with `domAnimation`, and `m` rather than `motion`.** The full
 * `motion` component bundles every feature — layout projection, drag, SVG
 * path morphing — about 34 kB of it, on a console that fades and slides.
 * This loads roughly 15 kB and nothing that is not used. Importing `motion`
 * anywhere would silently undo that, which is why nothing outside this file
 * imports framer-motion at all.
 *
 * **`useReducedMotion` is honoured, not decorated around.** Somebody who has
 * asked their operating system for less motion gets none: the duration goes
 * to zero rather than the animation being made subtler. Vestibular disorders
 * are not a preference about taste, and a 150ms slide is still a slide.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}

/**
 * A screen arriving: the detail view replacing its list, or the other way.
 *
 * Fades and lifts a few pixels. The point is to say "this is a different
 * screen" to somebody who clicked a row and would otherwise see the page
 * substitute itself with no acknowledgement — not to be noticed.
 */
export function ScreenTransition({
  children,
  screenKey,
}: {
  children: ReactNode;
  /** Changes when the screen does, which is what restarts the animation. */
  screenKey: string;
}) {
  const still = useReducedMotion();

  return (
    <m.div
      key={screenKey}
      initial={still ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: still ? 0 : DURATION.base, ease: EASE_OUT }}
    >
      {children}
    </m.div>
  );
}

/**
 * Rows settling into a queue.
 *
 * Staggered, but capped: past about the tenth row the delay would be longer
 * than the time it takes to read the first one, and a queue that reveals
 * itself slowly is a queue somebody is waiting on. Rows beyond the cap arrive
 * with the tenth.
 */
const STAGGER_SECONDS = 0.02;
const MAX_STAGGERED_ROWS = 10;

export function RowTransition({ children, index }: { children: ReactNode; index: number }) {
  const still = useReducedMotion();

  return (
    <m.div
      initial={still ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: still ? 0 : DURATION.base,
        delay: still ? 0 : Math.min(index, MAX_STAGGERED_ROWS) * STAGGER_SECONDS,
        ease: EASE_OUT,
      }}
    >
      {children}
    </m.div>
  );
}
