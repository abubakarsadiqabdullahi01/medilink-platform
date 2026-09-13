import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The shadcn convention: merge conditional classes, then let tailwind-merge
 * resolve conflicts so a caller's `className` always wins over a component's
 * defaults rather than losing to whichever CSS rule happens to come later.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
