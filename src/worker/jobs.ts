import { screenAllPractitioners } from '../modules/practitioners/application/screening';
import { activateEligiblePractitioners } from '../modules/practitioners/application/eligibility';
import { expireRegistrations } from '../modules/practitioners/application/expiry';
import { expireCredentials } from '../modules/credentials/application/expiry';
import { expireStartedRequests } from '../modules/service-requests/application/expiry';
import { sweepUnhonouredAssignments } from '../modules/cancellations-sanctions/application/fault';
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

export const JOB_DEFINITIONS: JobDefinition[] = [
  {
    key: 'screening.sweep',
    description:
      'Re-screen every practitioner against the sanctioned and quack lists. Daily, because the list changes: someone struck off in March was not on it in February.',
    intervalSeconds: DAILY,
  },
  {
    key: 'credential.expiry_sweep',
    description:
      'Move VERIFIED credential submissions whose expiry date has passed to EXPIRED. Daily — the eligibility rule already refuses a lapsed credential the moment it lapses; this is what keeps the stored status from still claiming VERIFIED.',
    intervalSeconds: DAILY,
  },
  {
    key: 'registration.expiry_sweep',
    description:
      'Move ACTIVE professional registrations whose licence date has passed to EXPIRED. Daily, same reasoning as the credential sweep.',
    intervalSeconds: DAILY,
  },
  {
    key: 'practitioner.activation_sweep',
    description:
      'Promote UNDER_REVIEW practitioners to ACTIVE once every eligibility requirement is satisfied. Daily: nothing activates an account synchronously, so this is the only thing that does.',
    intervalSeconds: DAILY,
  },
  {
    key: 'service_request.expiry_sweep',
    description:
      'Close published requests whose shift has already started, and withdraw any invitation still awaiting an answer. Hourly, because a stale request keeps appearing in lists and distorts the fill-rate metric.',
    intervalSeconds: HOURLY,
  },
  {
    key: 'assignment.unhonoured_sweep',
    description:
      'Flag CONFIRMED assignments whose shift has ended with no sign of attendance, awaiting a fault decision. Hourly, and it decides nothing: an absence has a dozen innocent explanations and the platform cannot tell them apart from a database row.',
    intervalSeconds: HOURLY,
  },
];

export const jobs: Record<string, JobHandler> = {
  'service_request.expiry_sweep': async () => {
    await expireStartedRequests();
  },
  'assignment.unhonoured_sweep': async () => {
    await sweepUnhonouredAssignments();
  },
  'screening.sweep': async () => {
    await screenAllPractitioners();
  },
  'credential.expiry_sweep': async () => {
    await expireCredentials();
  },
  'registration.expiry_sweep': async () => {
    await expireRegistrations();
  },
  'practitioner.activation_sweep': async () => {
    await activateEligiblePractitioners();
  },
};

export type { JobHandler };
