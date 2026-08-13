import { describe, expect, it } from 'vitest';

import {
  US_CORE_RACE_EXTENSION,
  address,
  annotations,
  base64ToHex,
  codeableConcept,
  codeableConcepts,
  coding,
  compact,
  compactOrUndefined,
  conceptMapping,
  contactPoint,
  enumMapping,
  firstReferenceId,
  genderIdentityExtension,
  hexToBase64,
  humanName,
  identifier,
  isPresentString,
  money,
  ombCategoryExtension,
  openrunicCodeSystem,
  openrunicExtension,
  optionalReference,
  period,
  present,
  quantity,
  readAnnotation,
  readBooleanExtension,
  readCents,
  readCode,
  readCodeDisplay,
  readCodeExtension,
  readCodeSystem,
  readCodes,
  readConceptText,
  readContactPoint,
  readGenderIdentityCode,
  readGenderIdentitySystem,
  readIdentifier,
  readIdentifierByType,
  readOmbCategoryCodes,
  readOmbCategoryText,
  readQuantityUnit,
  readQuantityValue,
  readReferenceExtension,
  readString,
  readStringExtension,
  referenceExtension,
  referenceId,
  referenceIds,
  referenceType,
  setOptional,
  simpleQuantity,
  stringExtension,
} from './index.js';

describe('compact', () => {
  it('drops everything FHIR JSON cannot carry', () => {
    expect(
      compact({
        keep: 'value',
        zero: 0,
        no: false,
        undef: undefined,
        empty: '',
        emptyList: [],
        emptyObject: {},
      })
    ).toStrictEqual({ keep: 'value', zero: 0, no: false });
  });

  it('drops nulls as well as undefined', () => {
    expect(compact({ nulled: null, kept: 1 })).toStrictEqual({ kept: 1 });
  });

  it('yields undefined for an element with no content', () => {
    expect(compactOrUndefined({ a: undefined })).toBeUndefined();
    expect(compactOrUndefined({ a: 'x' })).toStrictEqual({ a: 'x' });
  });
});

describe('setOptional', () => {
  it('assigns a value but never an undefined key', () => {
    const target: { a?: string; b?: string } = {};
    setOptional(target, 'a', 'value');
    setOptional(target, 'b', undefined);
    expect(Object.keys(target)).toStrictEqual(['a']);
  });
});

describe('present', () => {
  it('drops absent entries', () => {
    expect(present([1, undefined, 3])).toStrictEqual([1, 3]);
  });
});

describe('isPresentString', () => {
  it.each([
    ['value', true],
    ['', false],
    [undefined, false],
    [null, false],
  ])('reads %s as %s', (value, expected) => {
    expect(isPresentString(value)).toBe(expected);
  });
});

