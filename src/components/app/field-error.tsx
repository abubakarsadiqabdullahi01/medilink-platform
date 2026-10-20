/**
 * One field's problem, under that field.
 *
 * `role="alert"` so a screen reader hears it when it appears rather than only if the person happens
 * to navigate back over the input. Pair it with `aria-invalid` on the field itself, which the input
 * components turn into a red border, so the problem is found by looking and not only by reading.
 */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive-text">
      {message}
    </p>
  );
}
