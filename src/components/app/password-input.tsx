'use client';

import { forwardRef, useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * A password field with a "show what I typed" switch.
 *
 * On a phone the keyboard is small and the password is ten characters or more; typing it twice
 * blind is how somebody ends up with an account they cannot get back into. The switch is a real
 * 44px button beside the field, not an icon inside the text target, and its name deliberately does
 * not contain the word "password" so it never competes with the field's own label for a screen
 * reader or a test that looks the field up by it.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<'input'>, 'type'>>(
  ({ className, ...props }, ref) => {
    const [shown, setShown] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={shown ? 'text' : 'password'}
          className={cn('pr-12', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-label={shown ? 'Hide what I typed' : 'Show what I typed'}
          aria-pressed={shown}
          className="absolute right-0 top-0 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown ? (
            <EyeOff className="size-5" aria-hidden="true" />
          ) : (
            <Eye className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
