/**
 * How long and how, for Framer Motion. The CSS side reads --duration-* and --ease-out in
 * globals.css; these are the same numbers in the unit Framer wants (seconds), so a
 * screen that fades and a button that presses agree about what "quick" is.
 *
 * Inside a console nothing runs longer than `base`. `slow` is for the public pages.
 */
export const DURATION = { fast: 0.12, base: 0.18, slow: 0.32 } as const;

/** cubic-bezier(0.2, 0, 0, 1), written for Framer. */
export const EASE_OUT = [0.2, 0, 0, 1] as const;
