import { EVENTS } from '@/lib/events';
import { MAX_SEGMENTS } from './sms-hygiene';

/**
 * Who is told what, by which event, over which channel (M16-02). Pure, no database.
 *
 * Written down once and held to the code from both sides by `notification-matrix.test.ts`:
 * every domain event is either a message below or a stated reason that it sends none, and
 * every message the notifications code names is described here. `docs/notification-matrix.md`
 * is generated from this file for the people who answer "why was nobody told?" and who should
 * not have to read TypeScript to do it.
 *
 * What this is not. It records what the code does today; it does not decide who *should* be told.
 * The two silent events that are decisions about a person are marked, and are the product's and
 * counsel's to settle, not an engineer's to fill in.
 */

type EventKey = keyof typeof EVENTS;

export interface MessageKind {
  /** The `kind` stored on the message, which is also what the once-only check matches. */
  kind: string;
  trigger: { event: EventKey } | { job: string };
  /** Who gets it, in words. */
  to: string;
  /** What makes it go, and what stops it. */
  when: string;
  /** The once-only rule: a redelivered event or a second run of the job sends nothing more. */
  once: string;
  /** What the text may say. Every text goes to a phone anybody may pick up. */
  names: string;
  /** A fragment of source the test looks for when the kind is built rather than written whole. */
  anchor?: string;
}

/** The scheduled jobs that send messages, by their key in `src/worker/jobs.ts`. */
export const JOB_KEYS_WITH_MESSAGES = [
  'shift.reminder_sweep',
  'shift.start_watch',
  'credential.expiry_warning_sweep',
  'facility.licence_sweep',
  'timesheet.approval_reminder_sweep',
] as const;

const PRACTITIONER = 'The practitioner the record is about';
const REPRESENTATIVE = 'The facility’s representative';

