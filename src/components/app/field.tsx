'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/**
 * A form field that is labelled, explained and error-reporting without each form
 * remembering how.
 *
 * Done by hand, a field is five attributes that have to agree — `htmlFor` and `id`,
 * `aria-describedby` pointing at the help and at the error, `aria-invalid` — and in this
 * codebase most forms had the label and none of the rest, so a screen reader announced "edit
 * text" and then said nothing about why the field was wrong. This wires them from one
 * place:
 *
 * - The **label** is always visible and always attached. Never a placeholder standing in for one.
 * - The **hint** is short and sits between the label and the input, where it is read first.
 * - The **error** appears below the input after the field has been touched (react-hook-form's
 *   `onTouched` mode already decides when), with an icon and the words, and is announced:
 *   `role="alert"` makes a screen reader read it the moment it appears.
 *
 * The one child must be a single form control; its `id`, `aria-describedby` and
 * `aria-invalid` are set for it.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Marks the label for people who need to know before they submit. */
  required?: boolean;
  /** Says "(optional)" in words, which is clearer than an asterisk for everything else. */
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const control = Children.only(children) as ReactElement<Record<string, unknown>>;

  const describedBy =
    [
      hint ? hintId : null,
      error ? errorId : null,
      control.props['aria-describedby'] as string | undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label
        htmlFor={(control.props.id as string | undefined) ?? id}
        className="text-base font-medium leading-snug"
      >
        {label}
        {required ? (
          <span className="text-destructive-text" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </Label>
      {hint ? (
        <p id={hintId} className="text-sm leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {isValidElement(control)
        ? cloneElement(control, {
            id: (control.props.id as string | undefined) ?? id,
            'aria-describedby': describedBy,
            'aria-invalid': error ? true : control.props['aria-invalid'],
            'aria-required': required ? true : control.props['aria-required'],
          })
        : control}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-sm font-medium text-destructive-text"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
