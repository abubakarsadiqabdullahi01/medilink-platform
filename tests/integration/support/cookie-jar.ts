/**
 * An in-memory stand-in for next/headers cookies().
 *
 * The session services set and read the session cookie directly, which is the
 * right design — a route handler should not have to remember to do it — but
 * cookies() throws outside a request scope. Substituting a jar lets these
 * tests drive the real services rather than a copy of them.
 */
const store = new Map<string, string>();

export const cookieJar = {
  get(name: string): { name: string; value: string } | undefined {
    const value = store.get(name);
    return value === undefined ? undefined : { name, value };
  },
  set(options: { name: string; value: string }): void {
    store.set(options.name, options.value);
  },
  delete(name: string): void {
    store.delete(name);
  },
};

export function clearCookies(): void {
  store.clear();
}