export const MESSAGES: MessageKind[] = [
  {
    kind: 'assignment.confirmed',
    trigger: { event: 'AssignmentConfirmed' },
    to: `${PRACTITIONER}, and ${REPRESENTATIVE.toLowerCase()} (one text each)`,
    when: 'A facility confirms a practitioner onto a shift.',
    once: 'Once per person per booking.',
    names: 'The facility’s name and the shift’s window in Lagos time.',
  },
  {
    kind: 'assignment.cancelled',
    trigger: { event: 'AssignmentCancelled' },
    to: PRACTITIONER,
    when: 'A facility releases them from a booking, or cancels the whole shift. The only route that cancels a confirmed booking is the facility\u2019s; a practitioner has no way to withdraw from one, so there is no message for that.',
    once: 'Once per booking.',
    names: 'The facility’s name and the shift’s window. Not the facility’s reason.',
  },
  {
    kind: 'shift.invited',
    trigger: { event: 'ShiftInvited' },
    to: 'The practitioner who is offered the shift',
    when: 'A facility offers a shift. Not if the offer was withdrawn, answered or expired before the worker ran.',
    once: 'Once per offer. An offer reopened later is told again.',
    names: 'The facility’s name, the shift’s window and the hourly rate.',
  },
  {
    kind: 'shift.accepted',
    trigger: { event: 'ShiftAccepted' },
    to: REPRESENTATIVE,
    when: 'A practitioner accepts an offer, which is theirs to confirm.',
    once: 'Once per acceptance.',
    names: 'The shift’s window. Not the practitioner’s name.',
  },
  {
    kind: 'credential.verified',
    trigger: { event: 'CredentialVerified' },
    to: PRACTITIONER,
    when: 'An officer verifies a document.',
    once: 'Once per decision on a submission.',
    names: 'The kind of document. Nothing the officer wrote.',
  },
  {
    kind: 'credential.rejected',
    trigger: { event: 'CredentialRejected' },
    to: PRACTITIONER,
    when: 'An officer does not accept a document.',
    once: 'Once per decision on a submission.',
    names: 'The kind of document. The reason is in the app, behind the sign-in.',
  },
  {
    kind: 'credential.info_requested',
    trigger: { event: 'CredentialInfoRequested' },
    to: PRACTITIONER,
    when: 'An officer asks for more about a document.',
    once: 'Once per request.',
    names: 'The kind of document. What is asked is in the app.',
  },
  {
    kind: 'credential.expired',
    trigger: { event: 'CredentialExpired' },
    to: PRACTITIONER,
    when: 'The expiry sweep lapses a verified document. Offers stop until it is renewed.',
    once: 'Once per lapse of a document.',
    names: 'The kind of document.',
  },
  {
    kind: 'facility.verified',
    trigger: { event: 'FacilityVerified' },
    to: REPRESENTATIVE,
    when: 'An officer verifies the facility, which can then publish shifts.',
    once: 'Once per verification.',
    names: 'The facility’s name.',
  },
  {
    kind: 'suggestion.answered',
    trigger: { event: 'SuggestionAnswered' },
    to: 'The person who sent the suggestion',
    when: 'Triage marks it planned, done or declined.',
    once: 'Once per answer. A second answer is a second text.',
    names: 'Which answer it was. Not the reply’s words, which are in the app.',
  },
  {
    kind: 'timesheet.submitted',
    trigger: { event: 'TimesheetSubmitted' },
    to: `${REPRESENTATIVE}. Whoever holds \`timesheet.approve\` at the facility is told only by the reminders below, a day later.`,
    when: 'A practitioner submits their hours.',
    once: 'Once per submission. A resubmission is a new one.',
    names: 'The shift’s window.',
  },
  {
    kind: 'timesheet.approved',
    trigger: { event: 'TimesheetApproved' },
    to: PRACTITIONER,
    when: 'The facility approves their hours.',
    once: 'Once per shift.',
    names: 'The facility’s name and the shift’s window. No figures.',
  },
  {
    kind: 'timesheet.recalculated',
    trigger: { event: 'TimesheetRecalculated' },
    to: PRACTITIONER,
    when: 'Approval works their sheet out again and the figures changed.',
    once: 'Once per recalculation.',
    names: 'That it happened and the shift as scheduled. No figures.',
  },
  {
    kind: 'timesheet.rejected',
    trigger: { event: 'TimesheetRejected' },
    to: PRACTITIONER,
    when: 'The facility sends their hours back.',
    once: 'Once per rejection.',
    names: 'The facility’s name and the shift’s window. Never the reason the facility gave: that is read on their sheet in the app.',
  },
  {
    kind: 'staff.access_removed',
    trigger: { event: 'StaffAccessRemoved' },
    to: 'The person whose access to a facility was removed',
    when: 'All of somebody’s access to a facility is removed at once. Taking away one role, the ordinary way to remove somebody, sends nothing.',
    once: 'Once per removal; a redelivered event sends nothing more.',
    names: 'The facility’s name. Never why, and never who did it.',
  },
  {
    kind: 'staff.access_removed_owners',
    trigger: { event: 'StaffAccessRemoved' },
    to: 'Everybody else who can add and remove staff at that facility, other than whoever did it',
    when: 'All of somebody’s access to the facility is removed at once.',
    once: 'Once per person per removal; a redelivered event sends nothing more.',
    names: 'The facility’s name. Never who was removed, who did it, or why: the Staff page shows who.',
  },
  {
    kind: 'dispute.opened',
    trigger: { event: 'DisputeOpened' },
    to: 'The other side of the case, and everyone who holds `dispute.manage` across the platform. Not the person who opened it.',
    when: 'A dispute is opened over a shift.',
    once: 'Once per person per case.',
    names: 'The shift’s window. Never the reason argued.',
  },
  {
    kind: 'dispute.under_review',
    trigger: { event: 'DisputeUnderReview' },
    to: 'Both sides of the case',
    when: 'An officer starts reviewing it.',
    once: 'Once per person per case.',
    names: 'The shift. Not what was argued or the officer’s notes.',
  },
  {
    kind: 'dispute.resolved',
    trigger: { event: 'DisputeResolved' },
    to: 'Both sides of the case',
    when: 'An officer decides it.',
    once: 'Once per person per case.',
    names: 'The outcome, and a pointer to the reasons, which are in the app.',
  },
  {
    kind: 'dispute.withdrawn',
    trigger: { event: 'DisputeWithdrawn' },
    to: 'The other side of the case',
    when: 'The person who opened it withdraws it.',
    once: 'Once per case.',
    names: 'The shift. Not why.',
  },
  {
    kind: 'incident.severe',
    trigger: { event: 'ClinicalIncidentReported' },
    to: 'Everyone who holds `incident.manage` across the platform. If nobody does, the event fails and stays visible rather than looking handled.',
    when: 'An incident is reported as severe or fatal. Other severities send nothing and wait in the queue.',
    once: 'Once per person per incident.',
    names: 'The facility’s name and the severity. No summary, no patient, no practitioner.',
  },
  {
    kind: 'invoice.issued',
    trigger: { event: 'InvoiceIssued' },
    to: 'Everyone who holds `invoice.read` at the facility',
    when: 'An administrator issues an invoice.',
    once: 'Once per person per invoice.',
    names: 'The invoice number, the amount and the facility’s name.',
  },
  {
    kind: 'payout.settled',
    trigger: { event: 'PayoutSettled' },
    to: PRACTITIONER,
    when: 'A payout is settled to their account.',
    once: 'Once per payout.',
    names: 'The amount and, when there is one, the bank’s reference.',
  },
  {
    kind: 'payout_account.submitted',
    trigger: { event: 'PayoutAccountSubmitted' },
    to: `${PRACTITIONER}, as a security notice: if they did not add the account they are told to say so at once`,
    when: 'A bank account is added for their pay.',
    once: 'Once per account.',
    names: 'The bank and the last four digits.',
  },
  {
    kind: 'payout_account.reviewed',
    trigger: { event: 'PayoutAccountReviewed' },
    to: PRACTITIONER,
    when: 'Finance accepts or refuses the account.',
    once: 'Once per account.',
    names: 'Whether it was accepted, and the last four digits.',
  },
  {
    kind: 'shift.reminder',
    trigger: { job: 'shift.reminder_sweep' },
    to: PRACTITIONER,
    when: 'A confirmed shift starts within three hours. Not for a booking made within the last hour, which has just been confirmed.',
    once: 'Once per booking.',
    names: 'The facility’s name and the shift’s window.',
  },
  {
    kind: 'shift.not_checked_in',
    trigger: { job: 'shift.start_watch' },
    to: `${PRACTITIONER}, and ${REPRESENTATIVE.toLowerCase()} (one text each)`,
    when: 'Nobody has checked in thirty minutes after the start and the shift is still running. Nothing is marked and nothing is decided.',
    once: 'Once per person per booking.',
    names: 'The facility’s name and the shift’s window. The facility is told the practitioner by initials only.',
  },
  {
    kind: 'credential.expiry_warning_30',
    trigger: { job: 'credential.expiry_warning_sweep' },
    to: PRACTITIONER,
    when: 'A verified document expires within thirty days. Not if a later one of the same kind is already verified.',
    once: 'Once per document.',
    names: 'The kind of document and its expiry date.',
  },
  {
    kind: 'credential.expiry_warning_7',
    trigger: { job: 'credential.expiry_warning_sweep' },
    to: PRACTITIONER,
    when: 'The same document, within seven days.',
    once: 'Once per document.',
    names: 'The kind of document and its expiry date.',
  },
  {
    kind: 'facility.licence_expiry_warning_30',
    trigger: { job: 'facility.licence_sweep' },
    to: `${REPRESENTATIVE}, and everyone who holds \`facility.write\` there`,
    when: 'A verified facility’s licence expires within thirty days.',
    once: 'Once per person per expiry date.',
    names: 'The facility’s name and the expiry date.',
  },
  {
    kind: 'facility.licence_expiry_warning_7',
    trigger: { job: 'facility.licence_sweep' },
    to: `${REPRESENTATIVE}, and everyone who holds \`facility.write\` there`,
    when: 'The same licence, within seven days.',
    once: 'Once per person per expiry date.',
    names: 'The facility’s name and the expiry date.',
  },
  {
    kind: 'facility.licence_expired',
    trigger: { job: 'facility.licence_sweep' },
    to: `${REPRESENTATIVE}, and everyone who holds \`facility.write\` there`,
    when: 'The licence has lapsed, for fourteen days after it does.',
    once: 'Once per person per expiry date.',
    names: 'The facility’s name and the expiry date.',
  },
  {
    kind: 'timesheet.reminder_24h',
    trigger: { job: 'timesheet.approval_reminder_sweep' },
    to: 'Everyone who holds `timesheet.approve` at the facility',
    when: 'Submitted hours have waited a day.',
    once: 'Once per person per shift.',
    names: 'The facility’s name, the shift’s window and how many days.',
    anchor: 'timesheet.reminder_${stage}',
  },
  {
    kind: 'timesheet.reminder_72h',
    trigger: { job: 'timesheet.approval_reminder_sweep' },
    to: 'Everyone who holds `timesheet.approve` at the facility',
    when: 'Submitted hours have waited three days.',
    once: 'Once per person per shift.',
    names: 'The facility’s name, the shift’s window and how many days.',
    anchor: 'timesheet.reminder_${stage}',
  },
  {
    kind: 'timesheet.waiting',
    trigger: { job: 'timesheet.approval_reminder_sweep' },
    to: PRACTITIONER,
    when: 'Their hours have waited three days: they are told the facility has been reminded.',
    once: 'Once per shift.',
    names: 'The facility’s name, the shift’s window and how many days.',
  },
];