describe('element builders', () => {
  it('builds a coding only when there is a code', () => {
    expect(coding('http://loinc.org', '8480-6', 'Systolic')).toStrictEqual({
      system: 'http://loinc.org',
      code: '8480-6',
      display: 'Systolic',
    });
    expect(coding('http://loinc.org', undefined)).toBeUndefined();
    expect(coding(undefined, '8480-6')).toStrictEqual({ code: '8480-6' });
  });

  it('builds a codeable concept from a code, text, or both', () => {
    expect(codeableConcept({ code: 'A', text: 'Alpha' })).toStrictEqual({
      coding: [{ code: 'A' }],
      text: 'Alpha',
    });
    expect(codeableConcept({ text: 'Free text only' })).toStrictEqual({
      text: 'Free text only',
    });
    expect(codeableConcept({})).toBeUndefined();
  });

  it('builds one concept per code and skips the empty ones', () => {
    expect(codeableConcepts(['A', '', 'B'], 'urn:test')).toStrictEqual([
      { coding: [{ system: 'urn:test', code: 'A' }] },
      { coding: [{ system: 'urn:test', code: 'B' }] },
    ]);
    expect(codeableConcepts(undefined)).toStrictEqual([]);
  });

  it('builds an identifier only when there is a value', () => {
    expect(
      identifier({ system: 'urn:test', value: '1', use: 'official', assigner: 'State' })
    ).toStrictEqual({
      use: 'official',
      system: 'urn:test',
      value: '1',
      assigner: { display: 'State' },
    });
    expect(identifier({ system: 'urn:test', value: '' })).toBeUndefined();
  });

  it('builds a human name only when there is a name in it', () => {
    expect(humanName({ family: 'Okafor', given: ['Adaeze', ''], suffix: 'MD' })).toStrictEqual({
      family: 'Okafor',
      given: ['Adaeze'],
      suffix: ['MD'],
    });
    expect(humanName({ use: 'nickname' })).toBeUndefined();
  });

  it('builds an address only when there is an address in it', () => {
    expect(address({ line1: '1 Alder Way', city: 'Ashford', use: 'home' })).toStrictEqual({
      use: 'home',
      line: ['1 Alder Way'],
      city: 'Ashford',
    });
    expect(address({ use: 'home' })).toBeUndefined();
  });

  it('builds a contact point only when there is a value', () => {
    expect(contactPoint('phone', '+15550100', 'mobile')).toStrictEqual({
      system: 'phone',
      value: '+15550100',
      use: 'mobile',
    });
    expect(contactPoint('email', undefined)).toBeUndefined();
  });

  it('builds a period only when a bound is known', () => {
    expect(period('2026-01-01', undefined)).toStrictEqual({ start: '2026-01-01' });
    expect(period(undefined, undefined)).toBeUndefined();
  });

  it('builds a UCUM quantity, and a bare number when the unit is unknown', () => {
    expect(quantity(4, 'mL')).toStrictEqual({
      value: 4,
      unit: 'mL',
      system: 'http://unitsofmeasure.org',
      code: 'mL',
    });
    expect(simpleQuantity(1)).toStrictEqual({ value: 1 });
    expect(quantity(undefined, 'mL')).toBeUndefined();
  });

  it('converts integer cents to money and back', () => {
    expect(money(24500)).toStrictEqual({ value: 245, currency: 'USD' });
    expect(money(1, 'EUR')).toStrictEqual({ value: 0.01, currency: 'EUR' });
    expect(readCents(money(24599))).toBe(24599);
    expect(money(undefined)).toBeUndefined();
    expect(readCents(undefined)).toBeUndefined();
  });

  it('builds an annotation list only when there is a note', () => {
    expect(annotations('Seen today')).toStrictEqual([{ text: 'Seen today' }]);
    expect(annotations('')).toStrictEqual([]);
    expect(readAnnotation([{ text: '' }, { text: 'Second' }])).toBe('Second');
    expect(readAnnotation(undefined)).toBeUndefined();
  });
});

describe('element readers', () => {
  const concept = {
    coding: [
      { system: 'urn:a', code: 'A', display: 'Alpha' },
      { system: 'urn:b', code: 'B' },
    ],
    text: 'Alpha text',
  };

  it('reads codes, displays, systems and text', () => {
    expect(readCode(concept)).toBe('A');
    expect(readCode(concept, 'urn:b')).toBe('B');
    expect(readCode(concept, 'urn:missing')).toBeUndefined();
    expect(readCodeDisplay(concept)).toBe('Alpha');
    expect(readCodeDisplay(concept, 'urn:b')).toBeUndefined();
    expect(readCodeSystem(concept)).toBe('urn:a');
    expect(readCodeSystem({ coding: [{ code: 'A' }] })).toBeUndefined();
    expect(readConceptText(concept)).toBe('Alpha text');
    expect(readConceptText({ coding: [{ code: 'A', display: 'Alpha' }] })).toBe('Alpha');
    expect(readCodes([concept], 'urn:a')).toStrictEqual(['A']);
    expect(readCodes(undefined)).toStrictEqual([]);
  });

  it('reads identifiers by system and by type', () => {
    const identifiers = [
      { system: 'urn:mrn', value: 'OR-100482', type: { coding: [{ code: 'MR' }] } },
      { system: 'urn:ssn', value: '' },
    ];
    expect(readIdentifier(identifiers, 'urn:mrn')).toBe('OR-100482');
    expect(readIdentifier(identifiers, 'urn:ssn')).toBeUndefined();
    expect(readIdentifierByType(identifiers, 'MR')).toBe('OR-100482');
    expect(readIdentifierByType(identifiers, 'SS')).toBeUndefined();
  });

  it('reads contact points by system and use', () => {
    const telecom = [
      { system: 'phone' as const, value: '+15550100', use: 'mobile' as const },
      { system: 'email' as const, value: 'a@example.invalid' },
    ];
    expect(readContactPoint(telecom, 'phone', 'mobile')).toBe('+15550100');
    expect(readContactPoint(telecom, 'phone', 'home')).toBeUndefined();
    expect(readContactPoint(telecom, 'email')).toBe('a@example.invalid');
  });

  it('reads quantity values and prefers the coded unit', () => {
    expect(readQuantityValue({ value: 4 })).toBe(4);
    expect(readQuantityValue(undefined)).toBeUndefined();
    expect(readQuantityUnit({ unit: 'millilitre', code: 'mL' })).toBe('mL');
    expect(readQuantityUnit({ unit: 'millilitre' })).toBe('millilitre');
  });

  it('reads a string, treating an empty one as absent', () => {
    expect(readString('value')).toBe('value');
    expect(readString('')).toBeUndefined();
  });
});

