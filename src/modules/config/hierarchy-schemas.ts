import { z } from 'zod';

const uuid = z.string().uuid();

/** Shape only: what makes a name or a rank acceptable is the application's to say, so it can say why. */
export const createLevelSchema = z.object({
  professionalCategoryId: uuid,
  name: z.string().trim().min(1).max(200),
  rank: z.coerce.number(),
});

export const createRegistrationCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  supervisionRequired: z.boolean().default(false),
});

export const setActiveSchema = z.object({ id: uuid, active: z.boolean() });

export const listSchema = z.object({});