/**
 * What each domain event does about telling anybody.
 *
 * `silent` is a statement, not a gap: it says why nobody is told. `decision` marks the ones where
 * silence is itself a decision about a person that somebody other than an engineer should make.
 * `handlerDoes` is for an event whose handler works but sends nothing.
 */
export type EventCoverage =
  | { kinds: string[]; handlerDoes?: string }
  | { silent: string; handlerDoes?: string; decision?: string; notPublished?: boolean };

export const EVENT_COVERAGE: Record<EventKey, EventCoverage> = {
  PractitionerRegistered: {
    silent:
      'The sign-up request sent the one-time code already, and a welcome text would say nothing the practitioner needs.',
    handlerDoes: 'Grants the practitioner role and screens the name against the sanctions list.',
  },
  CredentialSubmitted: {
    silent:
      'Officers work a queue with counts on their dashboard; a text for every upload would bury the ones that matter.',
  },
  CredentialVerified: { kinds: ['credential.verified'] },
  CredentialRejected: { kinds: ['credential.rejected'] },
  CredentialInfoRequested: { kinds: ['credential.info_requested'] },
  CredentialExpired: { kinds: ['credential.expired'] },
  FacilityVerified: { kinds: ['facility.verified'] },
  ServiceRequestPublished: {
    silent:
      'Practitioners are told when a facility offers them a shift (`shift.invited`), not when a request is published: there is no broadcast.',
  },
  ShiftInvited: { kinds: ['shift.invited'] },
  ShiftAccepted: { kinds: ['shift.accepted'] },
  AssignmentConfirmed: { kinds: ['assignment.confirmed'] },
  AssignmentCancelled: { kinds: ['assignment.cancelled'] },
  ShiftStarted: {
    silent: 'The shift starting is what everybody expected; the not-checked-in watch covers the case where it did not.',
  },
  ShiftCompleted: {
    silent: 'Nobody needs telling that a shift ended; the timesheet appears in the practitioner’s list.',
    handlerDoes: 'Works out the timesheet from the attendance record, so there is a card to submit.',
  },
  TimesheetSubmitted: { kinds: ['timesheet.submitted'] },
  TimesheetApproved: {
    kinds: ['timesheet.approved'],
    handlerDoes: 'Completes the assignment first, so a failure to tell anyone cannot leave an approved shift unfinished.',
  },
  TimesheetRejected: { kinds: ['timesheet.rejected'] },
  TimesheetRecalculated: { kinds: ['timesheet.recalculated'] },
  InvoiceCreated: {
    silent: 'A draft is the administrator’s working copy and nobody else has seen it; issuing it is what tells the facility.',
  },
  InvoiceIssued: { kinds: ['invoice.issued'] },
  PaymentCompleted: {
    silent:
      'Recording that a facility paid tells nobody: the facility made the payment and the practitioner is told when their own payout settles.',
  },
  PayoutSettled: { kinds: ['payout.settled'] },
  PayoutAccountSubmitted: { kinds: ['payout_account.submitted'] },
  PayoutAccountReviewed: { kinds: ['payout_account.reviewed'] },
  NoShowRecorded: {
    silent:
      'Nobody is told. A practitioner recorded as a no-show learns it only by finding the status in the app, and nothing yet says whether they should be told, by whom, or with what reason.',
    decision:
      'Whether and how a practitioner is told they were recorded as a no-show, and what they may answer. Operations, with D05 (missed check-ins).',
  },
  SanctionApplied: {
    silent:
      'Nobody is told. A practitioner flagged by the sanctions screening stops being offered shifts without a word; officers see the flag in a queue.',
    decision:
      'Whether the person is told they were flagged, in what words and by what channel. A text to a phone anybody may pick up about a regulator’s list is a decision for compliance and counsel (D10).',
  },
  DisputeOpened: { kinds: ['dispute.opened'] },
  DisputeUnderReview: { kinds: ['dispute.under_review'] },
  DisputeResolved: { kinds: ['dispute.resolved'] },
  DisputeWithdrawn: { kinds: ['dispute.withdrawn'] },
  ClinicalIncidentReported: { kinds: ['incident.severe'] },
  SuggestionAnswered: { kinds: ['suggestion.answered'] },
  StaffAccessRemoved: { kinds: ['staff.access_removed', 'staff.access_removed_owners'] },
};

