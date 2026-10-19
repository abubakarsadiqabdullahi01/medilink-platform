/**
 * Whether an optional picture was there when the app was built.
 *
 * `NEXT_PUBLIC_IMAGES` is a comma-separated list written by next.config.mjs from what is in
 * public/images/auth and public/images/empty. It is the build's answer, not the browser's, so a
 * picture that does not exist is never requested and a screen never waits to find that out.
 */
export function hasImage(path: string, list: string | undefined = process.env.NEXT_PUBLIC_IMAGES): boolean {
  return (list ?? '').split(',').includes(path);
}
