import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import {
  BLOCKING_SCORE,
  CANDIDATE_SCORE,
  EMPTY_DRAFT,
  findDuplicates,
  isBlocking,
  withinOneEdit,
} from '@/components/patients';
import type { RegistrationDraft } from '@/components/patients';
import type { Patient } from '@/lib/api';

/**
 * What the duplicate check decides, one registration at a time.
 *
 * The table is the point. Each row is a person arriving at a desk and the
 * record already in the practice that they might be, and the assertion is the
 * outcome the registrar sees: nothing, a record offered for comparison, or a
 * save held until somebody states that this is a different person. Scoring is
 * a means to those three, so the rows assert the outcome and the reasons
 * rather than the arithmetic, which is free to change underneath them.
 *
 * The fixtures are written here rather than taken from `MOCK_PATIENTS`,
 * because these rows need families, shared lines and near-miss spellings that
 * the demo roster deliberately does not contain.
 */

const t = createTranslator(appCatalogue, 'en');

type Outcome = 'none' | 'review' | 'block';

function patient(seed: {
  id: string;
  given: string;
  family: string;
  preferred?: string;
  birthDate: string;
  phoneMobile?: string;
}): Patient {
  return {
    id: seed.id,
    mrn: `OR-${seed.id}`,
    name: {
      use: 'official',
      given: seed.given,
      family: seed.family,
      preferred: seed.preferred ?? null,
    },
    birthDate: seed.birthDate,
    telecom: {
      phoneMobile: seed.phoneMobile ?? null,
      phoneHome: null,
      email: null,
    },
  } as unknown as Patient;
}

/* One household on one mobile number, which is the case that used to be read
   as one person registered twice. */
const HOUSEHOLD_LINE = '+1 555 0142 118';

const PARENT = patient({
  id: '100001',
  given: 'Dana',
  family: 'Patientsson',
  birthDate: '1987-03-14',
  phoneMobile: HOUSEHOLD_LINE,
});

const FIRST_CHILD = patient({
  id: '100002',
  given: 'Ari',
  family: 'Patientsson',
  birthDate: '2018-09-02',
  phoneMobile: HOUSEHOLD_LINE,
});

const TWIN = patient({
  id: '100003',
  given: 'Mia',
  family: 'Patientsson',
  birthDate: '2018-09-02',
  phoneMobile: HOUSEHOLD_LINE,
});

const NULLSSON = patient({
  id: '100004',
  given: 'Exampla',
  family: 'Nullsson',
  birthDate: '1974-02-11',
  phoneMobile: '+1 555 0142 204',
});

const PREFERRED = patient({
  id: '100005',
  given: 'Testina',
  family: 'Patientsson',
  preferred: 'Tess',
  birthDate: '1991-06-30',
  phoneMobile: '+1 555 0142 900',
});

/* Recorded with the country code the practice was given, which is longer than
   a national number and merely ends the same way as one. */
const OVERSEAS = patient({
  id: '100006',
  given: 'Ingrid',
  family: 'Patientsson',
  birthDate: '1966-04-21',
  phoneMobile: '+49 30 5550142777',
});

/* Held with the accent as a single character, which is one of the two ways a
   keyboard can produce it. */
const ACCENTED = patient({
  id: '100007',
  given: 'Jos\u00e9',
  family: 'Fakeley',
  birthDate: '1980-12-05',
});

const ROSTER: readonly Patient[] = [
  PARENT,
  FIRST_CHILD,
  TWIN,
  NULLSSON,
  PREFERRED,
  OVERSEAS,
  ACCENTED,
];

function draft(overrides: Partial<RegistrationDraft>): RegistrationDraft {
  return { ...EMPTY_DRAFT, ...overrides };
}

/** The outcome as the screen reads it: the panel, and whether the save waits. */
function outcomeFor(over: Partial<RegistrationDraft>): {
  outcome: Outcome;
  reasons: string[];
  match: string | undefined;
} {
  const matches = findDuplicates(draft(over), ROSTER);
  const top = matches[0];
  return {
    outcome: matches.length === 0 ? 'none' : isBlocking(matches) ? 'block' : 'review',
    reasons: top?.reasonKeys.map((key) => t(key)) ?? [],
    match: top?.patient.mrn,
  };
}

