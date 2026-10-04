import { z } from 'zod';
import {
  SUGGESTION_BODY_MAX_LENGTH,
  SUGGESTION_BODY_MIN_LENGTH,
} from '../domain/suggestion';

const uuid = z.string().uuid();
const area = z.enum([
  'ONBOARDING',
  'CREDENTIALS',
  'MATCHING',
  'SCHEDULING',
  'ATTENDANCE',
  'TIMESHEETS',
  'PAYMENTS',
  'SUPPORT',
  'OTHER',
]);

export const submitSuggestionSchema = z.object({
  area,
  body: z.string().trim().min(SUGGESTION_BODY_MIN_LENGTH).max(SUGGESTION_BODY_MAX_LENGTH),
});
export type SubmitSuggestionInput = z.infer<typeof submitSuggestionSchema>;

export const listSuggestionsSchema = z.object({
  status: z.enum(['NEW', 'TRIAGED', 'PLANNED', 'DONE', 'DECLINED']).optional(),
  area: area.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: uuid.optional(),
});

export const triageSuggestionSchema = z.object({
  id: uuid,
  status: z.enum(['TRIAGED', 'PLANNED', 'DONE', 'DECLINED']),
  response: z.string().trim().max(SUGGESTION_BODY_MAX_LENGTH).optional(),
});
export type TriageSuggestionInput = z.infer<typeof triageSuggestionSchema>;

export const emptyQuerySchema = z.object({});
