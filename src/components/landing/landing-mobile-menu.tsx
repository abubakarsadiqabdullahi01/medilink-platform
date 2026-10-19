'use client';

import Link from 'next/link';
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
import { LANDING_LINKS } from './landing-links';

/**
 * The phone menu, in its own file so the public page only downloads it when somebody opens it.
 * A visitor on a weak connection who never taps the menu never pays for a dialog library.
 */
export default function LandingMobileMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
              onClick={() => onOpenChange(false)}
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
          onClick={() => onOpenChange(false)}
          className={cn(buttonVariants({ size: 'lg' }), 'mt-4 w-full')}
        >
          Register as a practitioner
        </Link>
      </SheetContent>
    </Sheet>
  );
}
