import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  passwordProblems,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from './password';

describe('passwordProblems', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblems('correct horse battery')).toEqual([]);
  });

  it('rejects a short password', () => {
    const problems = passwordProblems('short');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it('rejects a password containing the user own phone number', () => {
    // The failure that actually happens on a shared ward computer.
    const problems = passwordProblems('my8031234567', { phone: '+2348031234567' });
    expect(problems.join(' ')).toContain('phone number');
  });

  it('rejects a password containing the user name', () => {
    const problems = passwordProblems('AbubakarSadiq99', { fullName: 'Abubakar Sadiq' });
    expect(problems.join(' ')).toContain('name');
  });

  it('rejects a password containing the email local part', () => {
    const problems = passwordProblems('sadiq.dev-2026', { email: 'sadiq.dev@example.com' });
    expect(problems.join(' ')).toContain('email');
  });

  it('rejects well-known passwords', () => {
    expect(passwordProblems('password1').length).toBeGreaterThan(0);
    expect(passwordProblems('nigeria123').length).toBeGreaterThan(0);
  });

  it('does not impose composition rules on a long passphrase', () => {
    expect(passwordProblems('theatre nurse night rota')).toEqual([]);
  });

  it('reports each problem once', () => {
    const problems = passwordProblems('sadiq', { fullName: 'Sadiq Abubakar' });
    expect(new Set(problems).size).toBe(problems.length);
  });
});

describe('hashPassword and verifyPassword', () => {
  it('verifies the correct password', async () => {
    const encoded = await hashPassword('theatre nurse night rota');
    expect(await verifyPassword(encoded, 'theatre nurse night rota')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const encoded = await hashPassword('theatre nurse night rota');
    expect(await verifyPassword(encoded, 'theatre nurse day rota')).toBe(false);
  });

  it('salts every hash, so identical passwords differ on disk', async () => {
    const first = await hashPassword('same password here');
    const second = await hashPassword('same password here');
    expect(first).not.toBe(second);
  });

  it('produces an argon2id hash and never contains the password', async () => {
    const encoded = await hashPassword('theatre nurse night rota');
    expect(encoded.startsWith('$argon2id$')).toBe(true);
    expect(encoded).not.toContain('theatre');
  });

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });
}, 30_000);
