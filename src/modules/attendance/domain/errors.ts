import { HttpError } from '@/lib/http/errors';

export class AttendanceError extends HttpError {}

export const AttendanceErrors = {
  assignmentNotFound: () =>
    new AttendanceError('assignment_not_found', 'That assignment does not exist.', 404),

  recordNotFound: () =>
    new AttendanceError('attendance_not_found', 'That shift has no attendance record.', 404),

  assignmentNotConfirmed: () =>
    new AttendanceError(
      'assignment_not_confirmed',
      'Attendance can only be recorded against a confirmed assignment.',
      409,
    ),

  illegalTransition: (from: string, to: string) =>
    new AttendanceError(
      'illegal_attendance_transition',
      `Attendance cannot move from ${from} to ${to}.`,
      409,
    ),

  tokenInvalid: (reason: string) =>
    new AttendanceError('check_in_token_invalid', `That code is not usable: ${reason}.`, 422),

  /**
   * Step 7.3's whole point: a manual record with no reason is one nobody can
   * evaluate months later, and manual records are exactly the ones a dispute
   * turns on.
   */
  manualReasonRequired: () =>
    new AttendanceError(
      'manual_reason_required',
      'Say why this shift is being recorded by hand.',
      422,
    ),

  checkoutBeforeCheckIn: () =>
    new AttendanceError('checkout_before_checkin', 'A shift must end after it starts.', 422),

  notCheckedIn: () =>
    new AttendanceError('not_checked_in', 'That shift has not been checked in.', 409),

  reviewNotesRequired: () =>
    new AttendanceError(
      'review_notes_required',
      'Say why the timesheet is being rejected.',
      422,
    ),

  correctionReasonRequired: () =>
    new AttendanceError('correction_reason_required', 'Say why this record is being corrected.', 422),

  noTimesheet: () =>
    new AttendanceError('no_timesheet', 'That shift has no timesheet to submit yet.', 409),
} as const;
