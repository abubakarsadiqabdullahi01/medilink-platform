/**
 * What a server type looks like after `JSON.stringify` and `JSON.parse`: dates are strings.
 *
 * A dashboard's response type is declared once, beside the query that builds it, and the browser
 * reads it through this. The alternative was a hand-copied interface in the page, which is how a
 * field added on the server stayed invisible on the screen — or, worse, was typed as a number
 * and arrived as text.
 */
export type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
