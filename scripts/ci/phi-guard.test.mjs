#!/usr/bin/env node
// Unit tests for the synthetic-data guard.
//
// A guard without tests is a guess. These prove two things, and the second
// matters as much as the first:
//
//   1. Every rule catches the shape it claims to catch.
//   2. Every rule stays quiet on the fixtures this repository actually ships -
//      the reserved SSN ranges, the .invalid mail domains, the 555-01xx phone
//      block, the deliberately invented identities, and the LOINC/CPT/SNOMED
//      code systems and FHIR canonical URIs in application source.
//
// Run with `node --test scripts/ci/phi-guard.test.mjs`, or
// `pnpm run check:phi:test`.
//
// The identifiers below are constructed to be structurally valid on purpose:
// that is the only way to prove the checksum rules work. None of them belongs
// to anyone - they are arithmetic, not people - and this file is excluded from
// the guard's own scan for exactly that reason.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  classifyPhone,
  isAllowedEmailDomain,
  isFixtureScope,
  isFullIdentity,
  isIssuableSsn,
  isScannable,
  isValidNhsNumber,
  looksLikeCardNumber,
  passesLuhn,
  properNouns,
  recordWindow,
  redact,
  scanText,
} from './phi-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** A path inside Tier B scope, so the fixture-only rules run. */
const FIXTURE = 'packages/database/src/seed/data.ts';
/** A path outside Tier B scope, so only the checksum rules run. */
const SOURCE = 'packages/fhir/src/patient.ts';

const rules = (text, file = FIXTURE) => scanText(text, file).map((finding) => finding.rule);

// ---------------------------------------------------------------------------

describe('checksums and validators', () => {
  it('accepts a Luhn-valid string and rejects a tampered one', () => {
    assert.equal(passesLuhn('4539578763621486'), true);
    assert.equal(passesLuhn('4539578763621487'), false);
    assert.equal(passesLuhn('not-digits'), false);
  });

  it('treats the never-issued SSN ranges as unissuable', () => {
    assert.equal(isIssuableSsn('123456789'), true);
    assert.equal(isIssuableSsn('000000000'), false, 'area 000');
    assert.equal(isIssuableSsn('666123456'), false, 'area 666');
    assert.equal(isIssuableSsn('900123456'), false, 'area 900+');
    assert.equal(isIssuableSsn('123006789'), false, 'group 00');
    assert.equal(isIssuableSsn('123450000'), false, 'serial 0000');
    assert.equal(isIssuableSsn('12345678'), false, 'wrong length');
  });

  it('checks the NHS number mod-11 digit', () => {
    assert.equal(isValidNhsNumber('9434765919'), true);
    assert.equal(isValidNhsNumber('9434765918'), false, 'wrong check digit');
    assert.equal(isValidNhsNumber('943476591'), false, 'wrong length');
  });

  it('recognises real issuer prefixes only', () => {
    assert.equal(looksLikeCardNumber('4539578763621486'), true, 'Visa');
    assert.equal(looksLikeCardNumber('5425233430109903'), true, 'Mastercard');
    assert.equal(looksLikeCardNumber('374245455400126'), true, 'Amex');
    assert.equal(looksLikeCardNumber('1234567812345670'), false, 'no issuer prefix');
  });

  it('treats reserved mail domains as allowed and real ones as not', () => {
    for (const domain of ['example.com', 'example.org', 'demo.invalid', 'foo.test', 'localhost']) {
      assert.equal(isAllowedEmailDomain(domain), true, domain);
    }
    assert.equal(isAllowedEmailDomain('gmail.com'), false);
    assert.equal(isAllowedEmailDomain('nhs.uk'), false);
  });

  it('classifies phone numbers by reserved range', () => {
    assert.equal(classifyPhone('+15550100482'), 'reserved', 'area code 555');
    assert.equal(classifyPhone('5085550137'), 'reserved', 'NANP 555-0100..0199');
    assert.equal(classifyPhone('+447700900123'), 'reserved', 'UK drama mobile');
    assert.equal(classifyPhone('02079460123'), 'reserved', 'UK drama landline');
    assert.equal(classifyPhone('+12125550199'), 'reserved', 'top of the 555-01xx block');
    assert.equal(classifyPhone('+12122000000'), 'real', 'routable exchange');
    assert.equal(classifyPhone('+447911123456'), 'real', 'routable UK mobile');
    assert.equal(classifyPhone('+15550100'), 'unknown', 'too short to be NANP');
    assert.equal(classifyPhone('+81312345678'), 'unknown', 'unhandled country');
  });

  it('redacts the middle of an identifier', () => {
    assert.equal(redact('123456789'), '12*****89');
    assert.doesNotMatch(redact('4539578763621486'), /39578763621/);
  });
});

// ---------------------------------------------------------------------------

