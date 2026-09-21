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

/**
 * What is wrong with a field, as a catalogue key rather than a sentence.
 *
 * This module has no React in it and so has no translator, and handing it one
 * would make the rules a function of the reader's language. So it names the
 * message and the screen renders it, which is the same split the downtime copy
 * uses.
 */
export type FieldErrors = Partial<Record<RegistrationField, string>>;

/**
 * Every message the rules below can produce.
 *
 * A table rather than keys written inline at each assignment, because the drift
 * test that proves every key exists reads `t('...')` calls and `somethingKey:`
 * properties and nothing else. A key it cannot see is a key nobody can find
 * when it breaks.
 */
const VALIDATION = {
  givenKey: 'patients.validation.given',
  familyKey: 'patients.validation.family',
  mrnKey: 'patients.validation.mrn',
  birthDateMissingKey: 'patients.validation.birthDateMissing',
  birthDateFormatKey: 'patients.validation.birthDateFormat',
  birthDateUnrealKey: 'patients.validation.birthDateUnreal',
  birthDateFutureKey: 'patients.validation.birthDateFuture',
  phoneMissingKey: 'patients.validation.phoneMissing',
  phoneShapeKey: 'patients.validation.phoneShape',
  emailShapeKey: 'patients.validation.emailShape',
  emailForPortalKey: 'patients.validation.emailForPortal',
} as const;

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
 * Message keys, keyed by field. The messages themselves say what to do, never
 * just what is wrong, and carry no filler: the person reading them has a
 * patient at the desk.
 */
export function validateRegistration(
  draft: RegistrationDraft,
  asOf: Date = new Date()
): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.given.trim()) errors.given = VALIDATION.givenKey;
  if (!draft.family.trim()) errors.family = VALIDATION.familyKey;
  // Not one of the four required fields, because the form proposes it: this
  // only fires when somebody has cleared the proposal by hand.
  if (!draft.mrn.trim()) errors.mrn = VALIDATION.mrnKey;

  if (!draft.birthDate.trim()) {
    errors.birthDate = VALIDATION.birthDateMissingKey;
  } else if (!ISO_DATE.test(draft.birthDate.trim())) {
    errors.birthDate = VALIDATION.birthDateFormatKey;
  } else {
    const born = new Date(`${draft.birthDate.trim()}T00:00:00.000Z`);
    if (Number.isNaN(born.getTime())) {
      errors.birthDate = VALIDATION.birthDateUnrealKey;
    } else if (born.getTime() > asOf.getTime()) {
      errors.birthDate = VALIDATION.birthDateFutureKey;
    }
  }

  if (!draft.phoneMobile.trim()) {
    errors.phoneMobile = VALIDATION.phoneMissingKey;
  } else if (!PHONE.test(draft.phoneMobile.trim())) {
    errors.phoneMobile = VALIDATION.phoneShapeKey;
  }

  if (draft.email.trim() && !EMAIL.test(draft.email.trim())) {
    errors.email = VALIDATION.emailShapeKey;
  }

  if (draft.portalEnabled && !draft.email.trim()) {
    errors.email = VALIDATION.emailForPortalKey;
  }

  return errors;
}

export interface DuplicateMatch {
  patient: Patient;
  /**
   * Higher is a stronger match. Read against the two bands:
   * {@link CANDIDATE_SCORE} to be shown at all, {@link BLOCKING_SCORE} to hold
   * the save.
   */
  score: number;
  /**
   * Catalogue keys for the plain-language reasons shown next to the candidate,
   * strongest signal last in the order the signals are weighed.
   */
  reasonKeys: string[];
}

/**
 * The lowest score that puts a record in front of the registrar at all.
 *
 * Below it nothing is shown. The candidate list this runs over has already been
 * searched by family name, so one weak signal describes most of the list and
 * showing it would be showing the search back to the person who typed it.
 */
export const CANDIDATE_SCORE = 3;

/**
 * At or above this, the save is blocked until the front desk overrides it.
 *
 * The gap between the two bands is deliberately wide. Offering a record that
 * turns out to be somebody else costs a registrar a glance; holding up somebody
 * standing at the desk costs them their appointment. So this band is reached
 * only by agreement on the given name, the family name and a second fixed
 * identifier, which is a combination relatives do not produce.
 */
export const BLOCKING_SCORE = 8;

/** Trimmed, folded and composed, so a comparison is about letters and nothing else. */
function normalise(value: string): string {
  return value.trim().toLowerCase().normalize('NFC');
}

function same(a: string, b: string): boolean {
  const left = normalise(a);
  return left.length > 0 && left === normalise(b);
}

/**
 * True when one string becomes the other with a single insertion, deletion,
 * substitution or swap of neighbours: a Damerau-Levenshtein distance of one.
 *
 * Bounded rather than measured, because one is the only distance anything here
 * asks about and a bounded answer needs a walk rather than a matrix. Matching
 * characters are consumed from both ends; what is left in the middle is the
 * edit, and the shape of what is left says which edit it was.
 *
 * The lengths are not compared first. The difference between them is exactly
 * the difference between the two remainders, so a gap of two or more leaves a
 * remainder of two or more on one side and fails both tests below on its own.
 * A separate length guard would be a line no test could ever kill.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const aLeft = a.length - head - tail;
  const bLeft = b.length - head - tail;

  /* One insertion, deletion or substitution leaves at most one unmatched
     character on each side of the walk. */
  if (aLeft <= 1 && bLeft <= 1) return true;

  /* A swap of neighbours leaves exactly two on each side, each the other's. */
  return aLeft === 2 && bLeft === 2 && a[head] === b[head + 1] && a[head + 1] === b[head];
}

