import { screenAllPractitioners } from '../modules/practitioners/application/screening';
import { activateEligiblePractitioners } from '../modules/practitioners/application/eligibility';
import { expireRegistrations } from '../modules/practitioners/application/expiry';
import { expireCredentials } from '../modules/credentials/application/expiry';
import { expireStartedRequests } from '../modules/service-requests/application/expiry';
import { purgeExpiredData } from '../modules/audit-compliance/application/retention';
import { sweepUnhonouredAssignments } from '../modules/cancellations-sanctions/application/fault';
import {
  alertShiftsNotCheckedIn,
  sendShiftReminders,
} from '../modules/notifications/application/shift-alerts';
import {
  remindUnapprovedTimesheets,
  warnExpiringCredentials,
} from '../modules/notifications/application/sweeps';
import {
  announceLapsedFacilityLicences,
  warnExpiringFacilityLicences,
} from '../modules/notifications/application/licence-sweeps';
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

export const MINUTES_5 = 5 * 60;
export const MINUTES_15 = 15 * 60;
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
  {
    key: 'shift.reminder_sweep',
    description:
      'Remind each practitioner a few hours before a confirmed shift. Every fifteen minutes; nobody is told twice, and anybody who could not be reached is tried again on the next run.',
    intervalSeconds: MINUTES_15,
  },
  {
    key: 'shift.start_watch',
    description:
      'Tell the practitioner and the facility when nobody has checked in thirty minutes after a shift started, while it can still be saved. Every five minutes so thirty minutes means about thirty minutes. Decides nothing: the sweep after the shift, and a person, own the question of an absence.',
    intervalSeconds: MINUTES_5,
  },
  {
    key: 'credential.expiry_warning_sweep',
    description:
      'Warn a practitioner a month before a verified credential expires, and again in the last week, so a licence does not lapse unnoticed and take their shifts with it. Daily; one message per stage, and anybody who could not be reached is tried again.',
    intervalSeconds: DAILY,
  },
  {
    key: 'facility.licence_sweep',
    description:
      'Tell the people who run a verified facility a month before its licence expires and again in the last week, and once when it has lapsed, so a hospital does not learn of it when its next shift will not publish. Daily; one message per person at each stage for that expiry date, and anybody who could not be reached is tried again. Changes nothing: a lapsed licence already stops publishing, inviting and confirming on its own.',
    intervalSeconds: DAILY,
  },
  {
    key: 'timesheet.approval_reminder_sweep',
    description:
      'Remind a facility about hours waiting for approval after a day and again after three, and tell the practitioner at three days that they are being chased. Hourly. Decides nothing: whether hours are approved, and any deadline after which they are approved for the facility, are not this job\'s to settle.',
    intervalSeconds: HOURLY,
  },
  {
    key: 'retention.purge_sweep',
    description:
      'Delete what the data inventory says is not worth keeping: one-time codes, sessions that have ended, the sign-in log, queue entries already delivered and uploads nobody finished, each on its own period. Daily. Touches nothing else: the rest is kept, or removed by an erasure request. Writes one audit row with counts on a run that deleted anything.',
    intervalSeconds: DAILY,
  },
];

export const jobs: Record<string, JobHandler> = {
  'retention.purge_sweep': async () => {
    await purgeExpiredData();
  },
  'credential.expiry_warning_sweep': async () => {
    await warnExpiringCredentials();
  },
  'facility.licence_sweep': async () => {
    // Both, even if the first could not reach somebody: failing to text one person is no reason
    // to leave the others untold, and the job still fails so the next run tries again.
    const results = await Promise.allSettled([warnExpiringFacilityLicences(), announceLapsedFacilityLicences()]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
  },
  'timesheet.approval_reminder_sweep': async () => {
    await remindUnapprovedTimesheets();
  },
  'shift.reminder_sweep': async () => {
    await sendShiftReminders();
  },
  'shift.start_watch': async () => {
    await alertShiftsNotCheckedIn();
  },
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
