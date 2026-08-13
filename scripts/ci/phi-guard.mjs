#!/usr/bin/env node
// Synthetic-data guard.
//
// CLAUDE.md, AGENTS.md and CONTRIBUTING.md all carry the same hard rule:
// synthetic patient data only, never real PHI or PII, in tests, fixtures,
// seeds, screenshots or logs. Until this script existed the rule was enforced
// by trust alone. This guard turns it into a CI gate.
//
// DESIGN CONSTRAINT: a naive regex sweep over a medical codebase produces
// overwhelming false positives, and a gate that cries wolf is switched off
// within a week - which is strictly worse than no gate. So every rule here is
// built to answer one question: what distinguishes REAL patient data from the
// synthetic data this repository legitimately contains? Concretely:
//
//   * A US SSN is only flagged when it is STRUCTURALLY VALID. The reserved
//     never-issued ranges (area 000, 666, 900-999; group 00; serial 0000) are
//     exactly what the repo's own fixtures use ('000-00-0000'), so a valid one
//     is the signal.
//   * An NHS number is only flagged when it passes its mod-11 checksum and is
//     outside NHS England's reserved 999-prefixed synthetic range.
//   * A payment card number is only flagged when it passes Luhn AND carries a
//     real issuer prefix AND is not one of the publicly documented test PANs.
//   * An email is only flagged when its domain is not a reserved test domain.
//   * A phone number is only flagged when it is a routable NANP or UK number
//     outside the reserved drama/test ranges.
//   * A name is only flagged when it sits next to a date of birth AND carries
//     no synthetic marker, which is the convention this repository already
//     follows everywhere ("Testina Patientsson", "Exampla Testperson").
//
// SCOPE: two tiers, because the cost of a false positive differs by rule.
//
//   Tier A (ssn, nhs-number, payment-card) runs over the WHOLE tracked tree.
//     A structurally valid SSN or a Luhn-valid card has no legitimate place in
//     any file in this repository, source included.
//   Tier B (email, phone, name-with-dob) runs only over seeds, fixtures, test
//     data, snapshots, stories and docs. Application source legitimately
//     contains code systems, LOINC and CPT identifiers and FHIR canonical
//     URIs, and contact strings in source are configuration rather than
//     patient data; scanning it would generate noise without finding PHI.
//
// Usage:
//   node scripts/ci/phi-guard.mjs            # scan the tracked tree
//   node scripts/ci/phi-guard.mjs --json     # machine-readable findings
//   node scripts/ci/phi-guard.mjs <paths...> # scan specific files
//
// Exit code 0 when clean, 1 when anything is found, 2 on a usage error.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Allowlists. Every entry needs a reason and a revisit condition.
// ---------------------------------------------------------------------------

/**
 * Domains that may appear in an email address anywhere in scope.
 *
 * The reserved families (RFC 2606 / RFC 6761) are handled structurally below;
 * this list is only for real domains a human has looked at and accepted.
 */
const EMAIL_DOMAIN_ALLOWLIST = new Map([
  // The project's own published contact addresses (security@ in SECURITY.md,
  // conduct@ in CODE_OF_CONDUCT.md). These are role addresses that exist to be
  // written to, not personal data.
  // Revisit if: the project's contact domain changes, or a personal mailbox
  // rather than a role address is ever published here.
  ['yosemitecrew.com', 'project role addresses published in SECURITY.md and CODE_OF_CONDUCT.md'],
  // Placeholder text in the @openrunic/ui Input stories and their tests
  // ("you@clinic.org", "okafor@clinic.org"). No identity is attached: they are
  // field placeholders and a default value, not fixture patient data.
  // Revisit if: those placeholders move to a reserved domain (example.org),
  // at which point delete this entry - it should stop being needed.
  ['clinic.org', 'field placeholder text in packages/ui Input stories and tests'],
]);

/**
 * Publicly documented test card numbers. These pass Luhn and carry real issuer
 * prefixes by design, which is the whole point of them: they are the numbers
 * payment processors publish so nobody needs a real card in a fixture.
 *
 * Revisit if: a payment integration lands and brings its own documented test
 * PANs - add them here rather than weakening the Luhn rule.
 */
