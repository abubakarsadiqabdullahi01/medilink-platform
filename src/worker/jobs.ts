import type { JobHandler } from './scheduler';

/**
 * Scheduled jobs, registered by key.
 *
 * A definition and a handler are two halves of the same thing: the definition
 * is what the seed writes into audit.scheduled_jobs, the handler is what runs.
 * A test asserts the two lists match exactly — a definition with no handler is
 * a sweep that silently never happens, and a handler with no definition is
 * code that never runs.
 *
 * Handlers must be idempotent and safe to skip: `claimDueJobs` moves the next
 * run to `now() + interval` rather than catching up missed windows, so a
 * sweep that was down for an hour resumes rather than running sixty times.
 */
export interface JobDefinition {
  key: string;
  description: string;
  intervalSeconds: number;
}

export const HOURLY = 60 * 60;
export const DAILY = 24 * HOURLY;

export const JOB_DEFINITIONS: JobDefinition[] = [];

export const jobs: Record<string, JobHandler> = {};

export type { JobHandler };