/** A near miss between two names that are both actually there. */
function nearlySame(a: string, b: string): boolean {
  const left = normalise(a);
  const right = normalise(b);
  return left.length > 0 && right.length > 0 && left !== right && withinOneEdit(left, right);
}

/**
 * How well the draft's given name matches, counting the preferred name.
 *
 * One answer rather than two predicates, because a draft can hold the preferred
 * name exactly and the legal name nearly, and counting both would charge a
 * single agreement twice.
 */
function givenMatch(draft: RegistrationDraft, patient: Patient): 'same' | 'near' | 'none' {
  const known = [patient.name.given, patient.name.preferred ?? ''];
  if (known.some((name) => same(draft.given, name))) return 'same';
  return known.some((name) => nearlySame(draft.given, name)) ? 'near' : 'none';
}

/** The length of a national number, below which there is not enough to compare. */
const NATIONAL_DIGITS = 10;

/**
 * A phone number as the digits that identify the line.
 *
 * Punctuation and spacing carry nothing, and neither does a country code the
 * patient did not say: a desk types what it hears, and "plus one" is rarely
 * part of that. Everything else is left as typed, so two numbers of different
 * lengths stay two different numbers.
 *
 * Only the North American country code is folded, which is the one these
 * numbers carry. A practice dialling internationally wants a fuller
 * normalisation, and it belongs at the API, where the country is known.
 */
function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === NATIONAL_DIGITS + 1 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * Two numbers are the same number when the whole of one equals the whole of the
 * other.
 *
 * Not a shared ending: a seven-digit fragment ends a great many complete
 * numbers, and reading that as agreement named strangers as each other. A value
 * shorter than a national number is not enough of a number to compare, so it
 * agrees with nothing.
 */
function samePhone(a: string, b: string): boolean {
  return a.length >= NATIONAL_DIGITS && a === b;
}

/** One thing that makes two records look like the same person. */
interface DuplicateSignal {
  /** Catalogue key for the reason shown on the candidate, in plain language. */
  readonly reasonKey: string;
  /** What this signal adds to the score. Compared against {@link BLOCKING_SCORE}. */
  readonly weight: number;
  readonly holds: (draft: RegistrationDraft, patient: Patient) => boolean;
}

/**
 * The signals, in the order they are shown, weakest first.
 *
 * The weights say what actually separates one person from another in a list
 * that is already everybody sharing a family name. Inside such a list the
 * family name is the least informative field in it and the given name is the
 * one doing the work, which is why the given name is worth more. A date of
 * birth is a fixed identifier and is worth as much again.
 *
 * A mobile number is worth less than either. Households share a line, siblings
 * are registered against a parent's number, and a practice's own number is
 * given by patients who have no other. So a number in common says two records
 * belong to the same household, and it takes agreement on the name to say they
 * belong to the same person.
 *
 * Names also match when they nearly match, for a smaller amount: one letter
 * typed, dropped, swapped or mistaken is how a name arrives at a desk when it
 * was heard rather than read. Near and exact are mutually exclusive by
 * construction, so one name is only ever counted once.
 *
 * A table rather than a run of `if` blocks, so the reason keys sit next to the
 * weights they justify and the drift test can see every key.
 */
const SIGNALS: readonly DuplicateSignal[] = [
  {
    reasonKey: 'patients.duplicate.similarFamilyName',
    weight: 1,
    holds: (draft, patient) => nearlySame(draft.family, patient.name.family),
  },
  {
    reasonKey: 'patients.duplicate.similarGivenName',
    weight: 1,
    holds: (draft, patient) => givenMatch(draft, patient) === 'near',
  },
  {
    reasonKey: 'patients.duplicate.sameFamilyName',
    weight: 2,
    holds: (draft, patient) => same(draft.family, patient.name.family),
  },
  {
    reasonKey: 'patients.duplicate.samePhone',
    weight: 2,
    holds: (draft, patient) =>
      samePhone(phoneDigits(draft.phoneMobile), phoneDigits(patient.telecom.phoneMobile ?? '')),
  },
  {
    reasonKey: 'patients.duplicate.sameGivenName',
    weight: 3,
    holds: (draft, patient) => givenMatch(draft, patient) === 'same',
  },
  {
    reasonKey: 'patients.duplicate.sameBirthDate',
    weight: 3,
    holds: (draft, patient) =>
      draft.birthDate.trim() !== '' && draft.birthDate.trim() === patient.birthDate,
  },
];

/** Fuzzy duplicate candidates for a draft, strongest first. */
export function findDuplicates(
  draft: RegistrationDraft,
  patients: readonly Patient[],
  limit = 3
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const patient of patients) {
    const hit = SIGNALS.filter((signal) => signal.holds(draft, patient));
    const score = hit.reduce((total, signal) => total + signal.weight, 0);

    if (score > 0) {
      matches.push({ patient, score, reasonKeys: hit.map((signal) => signal.reasonKey) });
    }
  }

  return matches
    .filter((match) => match.score >= CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score || a.patient.name.family.localeCompare(b.patient.name.family))
    .slice(0, limit);
}

/** True when a match is strong enough that saving needs an explicit override. */
export function isBlocking(matches: readonly DuplicateMatch[]): boolean {
  return matches.some((match) => match.score >= BLOCKING_SCORE);
}
