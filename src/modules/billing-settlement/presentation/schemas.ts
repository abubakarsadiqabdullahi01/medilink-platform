import { z } from 'zod';

const uuid = z.string().uuid();

export const generateInvoiceSchema = z.object({
  facilityId: uuid,
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});
export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;

export const listInvoicesSchema = z.object({ facilityId: uuid });

export const invoiceActionSchema = z.object({ id: uuid, facilityId: uuid });
export type InvoiceActionInput = z.infer<typeof invoiceActionSchema>;

export const preparePayoutSchema = z.object({ practitionerId: uuid });

export const payoutIdSchema = z.object({ id: uuid });

export const myPayoutsSchema = z.object({
  scopeType: z.enum(['SELF', 'PLATFORM']),
  scopeId: uuid.optional(),
});
