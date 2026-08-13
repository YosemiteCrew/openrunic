import type { AdministrativeGender, Patient, SensitivityClass } from '@/lib/api';

/**
 * Registration rules, with no React in them.
 *
 * Two OpenEMR failures are answered here. It required fields the workflow did
 * not need (Referral Source on a walk-in), so exactly four fields are required
 * and everything else is genuinely optional. And its duplicate check was
 * advisory, so duplicates piled up for years; here a strong match blocks the
 * save until someone says, in as many words, that this is a different person.
 */

export interface RegistrationDraft {
  given: string;
  family: string;
  preferred: string;
  /** `YYYY-MM-DD`. */
  birthDate: string;
  sexAtBirth: AdministrativeGender | '';
  pronouns: string;
  phoneMobile: string;
  email: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  languageCode: string;
  portalEnabled: boolean;
  sensitivityClass: SensitivityClass;
}

export const EMPTY_DRAFT: RegistrationDraft = {
  given: '',
  family: '',
  preferred: '',
  birthDate: '',
  sexAtBirth: '',
  pronouns: '',
  phoneMobile: '',
  email: '',
  line1: '',
  city: '',
  state: '',
  postalCode: '',
  languageCode: 'en-US',
  portalEnabled: false,
  sensitivityClass: 'NORMAL',
};

export type RegistrationField = keyof RegistrationDraft;

export type FieldErrors = Partial<Record<RegistrationField, string>>;

/** The four fields that make a record bookable. Nothing else blocks a save. */
export const REQUIRED_FIELDS: readonly RegistrationField[] = [
  'given',
  'family',
  'birthDate',
  'phoneMobile',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/* Deliberately loose: a phone number that a person can be reached on takes many
   shapes, and rejecting a valid one at the desk is worse than storing an odd one. */
const PHONE = /^[+\d][\d\s()-]{6,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Errors keyed by field. Messages say what to do, never just what is wrong, and
 * carry no filler: the person reading them has a patient at the desk.
 */
export function validateRegistration(
  draft: RegistrationDraft,
  asOf: Date = new Date()
): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.given.trim()) errors.given = 'Enter the given name.';
  if (!draft.family.trim()) errors.family = 'Enter the family name.';

  if (!draft.birthDate.trim()) {
    errors.birthDate = 'Enter the date of birth as YYYY-MM-DD.';
  } else if (!ISO_DATE.test(draft.birthDate.trim())) {
    errors.birthDate = 'Use the format YYYY-MM-DD, for example 1987-03-14.';
  } else {
    const born = new Date(`${draft.birthDate.trim()}T00:00:00.000Z`);
    if (Number.isNaN(born.getTime())) {
      errors.birthDate = 'That is not a real date. Check the day and month.';
    } else if (born.getTime() > asOf.getTime()) {
      errors.birthDate = 'The date of birth is in the future. Check the year.';
    }
  }

  if (!draft.phoneMobile.trim()) {
    errors.phoneMobile = 'Enter a contact number. The practice needs one way to reach the patient.';
  } else if (!PHONE.test(draft.phoneMobile.trim())) {
    errors.phoneMobile = 'Enter digits only, with an optional country code.';
  }

  if (draft.email.trim() && !EMAIL.test(draft.email.trim())) {
    errors.email = 'Check the email address; it is missing an @ or a domain.';
  }

  if (draft.portalEnabled && !draft.email.trim()) {
    errors.email = 'Portal access needs an email address to send the invitation to.';
  }

  return errors;
}

export interface DuplicateMatch {
  patient: Patient;
  /** Higher is a stronger match. Compared against {@link BLOCKING_SCORE}. */
  score: number;
  /** Plain-language reasons, shown next to the candidate. */
  reasons: string[];
}

/** At or above this, the save is blocked until the front desk overrides it. */
export const BLOCKING_SCORE = 5;

function same(a: string, b: string): boolean {
  return a.trim().length > 0 && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Ignores punctuation and spacing so "+1 555 0142 118" matches "555 0142 118". */
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Two numbers belong to the same person when one ends with the other, which
 * makes the country code optional. A front desk types the number the patient
 * says, and the patient rarely says "plus one".
 */
function samePhone(a: string, b: string): boolean {
  if (a.length < 7 || b.length < 7) return false;
  return a.endsWith(b) || b.endsWith(a);
}

/**
 * Fuzzy duplicate candidates for a draft, strongest first.
 *
 * The weights encode what actually identifies a person at a front desk: a date
 * of birth is worth more than a family name, and a phone number that already
 * exists in the practice is the single strongest signal.
 */
export function findDuplicates(
  draft: RegistrationDraft,
  patients: readonly Patient[],
  limit = 3
): DuplicateMatch[] {
  const draftPhone = digits(draft.phoneMobile);

  const matches: DuplicateMatch[] = [];
  for (const patient of patients) {
    const reasons: string[] = [];
    let score = 0;

    if (same(draft.family, patient.name.family)) {
      score += 2;
      reasons.push('Same family name');
    }
    if (same(draft.given, patient.name.given) || same(draft.given, patient.name.preferred ?? '')) {
      score += 2;
      reasons.push('Same given name');
    }
    if (draft.birthDate.trim() && draft.birthDate.trim() === patient.birthDate) {
      score += 3;
      reasons.push('Same date of birth');
    }
    if (samePhone(draftPhone, digits(patient.telecom.phoneMobile ?? ''))) {
      // On its own this blocks: two people do not share a mobile number by chance.
      score += 5;
      reasons.push('Same mobile number');
    }

    if (score > 0) matches.push({ patient, score, reasons });
  }

  return matches
    .filter((match) => match.score >= 3)
    .sort((a, b) => b.score - a.score || a.patient.name.family.localeCompare(b.patient.name.family))
    .slice(0, limit);
}

/** True when a match is strong enough that saving needs an explicit override. */
export function isBlocking(matches: readonly DuplicateMatch[]): boolean {
  return matches.some((match) => match.score >= BLOCKING_SCORE);
}
