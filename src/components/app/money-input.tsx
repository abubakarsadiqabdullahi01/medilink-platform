'use client';

import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { cleanMoneyInput, groupMoneyInput } from '@/components/app/format';

/**
 * A box for an amount in naira (UXA-15).
 *
 * It was a `type="number"` field in one place and a bare text field in two others. A number
 * field brings a spinner that changes the rate on a scroll, a keyboard that omits the comma, and
 * no thousands separators, so "500000" is a number somebody has to count the zeros of.
 *
 * While you type it holds exactly what you typed, cleaned to digits and a point, so the cursor
 * never jumps; when you leave, it shows "500,000". The value it reports is always the clean
 * form ("500000"), which `parseNairaToKobo` reads and the form sends as kobo.
 */
export function MoneyInput({
  value,
  onValueChange,
  className,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (raw: string) => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        ₦
      </span>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        className={cn('tabular pl-8', className)}
        value={focused ? value : groupMoneyInput(value)}
        onChange={(event) => onValueChange(cleanMoneyInput(event.target.value))}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
      />
    </div>
  );
}
