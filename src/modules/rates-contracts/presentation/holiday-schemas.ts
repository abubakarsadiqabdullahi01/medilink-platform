import { z } from 'zod';

/** A real calendar date, written YYYY-MM-DD. `2027-02-30` parses as a date in JavaScript and is not one. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Write the date as YYYY-MM-DD.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date is not on the calendar.')
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= 2024 && year <= 2100;
  }, 'Enter a year between 2024 and 2100.');

export const addHolidaySchema = z.object({
  date: calendarDate,
  name: z.string().trim().min(2).max(100),
});

export const listHolidaysSchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100).optional(),
});

export const holidayIdSchema = z.object({ id: z.string().uuid() });
