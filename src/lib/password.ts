import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing. Argon2id with the OWASP baseline parameters; the
 * @node-rs binding ships prebuilt binaries, so a contributor on Windows can
 * install without a C toolchain.
 *
 * That binding is a native .node addon, so anything importing this module is
 * server-only and the package must stay outside the webpack bundle — see
 * serverComponentsExternalPackages in next.config.mjs. Import the pure policy
 * helpers from '@/lib/password-policy' instead when hashing is not needed.
 *
 * Parameters are recorded inside the encoded hash, so raising them later
 * verifies old hashes correctly and only new hashes get the stronger cost.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  passwordProblems,
  type PasswordContext,
} from './password-policy';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** False on any malformed or unrecognised hash, never a throw. */
export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}
