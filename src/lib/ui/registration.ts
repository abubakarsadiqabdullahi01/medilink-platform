/**
 * What a facility is registered under, in the words a person would use (FAC-05).
 *
 * A CAC number was demanded of everybody, and government hospitals and primary
 * health centres - most of the facilities in Gombe - have none.
 */
export type RegistrationKind = 'CAC' | 'GOVERNMENT' | 'OTHER';

export interface RegistrationKindOption {
  value: RegistrationKind;
  label: string;
  /** What to call the number on this kind of registration. */
  referenceLabel: string;
  placeholder: string;
  help: string;
}

export const REGISTRATION_KIND_OPTIONS: RegistrationKindOption[] = [
  {
    value: 'CAC',
    label: 'A company or business registered with the CAC',
    referenceLabel: 'CAC registration number',
    placeholder: 'RC1234567',
    help: 'As it appears on your CAC certificate.',
  },
  {
    value: 'GOVERNMENT',
    label: 'A government hospital or health centre',
    referenceLabel: 'Ministry or state board reference',
    placeholder: 'The code or letter reference you were given',
    help: 'The reference your ministry, state hospitals board or primary health care agency issued. Upload the letter or certificate as your licence document.',
  },
  {
    value: 'OTHER',
    label: 'Another registered body (a mission, an NGO, the military)',
    referenceLabel: 'Registration reference',
    placeholder: 'The number on your registration document',
    help: 'The number on the document that shows you are registered. A compliance officer will check it with whoever issued it.',
  },
];

export function registrationOption(kind: string | undefined): RegistrationKindOption {
  return REGISTRATION_KIND_OPTIONS.find((row) => row.value === kind) ?? REGISTRATION_KIND_OPTIONS[0]!;
}
