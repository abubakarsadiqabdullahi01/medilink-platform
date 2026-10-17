import { z } from 'zod';
import { isNigerianPhone } from '@/lib/phone';

const uuid = z.string().uuid();

const scopeType = z.enum(['PLATFORM', 'FACILITY_GROUP', 'FACILITY', 'BRANCH', 'DEPARTMENT', 'SELF']);

export const grantRoleSchema = z
  .object({
    userId: uuid,
    roleKey: z.string().trim().min(3).max(60),
    scopeType,
    scopeId: uuid.optional(),
  })
  .refine((value) => value.scopeType === 'PLATFORM' || Boolean(value.scopeId), {
    // A FACILITY grant with no facility would authorise nothing or
    // everything depending on how the guard read it. Neither is acceptable.
    message: 'Name the scope this role applies to.',
    path: ['scopeId'],
  });
export type GrantRoleInput = z.infer<typeof grantRoleSchema>;

export const listGrantsSchema = z.object({
  scopeType,
  scopeId: uuid.optional(),
});

export const revokeGrantSchema = z.object({
  id: uuid,
  scopeType,
  scopeId: uuid.optional(),
  // Required: "they had access in March and it was taken away in June" is a
  // question an audit asks, and the answer needs a why.
  reason: z.string().trim().min(5).max(500),
});

export const findUserSchema = z.object({
  scopeType,
  scopeId: uuid.optional(),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .refine(isNigerianPhone, 'Enter a Nigerian mobile number, for example 0803 123 4567.'),
});

export const changeRoleSchema = z.object({
  id: uuid,
  scopeType,
  scopeId: uuid.optional(),
  roleKey: z.string().trim().min(3).max(60),
  // The same reason a removal needs: "why did she become an owner" is asked as often as "why was he removed".
  reason: z.string().trim().min(5).max(500),
});

export const removeAccessSchema = z.object({
  userId: uuid,
  scopeType,
  scopeId: uuid.optional(),
  reason: z.string().trim().min(5).max(500),
});