describe('hex and base64 digests', () => {
  it('round-trips a SHA-256 digest through base64', () => {
    const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const encoded = hexToBase64(hex);
    expect(encoded).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(base64ToHex(encoded)).toBe(hex);
  });

  it('pads partial groups the way base64 requires', () => {
    expect(hexToBase64('ab')).toBe('qw==');
    expect(hexToBase64('abcd')).toBe('q80=');
    expect(base64ToHex('qw==')).toBe('ab');
    expect(base64ToHex('q80=')).toBe('abcd');
  });

  it('refuses anything that is not a digest', () => {
    expect(hexToBase64('zz')).toBeUndefined();
    expect(hexToBase64('abc')).toBeUndefined();
    expect(hexToBase64('')).toBeUndefined();
    expect(hexToBase64(undefined)).toBeUndefined();
    expect(base64ToHex('not base64!')).toBeUndefined();
    expect(base64ToHex('')).toBeUndefined();
    expect(base64ToHex(undefined)).toBeUndefined();
    expect(base64ToHex('=')).toBeUndefined();
  });
});

describe('references', () => {
  it('builds an optional reference only for a present id', () => {
    expect(optionalReference('Patient', 'p-1')).toStrictEqual({
      type: 'Patient',
      reference: 'Patient/p-1',
    });
    expect(optionalReference('Patient', '')).toBeUndefined();
  });

  it('reads the id back, refusing anything it cannot resolve', () => {
    expect(referenceId({ reference: 'Patient/p-1' })).toBe('p-1');
    expect(referenceId({ reference: 'Patient/p-1' }, 'Patient')).toBe('p-1');
    expect(referenceId({ reference: 'Patient/p-1' }, 'Practitioner')).toBeUndefined();
    expect(referenceId({ reference: '#contained' })).toBeUndefined();
    expect(referenceId({ reference: 'Patient/' })).toBeUndefined();
    expect(referenceId({ display: 'No literal' })).toBeUndefined();
    expect(referenceId(undefined)).toBeUndefined();
  });

  it('reads the resource type from the literal or the type element', () => {
    expect(referenceType({ reference: 'Patient/p-1' })).toBe('Patient');
    expect(referenceType({ type: 'Patient' })).toBe('Patient');
    expect(referenceType({ reference: 'noslash' })).toBeUndefined();
    expect(referenceType(undefined)).toBeUndefined();
  });

  it('reads ids out of a list', () => {
    const list = [{ reference: 'Location/l-1' }, { reference: 'Patient/p-1' }];
    expect(referenceIds(list, 'Location')).toStrictEqual(['l-1']);
    expect(referenceIds(list)).toStrictEqual(['l-1', 'p-1']);
    expect(firstReferenceId(list, 'Patient')).toBe('p-1');
    expect(firstReferenceId(list, 'Organization')).toBeUndefined();
  });
});

describe('enum mapping', () => {
  type Domain = 'A' | 'B' | 'C';
  const mapping = enumMapping<Domain, string>({
    map: { A: 'a', B: 'a', C: 'c' },
    fallback: 'A',
  });

  it('derives loss instead of taking it on trust', () => {
    expect(mapping.isLossy('A')).toBe(false);
    expect(mapping.isLossy('B')).toBe(true);
    expect(mapping.lossyValues).toStrictEqual(['B']);
  });

  it('lets a canonical override pick the inverse', () => {
    const overridden = enumMapping<Domain, string>({
      map: { A: 'a', B: 'a', C: 'c' },
      canonical: { a: 'B' },
      fallback: 'A',
    });
    expect(overridden.fromFhir('a')).toBe('B');
    expect(overridden.lossyValues).toStrictEqual(['A']);
  });

  it('falls back for an absent or unknown code', () => {
    expect(mapping.fromFhir(undefined)).toBe('A');
    expect(mapping.fromFhir('nonsense')).toBe('A');
  });

  it('guards domain values', () => {
    expect(mapping.isDomainValue('C')).toBe(true);
    expect(mapping.isDomainValue('c')).toBe(false);
    expect(mapping.isDomainValue(undefined)).toBe(false);
    expect(mapping.domainValues).toStrictEqual(['A', 'B', 'C']);
  });
});

