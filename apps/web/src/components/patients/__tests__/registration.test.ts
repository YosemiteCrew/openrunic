import { describe, expect, it } from 'vitest';

import {
  BLOCKING_SCORE,
  EMPTY_DRAFT,
  findDuplicates,
  isBlocking,
  proposeMrn,
  REQUIRED_FIELDS,
  toPatientCreateBody,
  validateRegistration,
} from '@/components/patients';
import type { RegistrationDraft } from '@/components/patients';
import { MOCK_NOW, MOCK_PATIENTS } from '@/lib/api';

/**
 * The registration rules. Two things are load-bearing: exactly four fields are
 * required, and a person who is already in the practice cannot be registered
 * again by accident.
 */

const NOW = new Date(MOCK_NOW);

/** The form as the screen presents it: empty, but with an MRN already proposed. */
const PROPOSED: RegistrationDraft = { ...EMPTY_DRAFT, mrn: proposeMrn(NOW) };

function draft(overrides: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    ...PROPOSED,
    given: 'Verifia',
    family: 'Assertson',
    birthDate: '1991-02-17',
    phoneMobile: '+1 555 0142 900',
    ...overrides,
  };
}

describe('validateRegistration', () => {
  it('requires exactly the four fields that make a record bookable', () => {
    // The MRN is not one of them: the form arrives with one proposed, so the
    // front desk types four values and no more.
    const errors = validateRegistration(PROPOSED, NOW);
    expect(Object.keys(errors).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });

  it('asks for a record number only when somebody has cleared the proposal', () => {
    expect(validateRegistration({ ...draft(), mrn: '   ' }, NOW).mrn).toMatch(/record number/);
    expect(validateRegistration(draft(), NOW).mrn).toBeUndefined();
  });

  it('accepts a walk-in with nothing but those four', () => {
    expect(validateRegistration(draft(), NOW)).toEqual({});
  });

  it('rejects a date of birth that is not a date', () => {
    expect(validateRegistration(draft({ birthDate: '17/02/1991' }), NOW).birthDate).toMatch(
      /YYYY-MM-DD/
    );
  });

  it('rejects a date of birth in the future and says which part to check', () => {
    expect(validateRegistration(draft({ birthDate: '2027-01-01' }), NOW).birthDate).toMatch(
      /future/
    );
  });

  it('rejects an impossible calendar date', () => {
    expect(validateRegistration(draft({ birthDate: '1991-13-45' }), NOW).birthDate).toBeDefined();
  });

  it('accepts a phone number in the shapes people actually give', () => {
    expect(
      validateRegistration(draft({ phoneMobile: '5550142900' }), NOW).phoneMobile
    ).toBeUndefined();
    expect(
      validateRegistration(draft({ phoneMobile: '+44 (0)20 7946 0999' }), NOW).phoneMobile
    ).toBeUndefined();
  });

  it('rejects a phone number that is not one', () => {
    expect(
      validateRegistration(draft({ phoneMobile: 'ring the desk' }), NOW).phoneMobile
    ).toBeDefined();
  });

  it('leaves an omitted email alone but checks one that is given', () => {
    expect(validateRegistration(draft(), NOW).email).toBeUndefined();
    expect(validateRegistration(draft({ email: 'not-an-address' }), NOW).email).toBeDefined();
  });

  it('accepts the address shapes a front desk actually types', () => {
    // Reserved domains only (RFC 2606), keeping the three shapes this proves: a
    // plain address, a dotted local part with a plus tag on a subdomain, and a
    // single-character local part.
    for (const email of ['tess@example.com', 'a.b+tag@sub.example.com', 'x@example.invalid']) {
      expect(validateRegistration(draft({ email }), NOW).email).toBeUndefined();
    }
  });

  it('rejects an address whose domain is missing a label', () => {
    for (const email of ['a@b..c', 'a@example', 'a@.com', 'a@b.']) {
      expect(validateRegistration(draft({ email }), NOW).email).toBeDefined();
    }
  });

  it('asks for an email when the portal invitation needs somewhere to go', () => {
    expect(validateRegistration(draft({ portalEnabled: true }), NOW).email).toMatch(/Portal/);
  });

  it('says what to do, not only what is wrong', () => {
    for (const message of Object.values(validateRegistration(EMPTY_DRAFT, NOW))) {
      expect(message).toMatch(/^Enter |^Use |^Check /);
    }
  });
});

describe('findDuplicates', () => {
  it('finds nothing for a person who is genuinely new', () => {
    expect(findDuplicates(draft(), MOCK_PATIENTS)).toEqual([]);
  });

  it('finds the existing record for the same name and date of birth', () => {
    const matches = findDuplicates(
      draft({ given: 'Testina', family: 'Patientsson', birthDate: '1987-03-14' }),
      MOCK_PATIENTS
    );
    expect(matches[0]?.patient.mrn).toBe('OR-100482');
    expect(matches[0]?.score).toBeGreaterThanOrEqual(BLOCKING_SCORE);
  });

  it('matches a preferred name, because that is what the desk is told', () => {
    const matches = findDuplicates(
      draft({ given: 'Tess', family: 'Patientsson', birthDate: '1987-03-14' }),
      MOCK_PATIENTS
    );
    expect(matches[0]?.reasons).toContain('Same given name');
  });

  it('treats a phone number that already exists as the strongest signal', () => {
    const matches = findDuplicates(
      draft({ given: 'Different', family: 'Person', phoneMobile: '5550142118' }),
      MOCK_PATIENTS
    );
    expect(matches[0]?.reasons).toContain('Same mobile number');
    expect(isBlocking(matches)).toBe(true);
  });

  it('does not block on a shared family name alone', () => {
    const matches = findDuplicates(
      draft({
        given: 'Demonstra',
        family: 'Fixtureby',
        birthDate: '1995-01-01',
        phoneMobile: '5550000000',
      }),
      MOCK_PATIENTS
    );
    expect(isBlocking(matches)).toBe(false);
  });

  it('gives every candidate a plain-language reason', () => {
    const matches = findDuplicates(
      draft({ given: 'Testina', family: 'Patientsson', birthDate: '1987-03-14' }),
      MOCK_PATIENTS
    );
    for (const match of matches) expect(match.reasons.length).toBeGreaterThan(0);
  });

  it('caps the candidate list so the panel stays readable', () => {
    expect(
      findDuplicates(draft({ given: 'Testina', family: 'Patientsson' }), MOCK_PATIENTS, 1)
    ).toHaveLength(1);
  });
});

describe('proposeMrn', () => {
  it('proposes a number in the practice format, stable for the same instant', () => {
    expect(proposeMrn(NOW)).toMatch(/^OR-\d{6}$/);
    expect(proposeMrn(NOW)).toBe(proposeMrn(NOW));
  });

  it('moves with the clock, so two registrations minutes apart do not collide', () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(proposeMrn(later)).not.toBe(proposeMrn(NOW));
  });
});

