'use client';

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import { hasImage } from '@/lib/ui/images';

/**
 * The right half of the sign-in, sign-up and password pages: a photograph with one thing to say.
 *
 * The logo is on the form's side, where the page begins; the panel has only the one thing to say.
 *
 * Wide screens only. On a phone the form is the whole screen, and a photograph would be a few hundred
 * kilobytes of a connection spent on something nobody can see beside it; `hidden` means the browser
 * does not fetch it either.
 *
 * The photograph is optional. If the file is missing or fails, the teal ground it sits on is the panel,
 * as it was before there was one. The scrim is heavy on purpose: the words on it must read at 4.5:1
 * wherever the picture happens to be bright, which no automated check can promise for a photograph.
 */
export function AuthPanel({ children }: { children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const photo = hasImage('auth/shift-handover.webp') && !failed;

  return (
    <div className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-end">
      {photo ? (
        <>
          <Image
            src="/images/auth/shift-handover.webp"
            alt=""
            fill
            sizes="50vw"
            className="object-cover"
            onError={() => setFailed(true)}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-brand-night via-brand-night/85 to-brand-night/60"
          />
        </>
      ) : null}

      <div className="relative">{children}</div>
    </div>
  );
}
