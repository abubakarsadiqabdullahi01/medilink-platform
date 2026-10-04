'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  useForm,
  type DefaultValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';

/**
 * A form whose rules are a Zod schema, validated the same way the API does.
 *
 * The console's forms were hand-rolled: a `useState` per field, a `disabled`
 * expression on the submit button that restated the rules in JavaScript, and
 * no per-field errors. Three things were wrong with that.
 *
 * The rules lived twice. `disabled={fullName.trim().length < 2 || !phone}` is
 * the route's Zod schema rewritten by hand, and the two drifted — the API
 * would refuse something the button had happily enabled, and the person got a
 * red banner instead of a hint under the field that was wrong.
 *
 * Everything re-rendered on every keystroke. A controlled input re-renders
 * the whole page component per character; react-hook-form keeps the input
 * uncontrolled and subscribes only what reads the value. On the registration
 * form that is the difference between ~40 renders to type a name and none.
 *
 * And errors had nowhere to go. A form with one banner at the top cannot say
 * *which* field is wrong, so it says "Something went wrong" and the person
 * guesses.
 *
 * `mode: 'onTouched'` is deliberate: validating as somebody types tells them
 * their email is invalid when they have typed one letter of it, which is
 * both true and useless. They are told when they leave the field, and from
 * then on as they fix it.
 */
export function useZodForm<TSchema extends z.ZodType>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.input<TSchema>>, 'resolver'> & {
    defaultValues?: DefaultValues<z.input<TSchema>>;
  },
): UseFormReturn<z.input<TSchema>> {
  return useForm<z.input<TSchema>>({
    // Asserted to the resolver type rather than left to inference: zodResolver's
    // own generics do not survive a wrapper that is generic over the schema.
    // The assertion is to a precise type, not to `any`, so the call site still
    // gets full field inference from `z.input<TSchema>`.
    resolver: zodResolver(schema) as Resolver<z.input<TSchema>>,
    mode: 'onTouched',
    ...options,
  });
}
