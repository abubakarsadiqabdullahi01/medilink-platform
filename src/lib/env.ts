import { z } from 'zod';
import { deploymentProblems } from './env-rules';

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
  // A file the console adapter also appends each message to, one JSON object
  // per line. The browser journeys read one-time codes from it; it means
  // nothing to any other adapter and is ignored by them.
  SMS_CONSOLE_OUTBOX: z.string().optional(),
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

  /** A request slower than this is logged as a warning (see lib/http/timing.ts). */
  SLOW_REQUEST_MS: z.coerce.number().int().positive().default(500),
});

/**
 * `next build` imports every route to read its segment config, which runs
 * this file — and the production image is built with no environment at all:
 * .dockerignore keeps .env out, and secrets do not belong in an image. So
 * validating here failed the image build outright; every green build until
 * then had a developer's .env lying beside it. Nothing connects to anything
 * while building, so the check waits for the server to start, where it runs
 * in full.
 */
const building = process.env.NEXT_PHASE === 'phase-production-build';

const parsed = (building ? schema.partial() : schema).safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed. Copy .env.example to .env and fill it in.');
}

export type Env = z.infer<typeof schema>;
export const env = parsed.data as Env;

if (!building) {
  const problems = deploymentProblems(env, process.env.APP_ENV !== undefined);
  if (problems.length > 0) {
    console.error(`Refusing to start in ${env.APP_ENV}:\n- ${problems.join('\n- ')}`);
    throw new Error('This configuration is not safe to run here. See the problems above.');
  }
}