describe('scoping', () => {
  it('never scans generated or vendored trees', () => {
    assert.equal(isScannable('apps/web/node_modules/pkg/index.js'), false);
    assert.equal(isScannable('packages/database/src/generated/prisma/client.ts'), false);
    assert.equal(isScannable('pnpm-lock.yaml'), false);
    assert.equal(isScannable('packages/ui/src/assets/logo.png'), false);
    assert.equal(isScannable('packages/fhir/src/patient.ts'), true);
  });

  it('puts fixtures, tests, stories and docs in Tier B and source outside it', () => {
    for (const file of [
      'packages/database/src/seed/data.ts',
      'packages/x12/src/__fixtures__/837p-single-line.edi',
      'apps/api/src/__tests__/fhir.test.ts',
      'apps/portal/src/lib/api/fixtures.ts',
      'packages/ui/src/components/Input/Input.stories.tsx',
      'docs/compliance.md',
      'CONTRIBUTING.md',
    ]) {
      assert.equal(isFixtureScope(file), true, file);
    }
    for (const file of ['packages/fhir/src/patient.ts', 'apps/api/src/fhir/search.ts']) {
      assert.equal(isFixtureScope(file), false, file);
    }
  });
});

// ---------------------------------------------------------------------------

describe('Tier A: catches what it claims to catch, anywhere in the tree', () => {
  it('flags a structurally valid SSN in application source, not only fixtures', () => {
    assert.deepEqual(rules("const ssn = '123-45-6789';", SOURCE), ['us-ssn']);
  });

  it('flags an SSN written against an ssn key without separators', () => {
    assert.deepEqual(rules('{ "ssn": "123456789" }'), ['us-ssn']);
  });

  it('stays quiet on the reserved SSN ranges this repository uses', () => {
    assert.deepEqual(rules("value: '000-00-0000',"), []);
    assert.deepEqual(rules("value: '666-45-6789',"), []);
    assert.deepEqual(rules("value: '900-45-6789',"), []);
  });

  it('flags a checksum-valid NHS number and ignores the reserved 999 range', () => {
    assert.deepEqual(rules("nhsNumber: '9434765919',"), ['nhs-number']);
    assert.deepEqual(rules('943 476 5919'), ['nhs-number']);
    assert.deepEqual(rules("nhsNumber: '9990000018',"), []);
  });

  it('does not read a US phone number written 3-3-4 as an NHS number', () => {
    // 5085550137 happens to pass mod-11; the phone key on the line is what
    // stops the NHS rule from claiming it.
    assert.equal(isValidNhsNumber('5085550137'), true);
    assert.deepEqual(rules("contactPhone: '508 555 0137',"), []);
  });

  it('flags a Luhn-valid card with a real issuer prefix', () => {
    assert.deepEqual(rules("card: '4539 5787 6362 1486',", SOURCE), ['payment-card']);
  });

  it('stays quiet on documented test cards and on Luhn-invalid digit runs', () => {
    assert.deepEqual(rules("card: '4242424242424242',"), []);
    assert.deepEqual(rules("card: '4111111111111111',"), []);
    assert.deepEqual(rules("card: '4539578763621487',"), [], 'fails Luhn');
    assert.deepEqual(rules("controlNumber: '000100002',"), [], 'too short to be a PAN');
  });
});

// ---------------------------------------------------------------------------

describe('Tier B: contact details in fixtures', () => {
  it('flags an email on a real domain', () => {
    assert.deepEqual(rules("email: 'a.okafor@gmail.com',"), ['real-email']);
  });

  it('stays quiet on the reserved domains this repository uses', () => {
    assert.deepEqual(rules("email: 'a.okafor@demo.invalid',"), []);
    assert.deepEqual(rules("email: 'testina.patientsson@example.invalid',"), []);
    assert.deepEqual(rules("email: 'someone@example.org',"), []);
  });

  it('honours the reviewed domain allowlist', () => {
    // Both entries exist because a human looked at them; if either is ever
    // removed from the allowlist this test is what says so.
    assert.deepEqual(rules("placeholder: 'you@clinic.org',"), []);
    assert.deepEqual(rules('Write to security@yosemitecrew.com.', 'SECURITY.md'), []);
  });

  it('flags a routable phone number and allows the reserved ranges', () => {
    assert.deepEqual(rules("phoneMobile: '+1 212 200 0000',"), ['real-phone']);
    assert.deepEqual(rules("phoneMobile: '+15550100482',"), []);
    assert.deepEqual(rules("contactPhone: '5085550137',"), []);
  });

  it('leaves contact details in application source alone', () => {
    // packages/fhir and packages/terminology source is full of code systems and
    // canonical URIs; Tier B never runs there.
    assert.deepEqual(rules("const support = 'help@openrunic.example.co.uk';", SOURCE), []);
  });

  it('leaves code systems and FHIR canonical URIs alone', () => {
    const codes = [
      "const CPT_SYSTEM = 'http://www.ama-assn.org/go/cpt';",
      "const LOINC_SYSTEM = 'http://loinc.org';",
      "const SNOMED_SYSTEM = 'http://snomed.info/sct';",
      "system: 'http://hl7.org/fhir/sid/us-ssn',",
      "['J45.909', 'Unspecified asthma, uncomplicated', '195967001'],",
      "npi: '1999999968',",
      "taxonomyCode: '207Q00000X',",
    ].join('\n');
    assert.deepEqual(rules(codes), []);
  });
});