const TRIGGER_LABEL = (trigger: MessageKind['trigger']): string =>
  'event' in trigger ? `\`${EVENTS[trigger.event]}\`` : `job \`${trigger.job}\``;

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The Markdown support reads. `docs/notification-matrix.md` is exactly this. */
export function renderMatrix(): string {
  const eventNames = Object.keys(EVENTS) as EventKey[];
  const silent = eventNames.filter((name) => 'silent' in EVENT_COVERAGE[name]);
  const decisions = silent.filter((name) => 'decision' in EVENT_COVERAGE[name]);

  const lines: string[] = [
    '# Who is told what',
    '',
    'Generated from `src/modules/notifications/domain/notification-matrix.ts` by `pnpm tsx scripts/render-notification-matrix.ts`. Do not edit this file by hand: change that one, and a test fails until this is regenerated.',
    '',
    'It answers “why was nobody told?” for each thing the platform does. A test holds it to the code from both sides: every domain event is either a message below or a stated reason that it sends none, and every message the code can send is described here.',
    '',
    '## How a message goes',
    '',
    '- **One channel today: SMS.** Every message is also kept as a row in the person’s in-app inbox, which is the same text and is what the bell shows. There is no email, push or WhatsApp (`NOT-09`) and no preference to switch a message off (`NOT-08`): every message below is sent to everyone it names.',
    '- **A text that does not go is retried.** An event’s handler throws when a text failed, after trying everybody, so the outbox retries the event with backoff and parks it as a dead letter an operator can see. A scheduled job fails the same way and its next run reaches whoever was missed. A second gateway takes over when the first fails, if one is configured.',
    '- **Once is once.** Each message is checked against what the person has already been sent before it goes, so a redelivered event or a second run of a job sends nothing more.',
    '- **Names, not arguments.** Every text goes to a phone anybody may pick up, so none carries a patient, a clinical summary, a person’s full name where initials do, or what was argued in a dispute.',
    `- **Plain characters, at most ${MAX_SEGMENTS} segments.** A text in the GSM alphabet is 160 characters to a segment; one character outside it (a curly apostrophe, an ellipsis, the naira sign) makes the whole text UCS-2 at 70, which more than doubles what it costs. The templates write "NGN" and "...", and punctuation typed on a phone, in a hospital's name for instance, is made plain at the one place every text is sent. A letter a name needs, such as Ọ or ṣ, is kept as it is and costs more. A text of more than ${MAX_SEGMENTS} segments, a time without WAT, an email address, a phone number or a run of nine digits fails a test (\`sms-hygiene.ts\`), and the integration tests hold every text they cause to be stored to it.`,
    '- **Sign-in and reset codes are not in this table.** They are sent by the request that asks for them, by SMS only, and are not kept in the inbox.',
    '',
    '## Messages',
    '',
    '| Message | Sent when | To | Once | The text may name | Sent by |',
    '| --- | --- | --- | --- | --- | --- |',
    ...MESSAGES.map(
      (message) =>
        `| \`${message.kind}\` | ${cell(message.when)} | ${cell(message.to)} | ${cell(message.once)} | ${cell(message.names)} | ${TRIGGER_LABEL(message.trigger)} |`,
    ),
    '',
    '## Every domain event',
    '',
    '| Event | Tells | Note |',
    '| --- | --- | --- |',
    ...eventNames.map((name) => {
      const coverage = EVENT_COVERAGE[name];
      const event = `\`${EVENTS[name]}\``;
      if ('kinds' in coverage) {
        return `| ${event} | ${coverage.kinds.map((kind) => `\`${kind}\``).join(', ')} | ${cell(coverage.handlerDoes ?? '')} |`;
      }
      const note = [coverage.silent, coverage.handlerDoes ? `The handler: ${coverage.handlerDoes}` : '']
        .filter(Boolean)
        .join(' ');
      return `| ${event} | Nobody | ${cell(note)} |`;
    }),
    '',
    '## Silent by design, and silent awaiting a decision',
    '',
    `${silent.length - decisions.length} of the ${silent.length} silent events are silent on purpose: the reason is in the note above. ${decisions.length} are silent because nobody has decided what should happen, and each of those is a decision about a person:`,
    '',
    ...decisions.flatMap((name) => {
      const coverage = EVENT_COVERAGE[name];
      return 'decision' in coverage ? [`- \`${EVENTS[name]}\`: ${coverage.decision}`] : [];
    }),
    '',
  ];
  return lines.join('\n');
}
