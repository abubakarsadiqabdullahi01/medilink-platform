/**
 * The generic shape every module's typed request errors share: a stable code
 * and an HTTP status, so `handleGuardedRequest` can translate a thrown error
 * into a response without knowing which module threw it.
 *
 * Lives here rather than in `auth`'s domain because it is platform machinery
 * — every module from Stage 5 onwards needs its own typed errors, and shared
 * request-handling code cannot depend on one peer module's internals to
 * recognise them.
 */
export class HttpError extends Error {
  constructor(readonly code: string, message: string, readonly status: number = 400) {
    super(message);
    this.name = 'HttpError';
  }
}