describe('concept mapping', () => {
  type Domain = 'ONE' | 'TWO';
  const mapping = conceptMapping<Domain>({
    ONE: { system: 'urn:x', code: 'one' },
    TWO: { system: 'urn:y', code: 'two' },
  });

  it('round-trips through a codeable concept without losing anything', () => {
    expect(mapping.toConcept('TWO')).toStrictEqual({
      coding: [{ system: 'urn:y', code: 'two' }],
    });
    expect(mapping.fromConcepts([mapping.toConcept('TWO')])).toBe('TWO');
    expect(mapping.codingFor('ONE')).toStrictEqual({ system: 'urn:x', code: 'one' });
  });

  it('yields undefined for a concept it does not know', () => {
    expect(
      mapping.fromConcepts([{ coding: [{ system: 'urn:z', code: 'three' }] }])
    ).toBeUndefined();
    expect(mapping.fromConcepts(undefined)).toBeUndefined();
    expect(mapping.fromConcepts([{}])).toBeUndefined();
  });
});

describe('extensions', () => {
  it('namespaces Openrunic extensions and code systems', () => {
    expect(openrunicExtension('local-status')).toBe(
      'https://openrunic.org/fhir/StructureDefinition/local-status'
    );
    expect(openrunicCodeSystem('task-type')).toBe(
      'https://openrunic.org/fhir/CodeSystem/task-type'
    );
  });

  it('builds and reads string, boolean and reference extensions', () => {
    const extensions = [
      stringExtension('urn:s', 'text'),
      referenceExtension('urn:r', { reference: 'Patient/p-1' }),
    ].flatMap((entry) => (entry === undefined ? [] : [entry]));
    expect(readStringExtension(extensions, 'urn:s')).toBe('text');
    expect(readStringExtension(extensions, 'urn:missing')).toBeUndefined();
    expect(readReferenceExtension(extensions, 'urn:r')).toStrictEqual({
      reference: 'Patient/p-1',
    });
    expect(readReferenceExtension(extensions, 'urn:missing')).toBeUndefined();
    expect(stringExtension('urn:s', '')).toBeUndefined();
    expect(referenceExtension('urn:r', undefined)).toBeUndefined();
    expect(readBooleanExtension([{ url: 'urn:b', valueBoolean: false }], 'urn:b')).toBe(false);
    expect(readBooleanExtension([], 'urn:b')).toBeUndefined();
    expect(readCodeExtension([{ url: 'urn:c', valueCode: '' }], 'urn:c')).toBeUndefined();
  });

  it('builds a US Core OMB extension only when there are categories', () => {
    expect(ombCategoryExtension(US_CORE_RACE_EXTENSION, [], undefined)).toBeUndefined();
    const race = ombCategoryExtension(US_CORE_RACE_EXTENSION, ['2106-3'], 'White');
    expect(readOmbCategoryCodes(race ? [race] : [], US_CORE_RACE_EXTENSION)).toStrictEqual([
      '2106-3',
    ]);
    expect(readOmbCategoryText(race ? [race] : [], US_CORE_RACE_EXTENSION)).toBe('White');
    expect(readOmbCategoryCodes(undefined, US_CORE_RACE_EXTENSION)).toStrictEqual([]);
  });

  it('builds a gender identity extension with or without a system', () => {
    const withSystem = genderIdentityExtension('446141000124107', 'http://snomed.info/sct');
    expect(readGenderIdentityCode(withSystem ? [withSystem] : [])).toBe('446141000124107');
    expect(readGenderIdentitySystem(withSystem ? [withSystem] : [])).toBe('http://snomed.info/sct');
    const bare = genderIdentityExtension('446141000124107');
    expect(readGenderIdentitySystem(bare ? [bare] : [])).toBeUndefined();
    expect(genderIdentityExtension('')).toBeUndefined();
    expect(readGenderIdentityCode(undefined)).toBeUndefined();
  });
});
