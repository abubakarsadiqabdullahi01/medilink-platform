import { env } from '../env';

/**
 * Identity (NIMC) and professional-registration (MDCN and the other
 * regulators) verification, behind adapters that are **off by default**.
 *
 * Both need a paid provider subscription this project does not have. Rather
 * than block the modules that would use them, the default is `none`: the
 * adapter reports itself disabled and the application falls back to a
 * compliance officer entering the evidence by hand — which is the path that
 * exists and works. Buying a subscription later changes who supplies the
 * evidence, not the endpoints, the schema, or anything a caller sees.
 *
 * This mirrors src/lib/sms/index.ts, which is the established shape here for
 * a provider that has not been bought yet: a working local stand-in, real
 * adapters that throw until they are implemented, and a switch in the
 * environment rather than in code.
 */

export type VerificationProvider = 'none' | 'sandbox' | 'live';

export interface IdentityCheckRequest {
  /** Raw, never persisted and never logged — see recordIdentityVerification. */
  nin: string;
  fullName: string;
  dateOfBirth?: string;
}

export interface IdentityCheckResult {
  provider: string;
  /** Whether the name the provider holds matches the one on the account. */
  nameMatch: boolean;
  retrievedAt: Date;
}

export type RegistrationStatusValue = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'STRUCK_OFF' | 'UNKNOWN';

export interface RegistrationCheckRequest {
  folioNumber: string;
  regulator: string;
}

export interface RegistrationCheckResult {
  provider: string;
  registrationStatus: RegistrationStatusValue;
  practiceType: string | null;
  location: string | null;
  expiresAt: Date | null;
  retrievedAt: Date;
}

export interface VerificationAdapter<TRequest, TResult> {
  readonly name: string;
  /**
   * False when the provider is switched off. Callers branch on this rather
   * than reading the environment, so "what happens when it is off" is one
   * decision in one place.
   */
  readonly enabled: boolean;
  check(request: TRequest): Promise<TResult>;
}

/** Selected `none`: the caller is expected to fall back to manual review. */
export class VerificationDisabledError extends Error {
  readonly code = 'verification_disabled';
  constructor(kind: string) {
    super(
      `${kind} verification is switched off. A compliance officer records the evidence by hand until a provider subscription is configured.`,
    );
    this.name = 'VerificationDisabledError';
  }
}

/** Selected a real provider that has no adapter, or no credentials. */
export class VerificationNotConfiguredError extends Error {
  readonly code = 'verification_not_configured';
  constructor(provider: string, detail: string) {
    super(`The ${provider} verification adapter is not usable: ${detail}`);
    this.name = 'VerificationNotConfiguredError';
  }
}

function disabled<TRequest, TResult>(kind: string): VerificationAdapter<TRequest, TResult> {
  return {
    name: 'none',
    enabled: false,
    async check() {
      throw new VerificationDisabledError(kind);
    },
  };
}

/**
 * Reachable only by deliberately setting a provider. It throws rather than
 * silently passing everyone: a verification step that answers "yes" without
 * asking anybody is worse than one that is switched off, because it looks
 * like it worked.
 */
function unimplemented<TRequest, TResult>(
  provider: string,
  detail: string,
): VerificationAdapter<TRequest, TResult> {
  return {
    name: provider,
    enabled: true,
    async check() {
      throw new VerificationNotConfiguredError(provider, detail);
    },
  };
}

function select<TRequest, TResult>(
  kind: string,
  provider: VerificationProvider,
  apiKey: string | undefined,
  liveName: string,
): VerificationAdapter<TRequest, TResult> {
  if (provider === 'none') return disabled<TRequest, TResult>(kind);

  // Fail on the configuration, not on the first practitioner: a provider
  // selected without a key is a deploy-time mistake and should read like one.
  if (!apiKey) {
    return unimplemented<TRequest, TResult>(
      `${liveName}:${provider}`,
      'no API key is set for it',
    );
  }

  return unimplemented<TRequest, TResult>(
    `${liveName}:${provider}`,
    'the adapter has not been written yet — no subscription exists to write it against',
  );
}

export function identityVerifier(): VerificationAdapter<IdentityCheckRequest, IdentityCheckResult> {
  return select('Identity', env.NIN_VERIFICATION_PROVIDER, env.NIN_VERIFICATION_API_KEY, 'nimc');
}

export function registrationVerifier(): VerificationAdapter<
  RegistrationCheckRequest,
  RegistrationCheckResult
> {
  return select(
    'Professional registration',
    env.MDCN_VERIFICATION_PROVIDER,
    env.MDCN_VERIFICATION_API_KEY,
    'mdcn',
  );
}

export function isAutomatedIdentityVerificationEnabled(): boolean {
  return identityVerifier().enabled;
}

export function isAutomatedRegistrationVerificationEnabled(): boolean {
  return registrationVerifier().enabled;
}