// ---------------------------------------------------------------------------

describe('Tier B: an identity next to a date of birth', () => {
  it('flags a real-looking identity attached to a date of birth', () => {
    const fixture = [
      'const patient = {',
      "  familyName: 'Runeberg',",
      "  givenNames: ['Astrid', 'Maja'],",
      "  birthDate: '1984-06-02',",
      '};',
    ].join('\n');
    assert.deepEqual(rules(fixture), ['name-with-dob']);
  });

  it('flags a full name in a single field next to a date of birth', () => {
    const fixture = ["  name: 'Marisol Quintero',", "  dateOfBirth: '1984-03-11',"].join('\n');
    assert.deepEqual(rules(fixture), ['name-with-dob']);
  });

  it('stays quiet when the identity carries a synthetic marker', () => {
    const fixture = [
      'const patient = {',
      "  name: 'Testina Patientsson',",
      "  dateOfBirth: '1984-03-11',",
      '};',
    ].join('\n');
    assert.deepEqual(rules(fixture), []);
  });

  it('flags the positional identity tuple form and clears the marked rows', () => {
    assert.deepEqual(rules("['Marisol', 'Quintero', '1984-03-11', 'FEMALE'],"), ['name-with-dob']);
    assert.deepEqual(rules("['Testina', 'Patientsson', '1991-04-17', 'FEMALE'],"), []);
    assert.deepEqual(rules("['Quinta', 'Examplebury', '2000-08-21', 'FEMALE'],"), []);
    assert.deepEqual(rules("['Stubbert', 'Cassidental', '1961-11-15', 'MALE'],"), []);
  });

  it('does not read a list query or an orderBy clause as an identity', () => {
    const query = [
      'const parsed = patientListQuerySchema.parse({',
      "  family: 'Pat',",
      "  given: 'Tes',",
      "  birthDate: '1994-03-02',",
      "  sort: 'birthDate',",
      "  order: 'desc',",
      '});',
    ].join('\n');
    assert.deepEqual(rules(query), []);

    const orderBy = [
      'expect(patientOrderBy(base)).toEqual([',
      "  { familyName: 'asc' },",
      "  { givenName: 'asc' },",
      "  { sort: 'birthDate' },",
      ']);',
    ].join('\n');
    assert.deepEqual(rules(orderBy), []);
  });

  it('does not glue one record’s name to the next record’s date of birth', () => {
    const rows = [
      'dataset.patients.push(',
      '  makePatientRow({',
      "    familyName: 'Bravo',",
      "    birthDate: new Date('1990-01-01T00:00:00.000Z'),",
      '  }),',
      '  makePatientRow({',
      "    familyName: 'Alpha',",
      "    birthDate: new Date('2000-01-01T00:00:00.000Z'),",
      '  })',
      ');',
    ].join('\n');
    assert.deepEqual(rules(rows), []);
  });

  it('does not treat a lone surname as an identity', () => {
    const fixture = ["  familyName: 'Bravo',", "  birthDate: '1990-01-01',"].join('\n');
    assert.deepEqual(rules(fixture), []);
  });

  it('ignores identities in application source', () => {
    const fixture = [
      "  familyName: 'Runeberg',",
      "  givenNames: ['Astrid', 'Maja'],",
      "  birthDate: '1984-06-02',",
    ].join('\n');
    assert.deepEqual(rules(fixture, SOURCE), []);
  });
});

// ---------------------------------------------------------------------------

describe('helpers used by the identity rule', () => {
  it('keeps proper nouns and drops ordering literals and shouted fragments', () => {
    assert.deepEqual(properNouns("['Astrid', 'Maja']"), ['Astrid', 'Maja']);
    assert.deepEqual(properNouns("'asc'"), []);
    assert.deepEqual(properNouns("'SAM'"), []);
    assert.deepEqual(properNouns("'Testina Patientsson'"), ['Testina Patientsson']);
  });

  it('requires two names, or one containing a space, and one of length four', () => {
    assert.equal(isFullIdentity(['Runeberg', 'Astrid']), true);
    assert.equal(isFullIdentity(['Marisol Quintero']), true);
    assert.equal(isFullIdentity(['Bravo']), false, 'a lone surname');
    assert.equal(isFullIdentity(['Pat', 'Tes']), false, 'search prefixes');
    assert.equal(isFullIdentity([]), false);
  });

  it('stops the record window at a closing bracket', () => {
    const lines = ['a', 'b', '}),', 'c', 'd'];
    assert.equal(recordWindow(lines, 3), 'c\nd');
  });
});

// ---------------------------------------------------------------------------

describe('the repository as it stands', () => {
  it('is clean under the guard', () => {
    // The end-to-end assertion: whatever the rules do in isolation, running
    // them over the real tree must produce nothing. If this fails, either a
    // fixture needs fixing or a rule needs calibrating - not silencing.
    const result = execFileSync(process.execPath, [path.join(HERE, 'phi-guard.mjs'), '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.deepEqual(JSON.parse(result).findings, []);
  });
});
