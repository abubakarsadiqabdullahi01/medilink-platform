import { z } from 'zod';

/**
 * Environment is validated once, at boot. A missing or malformed variable
 * fails the process immediately rather than surfacing as a runtime error in
 * the middle of a shift check-in.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),

  STORAGE_ENDPOINT: z.string().url(),
  /**
   * The endpoint a **browser** must use, when it differs from the one this
   * process uses. In Docker the app reaches MinIO at `http://storage:9000`, a
   * name that resolves only inside the compose network — a signed URL built
   * against it is unreachable from the machine the person is sitting at.
   * Unset in production, where Tigris has one address for everybody.
   */
  STORAGE_PUBLIC_ENDPOINT: z.string().url().optional(),
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  SMS_PROVIDER: z.enum(['console', 'termii', 'africastalking']).default('console'),
  SMS_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),

  // 'console' is the local stub, the same shape SMS_PROVIDER uses. It
  // refuses to run outside local, because a stub that reports money as paid
  // in staging is worse than no gateway at all.
  PAYMENT_PROVIDER: z.enum(['console', 'paystack', 'remita', 'none']).default('none'),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),

  // Identity and professional-registration checks default to `none` — both
  // need a paid provider subscription this project does not have, and the
  // fallback is a compliance officer recording the evidence by hand. See
  // src/lib/verification/index.ts.
  NIN_VERIFICATION_PROVIDER: z.enum(['none', 'sandbox', 'live']).default('none'),
  NIN_VERIFICATION_API_KEY: z.string().optional(),

  MDCN_VERIFICATION_PROVIDER: z.enum(['none', 'sandbox', 'live']).default('none'),
  MDCN_VERIFICATION_API_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed. Copy .env.example to .env and fill it in.');
}

export const env = parsed.data;
export type Env = typeof env;
