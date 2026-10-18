import { z } from 'zod';
import { isNigerianPhone } from '@/lib/phone';

const uuid = z.string().uuid();

export const inviteStaffSchema = z.object({
  facilityId: uuid,
  // Checked here as well as in the service, so a typo is a form error rather than a refusal.
  phone: z
    .string()
    .trim()
    .refine(isNigerianPhone, { message: 'Enter a Nigerian mobile number, for example 0803 123 4567.' }),
  roleKey: z.string().trim().min(3).max(60),
});

export const listStaffInvitationsSchema = z.object({ facilityId: uuid });

export const cancelStaffInvitationSchema = z.object({ id: uuid, facilityId: uuid });

export const respondStaffInvitationSchema = z.object({
  id: uuid,
  decision: z.enum(['accept', 'decline']),
});
