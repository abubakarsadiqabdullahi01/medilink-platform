import { z } from 'zod';

const uuid = z.string().uuid();

/**
 * An account being given. Whether it is a plausible one (ten digits, a name that
 * is not a single letter) is the application's to say, so it can say which.
 */
export const submitAccountSchema = z.object({
  bankName: z.string().trim().min(1).max(200),
  accountName: z.string().trim().min(1).max(300),
  accountNumber: z.string().trim().min(1).max(40),
});

export const accountIdSchema = z.object({ id: uuid });

export const reviewAccountSchema = accountIdSchema.extend({
  decision: z.enum(['verify', 'reject']),
  note: z.string().trim().max(500).optional(),
  overrideReason: z.string().trim().max(500).optional(),
});

export const queueSchema = z.object({});