interface Row {
  readonly name: string;
  readonly draft: Partial<RegistrationDraft>;
  readonly outcome: Outcome;
  /** Reasons that must be named on the strongest candidate. */
  readonly reasons?: readonly string[];
  /** The record the registrar is shown first, when there is one. */
  readonly match?: string;
}

const ROWS: readonly Row[] = [
  {
    name: 'a second child registered against the number the first was registered on',
    draft: {
      given: 'Sam',
      family: 'Patientsson',
      birthDate: '2021-05-02',
      phoneMobile: HOUSEHOLD_LINE,
    },
    outcome: 'review',
    reasons: ['Same family name', 'Same mobile number'],
  },
  {
    name: 'twins, who share a family name, a date of birth and the household line',
    draft: {
      given: 'Ava',
      family: 'Patientsson',
      birthDate: '2018-09-02',
      phoneMobile: HOUSEHOLD_LINE,
    },
    outcome: 'review',
    reasons: ['Same family name', 'Same mobile number', 'Same date of birth'],
  },
  {
    name: 'a name heard rather than read, with the date of birth agreeing',
    draft: { given: 'Exampl', family: 'Nullssen', birthDate: '1974-02-11' },
    outcome: 'review',
    match: 'OR-100004',
    reasons: ['Family name one letter apart', 'Given name one letter apart', 'Same date of birth'],
  },
  {
    name: 'two neighbouring letters swapped, which is one edit and not two',
    draft: { given: 'Exampla', family: 'Nullssno', birthDate: '1974-02-11' },
    outcome: 'review',
    match: 'OR-100004',
    reasons: ['Family name one letter apart', 'Same given name', 'Same date of birth'],
  },
  {
    name: 'the same person, typed the same way, arriving a second time',
    draft: {
      given: 'Exampla',
      family: 'Nullsson',
      birthDate: '1974-02-11',
      phoneMobile: '+1 555 0142 204',
    },
    outcome: 'block',
    match: 'OR-100004',
  },
  {
    name: 'the same person with one letter wrong in the given name',
    draft: {
      given: 'Exampli',
      family: 'Nullsson',
      birthDate: '1974-02-11',
      phoneMobile: '555 0142 204',
    },
    outcome: 'block',
    match: 'OR-100004',
  },
  {
    name: 'the preferred name the desk is actually told, with the date of birth',
    draft: { given: 'Tess', family: 'Patientsson', birthDate: '1991-06-30' },
    outcome: 'block',
    match: 'OR-100005',
    reasons: ['Same family name', 'Same given name', 'Same date of birth'],
  },
  {
    name: 'a name left in whatever case the keyboard was in',
    draft: {
      given: 'EXAMPLA',
      family: 'nullsson',
      birthDate: '1974-02-11',
      phoneMobile: '+1 555 0142 204',
    },
    outcome: 'block',
    match: 'OR-100004',
    reasons: ['Same family name', 'Same given name', 'Same date of birth'],
  },
  {
    name: 'an accent typed as a letter and a mark rather than as one character',
    draft: { given: 'Jose\u0301', family: 'Fakeley', birthDate: '1980-12-05' },
    outcome: 'block',
    match: 'OR-100007',
    reasons: ['Same family name', 'Same given name', 'Same date of birth'],
  },
  {
    name: 'two different people who share a family name and a town',
    draft: {
      given: 'Fictitia',
      family: 'Nullsson',
      birthDate: '1991-08-03',
      phoneMobile: '+1 555 0199 777',
      city: 'Cedar Falls',
    },
    outcome: 'none',
  },
  {
    name: 'a fragment of a number, sharing a family name with the record it ends',
    draft: {
      given: 'Rowan',
      family: 'Patientsson',
      birthDate: '1955-01-01',
      phoneMobile: '0142118',
    },
    outcome: 'none',
  },
  {
    name: 'a national number that merely ends a longer one held under another code',
    draft: {
      given: 'Rowan',
      family: 'Patientsson',
      birthDate: '1955-01-01',
      phoneMobile: '5550142777',
    },
    outcome: 'none',
  },
  {
    name: 'a number that agrees but for its last digit, under a shared family name',
    draft: {
      given: 'Rowan',
      family: 'Patientsson',
      birthDate: '1955-01-01',
      phoneMobile: '+1 555 0142 119',
    },
    outcome: 'none',
  },
  {
    name: 'the household line written without the country code the patient never says',
    draft: {
      given: 'Sam',
      family: 'Patientsson',
      birthDate: '2021-05-02',
      phoneMobile: '5550142118',
    },
    outcome: 'review',
    reasons: ['Same family name', 'Same mobile number'],
  },
  {
    name: 'somebody new, reached on a number the practice already holds',
    draft: {
      given: 'Verifia',
      family: 'Assertson',
      birthDate: '1991-02-17',
      phoneMobile: '+1 555 0142 900',
    },
    outcome: 'none',
  },
];