describe('toPatientCreateBody', () => {
  it('sends only what was typed, so a blank optional field is absent not empty', () => {
    const body = toPatientCreateBody(draft());

    expect(body).toMatchObject({
      givenName: 'Kai',
      familyName: 'Nordstrom',
      birthDate: '1991-02-17',
      phoneMobile: '+1 555 0142 900',
    });
    // An empty string is a value the API rejects where it expects a missing
    // one, and "a middle name that is one space" is not what an empty field
    // means at a front desk.
    expect(Object.keys(body)).not.toContain('email');
    expect(Object.keys(body)).not.toContain('preferredName');
    expect(Object.keys(body)).not.toContain('sexAtBirth');
  });

  it('trims what was typed, because a trailing space is not part of a name', () => {
    const body = toPatientCreateBody(draft({ given: '  Kai  ', city: '  Birchwood ' }));
    expect(body.givenName).toBe('Kai');
    expect(body.city).toBe('Birchwood');
  });

  it('carries the answers the form always has, whether or not they were touched', () => {
    const body = toPatientCreateBody(draft({ sexAtBirth: 'FEMALE', portalEnabled: true }));
    expect(body.sexAtBirth).toBe('FEMALE');
    expect(body.portalEnabled).toBe(true);
    expect(body.languageCode).toBe('en-US');
    expect(body.sensitivityClass).toBe('NORMAL');
  });
});