const TEST_PANS = new Set([
  '4242424242424242',
  '4111111111111111',
  '4012888888881881',
  '4000056655665556',
  '4222222222222',
  '5555555555554444',
  '5105105105105100',
  '5200828282828210',
  '2223003122003222',
  '378282246310005',
  '371449635398431',
  '6011111111111117',
  '6011000990139424',
  '3056930009020004',
  '3566002020360505',
  '6200000000000005',
]);

/**
 * Tokens that mark a name as obviously invented.
 *
 * Calibrated against the identities this repository already ships:
 * "Testina Patientsson", "Exampla Testperson", "Placeholder Nullsson",
 * "Demonstra Fixtureby", "Quinta Examplebury", "Stubbert Cassidental" and the
 * rest of PATIENT_NAMES in packages/database/src/seed/data.ts. Every one of
 * those carries at least one of these tokens across the given/family pair,
 * which is why the rule checks the whole identity rather than a single field.
 *
 * "patient" earns its place because a person actually surnamed "...Patient..."
 * is vanishingly rare and this repository's canonical fixture surname is
 * "Patientsson".
 */
const SYNTHETIC_NAME_MARKERS = [
  'anonym',
  'assert',
  'bar',
  'baselin',
  'baz',
  'blank',
  'canonic',
  'demo',
  'dumm',
  'empty',
  'exampl',
  'fake',
  'fictit',
  'fixtur',
  'foo',
  'ipsum',
  'lorem',
  'mock',
  'nemo',
  'nobody',
  'noone',
  'notreal',
  'null',
  'patient',
  // A surname ending "-person" ("Testperson", "Otherperson") is a convention
  // in this repository's test rows. Real surnames of the "Persson" family do
  // not contain the substring "person".
  'person',
  'placehol',
  'prototyp',
  'qux',
  'redact',
  'regress',
  'rehears',
  'sample',
  'sandbox',
  'seed',
  'simul',
  'specimen',
  'stub',
  'suite',
  'synth',
  'test',
  'trial',
  'unknown',
  'verif',
];

// ---------------------------------------------------------------------------
// Path scoping.
// ---------------------------------------------------------------------------

/** Never scanned: generated output, vendored trees, lockfiles, binaries. */
const NEVER_SCAN = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /(^|\/)\.turbo\//,
  /(^|\/)out\//,
  /^pnpm-lock\.yaml$/,
  /^packages\/database\/src\/generated\//,
  /^security\/sbom\//,
  // The guard's own source: it necessarily contains every pattern it detects,
  // including deliberately valid example identifiers in its unit tests.
  // Revisit if: the guard is ever split so that only the test file needs this.
  /^scripts\/ci\/phi-guard(\.test)?\.mjs$/,
];

/** Extensions with no readable text to scan. */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.zip',
  '.gz',
  '.tgz',
  '.mp4',
  '.webm',
  '.wasm',
]);

/**
 * Tier B scope: where fixture-shaped data actually lives.
 *
 * Deliberately NOT application source. packages/fhir, packages/terminology and
 * packages/x12 source files are full of LOINC, CPT, SNOMED and ICD-10 codes and
 * FHIR canonical URIs; running the contact-detail and identity rules over them
 * would produce noise and find nothing.
 */
const FIXTURE_SCOPE = [
  /(^|\/)seeds?\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)fixtures?\//,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)mocks?\//,
  /(^|\/)__snapshots__\//,
  /(^|\/)test-?data\//,
  /(^|\/)screenshots?\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.stories\.[cm]?[jt]sx?$/,
  /fixtures?\.[cm]?[jt]sx?$/,
  /\.snap$/,
  /^docs\//,
  /^[^/]+\.md$/,
];

/** Structured formats where the key-driven identity rule can be trusted. */
const STRUCTURED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.md',
  '.snap',
]);

const matchesAny = (patterns, filePath) => patterns.some((pattern) => pattern.test(filePath));

export const isScannable = (filePath) =>
  !matchesAny(NEVER_SCAN, filePath) && !BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());

export const isFixtureScope = (filePath) => matchesAny(FIXTURE_SCOPE, filePath);

// ---------------------------------------------------------------------------
// Checksums and validators.
// ---------------------------------------------------------------------------

/** Standard Luhn (mod-10) check over a digit string. */
export function passesLuhn(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * True when a 9-digit string could have been issued as a US SSN.
 *
 * The Social Security Administration has never issued an SSN with area 000,
 * area 666, area 900-999, group 00 or serial 0000, which is precisely why
 * those ranges are the correct choice for a fixture.
 */
export function isIssuableSsn(digits) {
  if (!/^\d{9}$/.test(digits)) return false;
  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);
  if (area === '000' || area === '666' || Number(area) >= 900) return false;
  if (group === '00') return false;
  if (serial === '0000') return false;
  return true;
}

