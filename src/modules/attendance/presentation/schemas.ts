import { z } from 'zod';

/**
 * `assignmentId` comes from the [id] route segment. `facilityId` carries the
 * authorisation scope, checked before any database read — the same shape
 * service requests and matching already use.
 */
const uuid = z.string().uuid();

export const issueTokenSchema = z.object({
  id: uuid,
  facilityId: uuid,
  purpose: z.enum(['CHECK_IN', 'CHECK_OUT']),
});
export type IssueTokenInput = z.infer<typeof issueTokenSchema>;

export const presentTokenSchema = z.object({
  id: uuid,
  purpose: z.enum(['CHECK_IN', 'CHECK_OUT']),
  // Six digits typed, or a whole scanned payload. The service tells them
  // apart, because they are the same secret.
  code: z.string().trim().min(6).max(200),
  deviceLabel: z.string().trim().max(120).optional(),
});
export type PresentTokenInput = z.infer<typeof presentTokenSchema>;

export const manualAttendanceSchema = z.object({
  id: uuid,
  facilityId: uuid,
  checkedInAt: z.coerce.date(),
  checkedOutAt: z.coerce.date(),
  breakMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  // Mandatory, and long enough to be a sentence: a manual record is the one a
  // dispute turns on, and "network" tells nobody anything.
  reason: z.string().trim().min(10).max(500),
});
export type ManualAttendanceInput = z.infer<typeof manualAttendanceSchema>;

export const readAttendanceSchema = z.object({
  id: uuid,
  scopeType: z.enum(['SELF', 'FACILITY']),
  scopeId: uuid.optional(),
});
export type ReadAttendanceInput = z.infer<typeof readAttendanceSchema>;