describe('what the duplicate check decides, row by row', () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const seen = outcomeFor(row.draft);
      expect(seen.outcome).toBe(row.outcome);
      if (row.match !== undefined) expect(seen.match).toBe(row.match);
      for (const reason of row.reasons ?? []) expect(seen.reasons).toContain(reason);
      /* Words, not keys: an unknown key renders as itself and would read as a
         reason on the panel while saying nothing. */
      for (const reason of seen.reasons) expect(reason).not.toMatch(/^patients\./);
    });
  }
});

describe('a number is compared whole, or not at all', () => {
  it('does not let a shared line alone put a record in front of the registrar', () => {
    /*
     * A practice's own number is given by patients who have no other, so on its
     * own a number in common describes a household rather than a person. It is
     * below the band that shows anything, and far below the band that holds a
     * save.
     */
    const seen = outcomeFor({
      given: 'Rowan',
      family: 'Mockford',
      birthDate: '1955-01-01',
      phoneMobile: HOUSEHOLD_LINE,
    });
    expect(seen.outcome).toBe('none');
  });

  it('never blocks on anything short of agreement about the name', () => {
    /*
     * Every combination that leaves out both name signals, scored together, is
     * still below the blocking band. This is the property the bands exist for,
     * asserted rather than left to the reader to add up.
     */
    const withoutNames = findDuplicates(
      draft({ birthDate: '2018-09-02', phoneMobile: HOUSEHOLD_LINE }),
      ROSTER
    );
    expect(withoutNames.length).toBeGreaterThan(0);
    expect(isBlocking(withoutNames)).toBe(false);
  });
});

describe('the bands', () => {
  it('leaves room between being shown and being stopped', () => {
    /* A blocking band equal to the candidate band would mean every record the
       registrar is shown also refuses the save. */
    expect(BLOCKING_SCORE).toBeGreaterThan(CANDIDATE_SCORE);
  });
});

describe('withinOneEdit', () => {
  const YES: ReadonlyArray<readonly [string, string]> = [
    ['smith', 'smith'],
    ['smith', 'smyth'],
    ['jon', 'john'],
    ['john', 'jon'],
    ['smith', 'smtih'],
    ['ab', 'ba'],
    ['abcd', 'abdc'],
    ['', 'a'],
    ['a', ''],
    ['a', 'b'],
    ['aa', 'a'],
    ['aba', 'aa'],
    ['oconnor', "o'connor"],
  ];

  for (const [a, b] of YES) {
    it(`counts "${a}" and "${b}" as one edit apart at most`, () => {
      expect(withinOneEdit(a, b)).toBe(true);
    });
  }

  const NO: ReadonlyArray<readonly [string, string]> = [
    ['smith', 'smyhh'],
    ['abc', 'cba'],
    ['smith', 'smithers'],
    ['', 'ab'],
    ['kate', 'katrina'],
    ['anna', 'hannah'],
    ['abcd', 'badc'],
    ['abcde', 'abdec'],
  ];

  for (const [a, b] of NO) {
    it(`counts "${a}" and "${b}" as further apart than one edit`, () => {
      expect(withinOneEdit(a, b)).toBe(false);
    });
  }

  it('is symmetric, which a walk from both ends has to be to be trusted', () => {
    for (const [a, b] of [...YES, ...NO]) {
      expect(withinOneEdit(a, b)).toBe(withinOneEdit(b, a));
    }
  });
});