/**
 * True when a 10-digit string passes the NHS number mod-11 checksum.
 *
 * Weights 10..2 over the first nine digits; the check digit is 11 minus the
 * remainder, where 11 becomes 0 and 10 means the number is invalid.
 */
export function isValidNhsNumber(digits) {
  if (!/^\d{10}$/.test(digits)) return false;
  let total = 0;
  for (let index = 0; index < 9; index += 1) {
    total += Number(digits[index]) * (10 - index);
  }
  const remainder = total % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  if (check === 10) return false;
  return check === Number(digits[9]);
}

/** True for NHS England's reserved synthetic range (999 000 0000 upwards). */
const isReservedNhsNumber = (digits) => digits.startsWith('999');

/** Issuer prefixes that mean a Luhn-valid number is plausibly a real card. */
const CARD_ISSUER_PATTERNS = [
  /^4\d{12}(\d{3})?(\d{3})?$/, // Visa (13, 16 or 19)
  /^5[1-5]\d{14}$/, // Mastercard
  /^2(2[2-9]\d{2}|[3-6]\d{3}|7[01]\d{2}|720\d)\d{12}$/, // Mastercard 2-series
  /^3[47]\d{13}$/, // American Express
  /^6(?:011\d{12}|5\d{14}|4[4-9]\d{13})$/, // Discover
  /^3(?:0[0-5]|[68]\d)\d{11}$/, // Diners Club
  /^(?:2131|1800|35\d{3})\d{11}$/, // JCB
  /^62\d{14,17}$/, // UnionPay
];

export const looksLikeCardNumber = (digits) =>
  CARD_ISSUER_PATTERNS.some((pattern) => pattern.test(digits));

/** Reserved email domains: RFC 2606 and RFC 6761 plus the allowlist above. */
export function isAllowedEmailDomain(domain) {
  const lower = domain.toLowerCase();
  if (EMAIL_DOMAIN_ALLOWLIST.has(lower)) return true;
  if (/(^|\.)(example\.(com|net|org|edu))$/.test(lower)) return true;
  if (/\.(invalid|test|example|localhost|local)$/.test(lower)) return true;
  if (lower === 'localhost') return true;
  return false;
}

/**
 * Classifies a phone-shaped value.
 *
 * Returns 'reserved' for a documented test range, 'real' for a number that
 * could route to a person, and 'unknown' for anything this function cannot
 * confidently place. Only 'real' is a finding: an unrecognised international
 * format is reported as unknown rather than guessed at, because guessing is
 * how a guard starts crying wolf.
 */
export function classifyPhone(raw) {
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 9) return 'unknown';

  const international = trimmed.startsWith('+');

  // --- North American Numbering Plan ---------------------------------------
  const nanp =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith('1')
        ? digits.slice(1)
        : null;
  if (nanp && (!international || digits.length === 11)) {
    const npa = nanp.slice(0, 3);
    const nxx = nanp.slice(3, 6);
    const line = nanp.slice(6);
    // Area code 555 is not assignable to a subscriber, and 555-0100 to
    // 555-0199 is the range reserved for fiction and documentation.
    if (npa === '555') return 'reserved';
    if (nxx === '555' && line >= '0100' && line <= '0199') return 'reserved';
    // Structural validity: a real NANP number has an area code and an exchange
    // that both start 2-9, and no N11 area code.
    const structural = /^[2-9][0-8]\d$/.test(npa) && /^[2-9]\d\d$/.test(nxx) && !/^\d11$/.test(npa);
    return structural ? 'real' : 'unknown';
  }

  // --- United Kingdom -------------------------------------------------------
  const uk = digits.startsWith('44')
    ? `0${digits.slice(2)}`
    : trimmed.startsWith('0') && !international
      ? digits
      : null;
  if (uk) {
    // Ofcom's ranges reserved for drama and documentation.
    const reserved = [
      /^07700900\d{3}$/, // 07700 900000-900999
      /^02079460\d{3}$/, // 020 7946 0000-0999
      /^01632960\d{3}$/, // 01632 960000-960999
      /^0113496 ?0\d{3}$/,
      /^0114496 ?0\d{3}$/,
      /^0115496 ?0\d{3}$/,
      /^0116496 ?0\d{3}$/,
      /^0117496 ?0\d{3}$/,
      /^0118496 ?0\d{3}$/,
      /^0121496 ?0\d{3}$/,
      /^08081570\d{3}$/, // 0808 157 0000-0999
      /^03069990\d{3}$/, // 03069 990000-990999
      /^0909879\d{4}$/, // 09098 79xxxx
    ];
    if (reserved.some((pattern) => pattern.test(uk))) return 'reserved';
    if (/^07\d{9}$/.test(uk)) return 'real'; // UK mobile
    if (/^0[123]\d{8,9}$/.test(uk)) return 'real'; // UK geographic / non-geographic
    return 'unknown';
  }

  return 'unknown';
}

