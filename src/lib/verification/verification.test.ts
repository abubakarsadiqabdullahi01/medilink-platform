import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The property these tests exist to hold: with no subscription configured,
 * nothing in the application depends on one. The adapters report themselves
 * disabled, and a caller that ignores that and asks anyway gets an error
 * rather than a silent pass.
 */
async function withEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const loaded = await import('./index');
  return { loaded, previous };
}

const restore: Array<() => void> = [];

afterEach(() => {
  while (restore.length) restore.pop()?.();
  vi.resetModules();
});

function track(previous: Record<string, string | undefined>) {
  restore.push(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe('with no provider configured, which is the default', () => {
  it('reports identity verification as disabled', async () => {
    const { loaded, previous } = await withEnv({
      NIN_VERIFICATION_PROVIDER: undefined,
      NIN_VERIFICATION_API_KEY: undefined,
    });
    track(previous);

    expect(loaded.isAutomatedIdentityVerificationEnabled()).toBe(false);
    expect(loaded.identityVerifier().name).toBe('none');
  });

  it('reports registration verification as disabled', async () => {
    const { loaded, previous } = await withEnv({
      MDCN_VERIFICATION_PROVIDER: undefined,
      MDCN_VERIFICATION_API_KEY: undefined,
    });
    track(previous);

    expect(loaded.isAutomatedRegistrationVerificationEnabled()).toBe(false);
    expect(loaded.registrationVerifier().name).toBe('none');
  });

  it('throws rather than answering, if a caller asks anyway', async () => {
    const { loaded, previous } = await withEnv({ NIN_VERIFICATION_PROVIDER: 'none' });
    track(previous);

    // A verification step that answers "yes" without asking anybody is worse
    // than one that is switched off, because it looks like it worked.
    await expect(
      loaded.identityVerifier().check({ nin: '12345678901', fullName: 'Amina Yusuf' }),
    ).rejects.toThrow(/switched off/);
  });
});

describe('when a provider is selected', () => {
  it('refuses a provider with no API key, as a configuration error', async () => {
    const { loaded, previous } = await withEnv({
      NIN_VERIFICATION_PROVIDER: 'live',
      NIN_VERIFICATION_API_KEY: undefined,
    });
    track(previous);

    const verifier = loaded.identityVerifier();
    expect(verifier.enabled).toBe(true);
    await expect(
      verifier.check({ nin: '12345678901', fullName: 'Amina Yusuf' }),
    ).rejects.toThrow(/no API key/);
  });

  it('refuses a configured provider whose adapter does not exist yet', async () => {
    const { loaded, previous } = await withEnv({
      MDCN_VERIFICATION_PROVIDER: 'sandbox',
      MDCN_VERIFICATION_API_KEY: 'test-key',
    });
    track(previous);

    // There is no subscription to write the adapter against, so selecting one
    // fails loudly rather than pretending.
    await expect(
      loaded.registrationVerifier().check({ folioNumber: 'MDCN/R/12345', regulator: 'MDCN' }),
    ).rejects.toThrow(/has not been written yet/);
  });
});
