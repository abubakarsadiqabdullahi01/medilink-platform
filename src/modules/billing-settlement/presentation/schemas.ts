import { z } from 'zod';

const uuid = z.string().uuid();

export const generateInvoiceSchema = z.object({
  facilityId: uuid,
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});
export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;

export const listInvoicesSchema = z.object({
  facilityId: uuid,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: uuid.optional(),
  billedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const invoiceActionSchema = z.object({ id: uuid, facilityId: uuid });
export type InvoiceActionInput = z.infer<typeof invoiceActionSchema>;

/**
 * A payment is recorded with what makes it checkable: the bank's reference, how
 * much arrived, when and from whom. Whether the amount is the invoice's and the
 * date is plausible is the application's to say, so it can say why.
 */
export const recordPaymentSchema = invoiceActionSchema.extend({
  paymentReference: z.string().trim().min(1).max(200),
  amountKobo: z.coerce.number().int().positive(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Write the date as year-month-day.'),
  payerName: z.string().trim().min(1).max(300),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const voidInvoiceSchema = invoiceActionSchema.extend({
  reason: z.string().trim().min(10).max(500),
});

export const preparePayoutSchema = z.object({ practitionerId: uuid });

export const payoutIdSchema = z.object({ id: uuid });

export const myPayoutsSchema = z.object({
  scopeType: z.enum(['SELF', 'PLATFORM']),
  scopeId: uuid.optional(),
});
