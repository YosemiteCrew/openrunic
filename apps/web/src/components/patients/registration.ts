import type { AdministrativeGender, Patient, PatientCreateBody, SensitivityClass } from '@/lib/api';

/**
 * Registration rules, with no React in them.
 *
 * Two legacy failures are answered here. It required fields the workflow did
 * not need (Referral Source on a walk-in), so exactly four fields are required
 * and everything else is genuinely optional. And its duplicate check was
 * advisory, so duplicates piled up for years; here a strong match blocks the
 * save until someone says, in as many words, that this is a different person.
 */

export interface RegistrationDraft {
  /**
   * The medical record number the practice is assigning.
   *
   * The API takes an MRN rather than minting one, because which number a
   * patient gets is a practice's decision and is often carried in from a
   * system that came before this one. So the form proposes one and the front
   * desk may overwrite it; a number already in use comes back as a refusal
   * from the server, which is the only place that can know.
   */
  mrn: string;
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
  mrn: '',
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

const MRN_PREFIX = 'OR-';
const MRN_DIGITS = 6;

/**
 * A medical record number to start from.
 *
 * Derived from the clinic clock rather than from the roster, because the roster
 * this screen can see is one page of a search and the next free number is not
 * a question a client can answer. The proposal only has to be plausible and
 * usually free; the organisation-wide uniqueness check belongs to the server,
 * which answers a collision with "That MRN is taken." and does so before
 * anything is written.
 */
export function proposeMrn(asOf: Date): string {
  const minutes = Math.floor(asOf.getTime() / 60_000);
  const suffix = String(minutes % 10 ** MRN_DIGITS).padStart(MRN_DIGITS, '0');
  return `${MRN_PREFIX}${suffix}`;
}

/** Trimmed, or absent. An empty optional field must not be sent as an empty string. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The draft, as the API's registration body.
 *
 * The two shapes differ in more than field names: the form holds every field as
 * a string because that is what an input gives it, and the API rejects an empty
 * string where it expects a missing value. So every optional field is trimmed
 * and dropped rather than sent blank, which is the difference between "no
 * middle name" and "a middle name that is one space".
 */
export function toPatientCreateBody(draft: RegistrationDraft): PatientCreateBody {
  return {
    mrn: draft.mrn.trim(),
    givenName: draft.given.trim(),
    familyName: draft.family.trim(),
    birthDate: draft.birthDate.trim(),
    ...(draft.preferred.trim() ? { preferredName: draft.preferred.trim() } : {}),
    ...(draft.sexAtBirth ? { sexAtBirth: draft.sexAtBirth } : {}),
    ...(optional(draft.pronouns) ? { pronouns: draft.pronouns.trim() } : {}),
    ...(optional(draft.phoneMobile) ? { phoneMobile: draft.phoneMobile.trim() } : {}),
    ...(optional(draft.email) ? { email: draft.email.trim() } : {}),
    ...(optional(draft.line1) ? { line1: draft.line1.trim() } : {}),
    ...(optional(draft.city) ? { city: draft.city.trim() } : {}),
    ...(optional(draft.state) ? { state: draft.state.trim() } : {}),
    ...(optional(draft.postalCode) ? { postalCode: draft.postalCode.trim() } : {}),
    languageCode: draft.languageCode,
    sensitivityClass: draft.sensitivityClass,
    portalEnabled: draft.portalEnabled,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/* Deliberately loose: a phone number that a person can be reached on takes many
   shapes, and rejecting a valid one at the desk is worse than storing an odd one. */
const PHONE = /^[+\d][\d\s()-]{6,}$/;
/* The domain is matched label by label, with the dot excluded from the label
   class. Allowing a label to swallow dots made the split between label and
   separator ambiguous, so an address with no dot after the @ ("a@" plus a long
   run) forced the engine to retry every split: quadratic work on input typed at
   the front desk. Each label being dot-free makes the split forced, and it also
   rejects the empty label in "a@b..c", which the looser pattern accepted. */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

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
  // Not one of the four required fields, because the form proposes it: this
  // only fires when somebody has cleared the proposal by hand.
  if (!draft.mrn.trim()) errors.mrn = 'Enter the medical record number to file this record under.';

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