/** True when any part of an identity carries an obviously-invented marker. */
export function hasSyntheticMarker(text) {
  const lower = String(text).toLowerCase();
  return SYNTHETIC_NAME_MARKERS.some((marker) => lower.includes(marker));
}

// ---------------------------------------------------------------------------
// Rules.
// ---------------------------------------------------------------------------

const SSN_SEPARATED = /\b(\d{3})[- ](\d{2})[- ](\d{4})\b/g;
const SSN_KEYED = /\b(?:ssn|social[\s_-]?security(?:[\s_-]?(?:number|no))?)\b\D{0,12}(\d{9})\b/gi;
const NHS_SPACED = /\b(\d{3}) (\d{3}) (\d{4})\b/g;
const NHS_KEYED = /\bnhs(?:[\s_-]?(?:number|no|num))?\b\D{0,12}(\d{10})\b/gi;
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const PHONE_KEYED =
  /\b((?:phone|telephone|tel|mobile|cell|msisdn|fax)[A-Za-z]*)\b["']?\s*[:=]\s*["']([^"'\n]{6,25})["']/gi;
const DOB_KEY = /\b(?:birth_?date|date_?of_?birth|dob)\b\s*["']?\s*[:=]/gi;
const NAME_VALUE =
  /\b(?:names?|given_?names?|family_?names?|first_?name|last_?name|full_?name|sur_?name|patient_?name|preferred_?name|middle_?name|given|family)\b\s*["']?\s*[:=]\s*(\[[^\]]{0,200}\]|["'][^"'\n]{2,60}["'])/gi;
/** The positional identity tuple this repository uses in its seed catalogue. */
const NAME_TUPLE =
  /(["'])([A-Za-z][A-Za-z'-]{1,24})\1\s*,\s*(["'])([A-Za-z][A-Za-z'-]{1,24})\3\s*,\s*(["'])(\d{4}-\d{2}-\d{2})\5/g;
/**
 * Keys that make a window a query, a sort specification or an ORM `orderBy`
 * rather than a patient row. Test suites in this repository build list queries
 * whose keys are `family`, `given` and `birthDate` -  the same keys a patient
 * row uses - so without this the identity rule fires on search parameters.
 *
 * Revisit if: a fixture ever legitimately pairs a patient identity with
 * pagination keys, at which point this needs to become structural rather than
 * lexical.
 */
const QUERY_CONTEXT =
  /\b(?:sort|order|orderBy|order_by|_sort|_count|page|pageSize|page_size|offset|limit)\b\s*["']?\s*[:=]/;
/**
 * A value shaped like a proper noun: an initial capital and at least one
 * lowercase letter. Rejects the ordering literals ('asc', 'desc') and the
 * shouted partial-match terms ('SAM') that appear in query fixtures.
 */
const PROPER_NOUN = /^[A-Z][A-Za-z'’-]*(?:[ -][A-Z]?[A-Za-z'’]+)*$/;

/** Lines of context searched around a date-of-birth key for an identity. */
const DOB_WINDOW = 6;
/**
 * A line that closes a record. Fixture files stack patient rows one after
 * another, so a fixed line window happily glues one row's family name to the
 * next row's date of birth and reports an identity nobody wrote. Stopping the
 * window at a closing bracket keeps it inside a single record.
 */
const RECORD_BOUNDARY = /^\s*[)\]}]/;

/**
 * The lines around `index` (0-based) that belong to the same record, up to
 * `radius` in each direction.
 */
export function recordWindow(lines, index, radius = DOB_WINDOW) {
  let start = index;
  while (start > 0 && index - start < radius && !RECORD_BOUNDARY.test(lines[start - 1])) start -= 1;
  let end = index;
  while (end < lines.length - 1 && end - index < radius && !RECORD_BOUNDARY.test(lines[end + 1])) {
    end += 1;
  }
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Pulls the proper-noun-shaped strings out of a captured name value, which is
 * either a quoted scalar ('Runeberg') or an array literal (['Astrid', 'Maja']).
 */
export function properNouns(capturedValue) {
  return [...String(capturedValue).matchAll(/["']([^"'\n]{2,60})["']/g)]
    .map((match) => match[1].trim())
    .filter((value) => PROPER_NOUN.test(value) && /[a-z]/.test(value));
}

/**
 * True when a window's name values amount to an identity rather than a
 * fragment: either two separate proper nouns (a given and a family name) or
 * one value that already contains a space ("Testina Patientsson"). At least
 * one of them must be four characters or longer, because a pair of three-letter
 * values is far more likely to be a search prefix than a person.
 */
export function isFullIdentity(values) {
  if (values.length === 0) return false;
  const longEnough = values.some((value) => value.replace(/[^A-Za-z]/g, '').length >= 4);
  if (!longEnough) return false;
  return values.length >= 2 || values.some((value) => value.includes(' '));
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function pushFinding(findings, { rule, line, evidence, message }) {
  findings.push({ rule, line, evidence, message });
}

/** Redacts the middle of an identifier so CI logs never carry the value. */
export function redact(value) {
  const text = String(value);
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(text.length - 4, 1))}${text.slice(-2)}`;
}

function scanTierA(text, findings) {
  for (const match of text.matchAll(SSN_SEPARATED)) {
    const digits = match[1] + match[2] + match[3];
    if (!isIssuableSsn(digits)) continue;
    pushFinding(findings, {
      rule: 'us-ssn',
      line: lineOf(text, match.index),
      evidence: redact(match[0]),
      message:
        'structurally valid US Social Security number. Fixtures must use the never-issued ranges: area 000, 666 or 900-999.',
    });
  }

  for (const match of text.matchAll(SSN_KEYED)) {
    if (!isIssuableSsn(match[1])) continue;
    pushFinding(findings, {
      rule: 'us-ssn',
      line: lineOf(text, match.index),
      evidence: redact(match[1]),
      message:
        'structurally valid US Social Security number in an SSN-keyed field. Fixtures must use the never-issued ranges: area 000, 666 or 900-999.',
    });
  }

  for (const match of text.matchAll(NHS_SPACED)) {
    const digits = match[1] + match[2] + match[3];
    if (!isValidNhsNumber(digits) || isReservedNhsNumber(digits)) continue;
    // A US number written as "508 555 0137" has the same shape; a phone key on
    // the same line means this is not an NHS number.
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const lineEnd = text.indexOf('\n', match.index);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    // No \b before "phone": the key is usually camelCased ("contactPhone",
    // "phoneMobile"), where a word boundary would never match.
    if (/(?:phone|mobile|msisdn|fax|\btel\b|\bcell\b)/i.test(line)) continue;
    pushFinding(findings, {
      rule: 'nhs-number',
      line: lineOf(text, match.index),
      evidence: redact(match[0]),
      message:
        'NHS number passing its mod-11 checksum. Fixtures must use the reserved 999-prefixed synthetic range.',
    });
  }

  for (const match of text.matchAll(NHS_KEYED)) {
    if (!isValidNhsNumber(match[1]) || isReservedNhsNumber(match[1])) continue;
    pushFinding(findings, {
      rule: 'nhs-number',
      line: lineOf(text, match.index),
      evidence: redact(match[1]),
      message:
        'NHS number passing its mod-11 checksum in an NHS-keyed field. Fixtures must use the reserved 999-prefixed synthetic range.',
    });
  }

  for (const match of text.matchAll(CARD_CANDIDATE)) {
    const digits = match[0].replace(/\D/g, '');
    if (TEST_PANS.has(digits)) continue;
    if (!looksLikeCardNumber(digits) || !passesLuhn(digits)) continue;
    pushFinding(findings, {
      rule: 'payment-card',
      line: lineOf(text, match.index),
      evidence: redact(digits),
      message:
        'payment card number passing the Luhn check with a real issuer prefix. Use a documented test card number instead.',
    });
  }
}

function scanTierB(text, filePath, findings) {
  for (const match of text.matchAll(EMAIL)) {
    if (isAllowedEmailDomain(match[1])) continue;
    pushFinding(findings, {
      rule: 'real-email',
      line: lineOf(text, match.index),
      evidence: redact(match[0]),
      message: `email address on a non-reserved domain (${match[1]}). Use example.com, example.org or a .invalid address.`,
    });
  }

  for (const match of text.matchAll(PHONE_KEYED)) {
    if (classifyPhone(match[2]) !== 'real') continue;
    pushFinding(findings, {
      rule: 'real-phone',
      line: lineOf(text, match.index),
      evidence: redact(match[2]),
      message:
        'phone number outside the reserved test ranges. Use NANP 555-0100 to 555-0199, or the Ofcom drama ranges for UK numbers.',
    });
  }

  if (!STRUCTURED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;

  const lines = text.split('\n');
  for (const match of text.matchAll(DOB_KEY)) {
    const dobLine = lineOf(text, match.index);
    const window = recordWindow(lines, dobLine - 1);
    if (QUERY_CONTEXT.test(window)) continue;
    const names = [...window.matchAll(NAME_VALUE)].flatMap((nameMatch) =>
      properNouns(nameMatch[1])
    );
    if (!isFullIdentity(names)) continue;
    const identity = names.join(' ');
    if (hasSyntheticMarker(identity)) continue;
    pushFinding(findings, {
      rule: 'name-with-dob',
      line: dobLine,
      evidence: redact(identity.slice(0, 60)),
      message:
        'a name sits next to a date of birth and carries no synthetic marker. Name fixture identities so they cannot be mistaken for a real person, as PATIENT_NAMES in packages/database/src/seed/data.ts does.',
    });
  }

  for (const match of text.matchAll(NAME_TUPLE)) {
    const identity = `${match[2]} ${match[4]}`;
    if (hasSyntheticMarker(identity)) continue;
    pushFinding(findings, {
      rule: 'name-with-dob',
      line: lineOf(text, match.index),
      evidence: redact(identity),
      message:
        'a name/name/date-of-birth tuple carries no synthetic marker. Name fixture identities so they cannot be mistaken for a real person, as PATIENT_NAMES in packages/database/src/seed/data.ts does.',
    });
  }
}

/**
 * Scans one file's text. `filePath` is repository-relative and decides which
 * tier of rules applies; pass a fixture-shaped path to exercise Tier B.
 */
export function scanText(text, filePath) {
  const findings = [];
  scanTierA(text, findings);
  if (isFixtureScope(filePath)) scanTierB(text, filePath, findings);
  return findings
    .map((finding) => ({ ...finding, file: filePath }))
    .sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

/** Files over this size are skipped: no fixture identity lives in a blob. */
const MAX_BYTES = 2 * 1024 * 1024;

function trackedFiles(root) {
  const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

export function scanRepository(root, explicitPaths = []) {
  const candidates = explicitPaths.length > 0 ? explicitPaths : trackedFiles(root);
  const findings = [];
  for (const relative of candidates) {
    if (!isScannable(relative)) continue;
    const absolute = path.resolve(root, relative);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue; // Deleted between listing and reading; nothing to scan.
    }
    if (!stats.isFile() || stats.size > MAX_BYTES) continue;
    const text = readFileSync(absolute, 'utf8');
    // A NUL byte means the file is binary despite its extension.
    if (text.includes('\0')) continue;
    findings.push(...scanText(text, relative));
  }
  return findings;
}

function main(argv) {
  const json = argv.includes('--json');
  const paths = argv.filter((argument) => !argument.startsWith('--'));
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const findings = scanRepository(root, paths);

  if (json) {
    process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write('phi-guard: clean - no PHI-shaped values found in scope.\n');
  } else {
    process.stdout.write(`phi-guard: ${findings.length} finding(s)\n\n`);
    for (const finding of findings) {
      process.stdout.write(`  ${finding.file}:${finding.line}  [${finding.rule}]\n`);
      process.stdout.write(`    ${finding.message}\n`);
      process.stdout.write(`    evidence (redacted): ${finding.evidence}\n\n`);
    }
    process.stdout.write(
      'Synthetic data only: see the "Synthetic data only" section of CONTRIBUTING.md.\n'
    );
  }
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
