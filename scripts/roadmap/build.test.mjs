/*
 * The roadmap generator's parsers.
 *
 * These matter more than most script tests, because the page they build is the
 * one a reader trusts to say what this software can do. A parser that silently
 * drops a row does not fail: it publishes a shorter, wrong roadmap, and the
 * only symptom is a number nobody recognises as low.
 *
 * So the cases below are the shapes the real file actually contains, plus the
 * shapes a contributor will produce next: a bolded capability name, a row with
 * no note, a table with a different column count, and prose that looks like a
 * table row but is not one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readCapabilities, bucketFor, readServedResources } from './build.mjs';

test('reads a capability row with its section', () => {
  const rows = readCapabilities(
    [
      '## Clinical core',
      '',
      '| Capability | State | Note |',
      '| --- | --- | --- |',
      '| Patient registration | **Done** | Plus identifiers |',
    ].join('\n')
  );

  assert.deepEqual(rows, [
    {
      section: 'Clinical core',
      name: 'Patient registration',
      state: 'Done',
      note: 'Plus identifiers',
    },
  ]);
});

test('strips the bold that marks a recently added capability from its name', () => {
  /* The source table bolds new rows. That is presentation, and a roadmap that
     printed `**Referral management**` would be showing the reader the markup. */
  const [row] = readCapabilities(
    ['## Clinical core', '| **Referral management** | **Done** | The lifecycle |'].join('\n')
  );

  assert.equal(row.name, 'Referral management');
});

test('keeps a row whose note is empty rather than dropping it', () => {
  const rows = readCapabilities(
    ['## Prescribing', '| Formulary check | **Seam only** |  |'].join('\n')
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].note, '');
});

test('skips the header and separator rows without a state test on position', () => {
  const rows = readCapabilities(
    [
      '## Interoperability',
      '| Capability | State | Note |',
      '| ---------- | ----- | ---- |',
      '| FHIR R4 boundary | **Done** | 22 types |',
    ].join('\n')
  );

  assert.deepEqual(
    rows.map((r) => r.name),
    ['FHIR R4 boundary']
  );
});

test('ignores prose that begins with a pipe but names no state', () => {
  const rows = readCapabilities(['## Notes', '| this is not a capability row |'].join('\n'));

  assert.deepEqual(rows, []);
});

test('carries the section forward across several tables', () => {
  const rows = readCapabilities(
    [
      '## Clinical core',
      '| A | **Done** | |',
      '## Prescribing',
      '| B | **Done** | |',
      '| C | **Missing** | |',
    ].join('\n')
  );

  assert.deepEqual(
    rows.map((r) => `${r.section}/${r.name}`),
    ['Clinical core/A', 'Prescribing/B', 'Prescribing/C']
  );
});

test('sorts every state into exactly one of the three columns', () => {
  /* The qualified Done forms are the ones worth pinning: `Done (library)` and
     `Done (codec)` are shipped capabilities, and a prefix test is what keeps
     them out of the "later" column when somebody adds `Done (partial)`. */
  assert.equal(bucketFor('Done'), 'now');
  assert.equal(bucketFor('Done (library)'), 'now');
  assert.equal(bucketFor('Done (codec)'), 'now');
  assert.equal(bucketFor('Seam only'), 'next');
  assert.equal(bucketFor('Missing'), 'later');
  assert.equal(bucketFor('Not startable'), 'later');
  /* An unrecognised state lands in `later`, which is the safe direction: a new
     state reads as not-yet-available until somebody classifies it, rather than
     being announced as shipped. */
  assert.equal(bucketFor('Something new'), 'later');
});

test('reads the served resource list from each module declared type', () => {
  const names = readServedResources(
    [
      "const patientModule = defineFhirResource({ type: 'Patient'",
      "const practitionerRoleModule = defineFhirResource({ type: 'PractitionerRole'",
      'export const SERVED_MODULES: readonly FhirResourceModule[] = [',
      '  patientModule,',
      '  practitionerRoleModule,',
      '];',
    ].join('\n')
  );

  assert.deepEqual(names, ['Patient', 'PractitionerRole']);
});

test('takes the declared type, not the variable name', () => {
  /*
   * The regression this exists for. Deriving the name from the variable, by
   * stripping `Module` and capitalising, published `Allergy` for a server that
   * serves `AllergyIntolerance`: a wrong resource name on the one page whose
   * job is telling people what they can call.
   */
  const names = readServedResources(
    [
      "const allergyModule = defineFhirResource({ type: 'AllergyIntolerance'",
      'export const SERVED_MODULES: readonly FhirResourceModule[] = [',
      '  allergyModule,',
      '];',
    ].join('\n')
  );

  assert.deepEqual(names, ['AllergyIntolerance']);
});

test('reads a type declared under a leading comment', () => {
  /* Several modules open with a block comment explaining what they serve, so
     the type is not always the first thing after the brace. */
  const names = readServedResources(
    [
      'const questionnaireModule = defineFhirResource({',
      '  /* PUBLISHED only. */',
      "  type: 'Questionnaire',",
      'export const SERVED_MODULES: readonly FhirResourceModule[] = [',
      '  questionnaireModule,',
      '];',
    ].join('\n')
  );

  assert.deepEqual(names, ['Questionnaire']);
});

test('refuses a module whose type it cannot read, rather than guessing', () => {
  assert.throws(
    () =>
      readServedResources(
        [
          'export const SERVED_MODULES: readonly FhirResourceModule[] = [',
          '  mysteryModule,',
          '];',
        ].join('\n')
      ),
    /mysteryModule/
  );
});

test('fails loudly when the served list cannot be found', () => {
  /* Answering an empty list would put "0 FHIR R4 resource types served" on a
     public page after an ordinary refactor of that file. */
  assert.throws(() => readServedResources('export const OTHER = [];'), /SERVED_MODULES/);
});
