'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, Stethoscope } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TextSizeControl } from '@/components/app/text-size-control';
import { cn } from '@/lib/utils';

export const LANDING_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#for-facilities', label: 'For facilities' },
  { href: '#for-practitioners', label: 'For practitioners' },
  { href: '#safety', label: 'Safety and privacy' },
];

/**
 * The public header: the brand, four places on this page, and the two things a visitor does —
 * sign in, or register.
 *
 * Kept short on purpose. Pricing, FAQ and the legal links are in the footer; a header with eight
 * entries is a header nobody reads. On a phone the four places go behind one menu button, and the
 * text-size control goes in there with them so it is still one tap away rather than gone: the
 * people who need larger text most are the ones on small screens.
 *
 * "Sign in" is a single entry for everybody. Which console opens is decided by the account, not
 * by which door somebody used.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-md text-xl font-semibold tracking-tight text-primary"
          aria-label="Medilink home"
        >
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Stethoscope className="size-5" aria-hidden="true" />
          </span>
          Medilink
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="On this page">
          {LANDING_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-base font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <TextSizeControl className="hidden lg:flex" />
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
          <Link href="/register" className={cn(buttonVariants(), 'hidden sm:inline-flex')}>
            Register
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-haspopup="dialog"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-accent lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="top" className="lg:hidden">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Places on this page, text size, and registration.
            </SheetDescription>
          </SheetHeader>
          <nav className="mt-3 flex flex-col" aria-label="On this page">
            {LANDING_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center rounded-md px-2 text-lg font-medium hover:bg-accent"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <span className="text-base font-medium">Text size</span>
            <TextSizeControl />
          </div>
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className={cn(buttonVariants({ size: 'lg' }), 'mt-4 w-full')}
          >
            Register as a practitioner
          </Link>
        </SheetContent>
      </Sheet>
    </header>
  );
}
