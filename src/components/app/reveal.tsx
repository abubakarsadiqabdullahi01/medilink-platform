'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A section that fades up the first time it scrolls into view, and never again.
 *
 * It is drawn visible. Only after the page has loaded, and only for a section that is below the fold,
 * is it hidden and then revealed, so nothing is ever hidden for a person whose scripts have not run,
 * for a search engine, or on a first paint. A reader who has asked for less motion gets none: the
 * section simply stays as it is. The movement is eight pixels and `--duration-slow`; see globals.css.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'visible' | 'hidden' | 'shown'>('visible');

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Already in view when the page arrived: leave it where it is.
    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    setState('hidden');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setState('shown');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-reveal={state} className={cn('reveal', className)}>
      {children}
    </div>
  );
}
