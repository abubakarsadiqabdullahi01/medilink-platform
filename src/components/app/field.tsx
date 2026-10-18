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
 * What a control needs to be tied to its label, its hint and its error. `Field` makes these and
 * either clones them onto its one child or hands them to a function child to spread.
 */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

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
 * Give it **one form control** as a child and it sets `id`, `aria-describedby`, `aria-invalid`
 * and `aria-required` on it. For a control that is not a single element — a Radix Select inside a
 * react-hook-form `Controller`, whose trigger is several components down — give it a **function**
 * and spread what it hands you onto the node that takes focus:
 *
 *     <Field label="Profession">
 *       {(a11y) => <Select …><SelectTrigger {...a11y} /></Select>}
 *     </Field>
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
  children: ReactNode | ((props: FieldControlProps) => ReactNode);
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const own = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  let labelFor = id;
  let control: ReactNode;

  if (typeof children === 'function') {
    control = children({
      id,
      'aria-describedby': own || undefined,
      'aria-invalid': error ? true : undefined,
      'aria-required': required ? true : undefined,
    });
  } else {
    const only = Children.only(children) as ReactElement<Record<string, unknown>>;
    labelFor = (only.props.id as string | undefined) ?? id;
    const describedBy =
      [own, only.props['aria-describedby'] as string | undefined].filter(Boolean).join(' ') || undefined;
    control = isValidElement(only)
      ? cloneElement(only, {
          id: labelFor,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : only.props['aria-invalid'],
          'aria-required': required ? true : only.props['aria-required'],
        })
      : only;
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={labelFor} className="text-base font-medium leading-snug">
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
      {control}
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
