import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'border-destructive/30 bg-destructive/5 text-destructive-text [&>svg]:text-destructive-text',
        warning: 'border-warning/30 bg-warning/5 text-warning [&>svg]:text-warning',
        info: 'border-info/30 bg-info/5 text-info [&>svg]:text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/**
 * A notice is announced to a screen reader only when it is news (UXA-07).
 *
 * Every alert used to carry `role="alert"`, so a banner that was simply part of the page —
 * "this account is not attached to a facility yet", "your licence is under review" — was
 * read out again each time the page opened. Now a failure (`destructive`), which appears
 * because something went wrong, is announced; the rest sit in the page for the reader to
 * come to. `live` overrides either way: a destructive notice that is a standing fact (a
 * rejected facility) passes `live={false}`, and a warning that appears in answer to an
 * action passes `live`.
 */
const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & { live?: boolean }
>(({ className, variant, live, role, ...props }, ref) => (
  <div
    ref={ref}
    role={role ?? ((live ?? variant === 'destructive') ? 'alert' : undefined)}
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 font-medium leading-none', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
