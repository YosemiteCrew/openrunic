import { describe, expect, it } from 'vitest';

import { emptyDocument, minimalDocument, sampleDocument } from './__fixtures__/document.js';
import { generateCcd, parseCcd } from './document.js';
import { CODE_SYSTEMS, DOCUMENT_TEMPLATES, SECTION_TEMPLATES } from './oids.js';
import { CcdaError } from './xml/errors.js';
import { parseXml } from './xml/reader.js';
import { attr, childNamed, childrenNamed, descendantsNamed, path, textOf } from './xml/tree.js';
import type { XmlElement } from './xml/tree.js';

/**
 * The round trip is the test that matters.
 *
 * A generator test asserts the XML has the elements the author expected; a
 * parser test asserts the parser reads the XML the author wrote. Both pass while
 * a field is written into an element nothing reads back, which is the defect
 * this codec is most likely to have and the one a receiving practice discovers
 * as a missing allergy.
 *
 * So each section goes out and comes back, and is compared against what went in.
 */

function roundTrip(): ReturnType<typeof parseCcd> {
  return parseCcd(generateCcd(sampleDocument()));
}

function tree(): XmlElement {
  return parseXml(generateCcd(sampleDocument()));
}

describe('the document as a whole', () => {
  it('declares the CCD templates a receiving system matches on', () => {
    const roots = childrenNamed(tree(), 'templateId').map((node) => attr(node, 'root'));

    expect(roots).toContain(DOCUMENT_TEMPLATES.US_REALM_HEADER.root);
    expect(roots).toContain(DOCUMENT_TEMPLATES.CCD.root);
  });

  it('is the LOINC document type a CCD is, not a generic note', () => {
    const code = childNamed(tree(), 'code');

    expect(attr(code, 'code')).toBe('34133-9');
    expect(attr(code, 'codeSystem')).toBe(CODE_SYSTEMS.LOINC.oid);
  });

  it('writes the elements in the order the CDA schema fixes', () => {
    const names = tree()
      .children.filter((child): child is XmlElement => typeof child !== 'string')
      .map((child) => child.name);

    const order = [
      'realmCode',
      'typeId',
      'templateId',
      'id',
      'code',
      'title',
      'effectiveTime',
      'confidentialityCode',
      'languageCode',
      'recordTarget',
      'author',
      'custodian',
    ];
    // Every one present, and each after the last: the schema rejects a document
    // whose header elements are out of order, and the rejection reaching the
    // other side says only "invalid".
    let previous = -1;
    for (const name of order) {
      const at = names.indexOf(name);
      expect(at, name).toBeGreaterThan(previous);
      previous = at;
    }
  });

  it('refuses to parse something that is not a clinical document', () => {
    expect(() => parseCcd('<Bundle/>')).toThrow(CcdaError);
    expect(() => parseCcd('<Bundle/>')).toThrow(/ClinicalDocument/);
  });

  it('names the organisation answerable for the record', () => {
    const organisation = path(
      tree(),
      'custodian',
      'assignedCustodian',
      'representedCustodianOrganization'
    );

    expect(textOf(childNamed(organisation, 'name'))).toBe('Example Family Practice');
  });
});

describe('the header', () => {
  it('round-trips the patient', () => {
    expect(roundTrip().patient).toEqual(sampleDocument().patient);
  });

  it('round-trips the author, the custodian and the covering period', () => {
    const parsed = roundTrip();
    const original = sampleDocument();

    expect(parsed.author).toEqual(original.author);
    expect(parsed.custodian).toEqual(original.custodian);
    expect(parsed.coveringPeriod).toEqual(original.coveringPeriod);
  });

  it('round-trips the document identity', () => {
    const parsed = roundTrip();
    const original = sampleDocument();

    expect(parsed.id).toBe(original.id);
    expect(parsed.title).toBe(original.title);
    expect(parsed.effectiveAt).toBe(original.effectiveAt);
  });

  /**
   * A date of birth is a date. Writing it as an instant would move it a day for
   * anybody east or west of UTC, and a date of birth that moves is one that
   * stops matching on the other side.
   */
  it('writes the date of birth as a date, with no time on it', () => {
    const birth = attr(
      path(tree(), 'recordTarget', 'patientRole', 'patient', 'birthTime'),
      'value'
    );

    expect(birth).toBe('19940302');
  });

  it('writes the medical record number where a human will look for it', () => {
    const ids = childrenNamed(
      path(tree(), 'recordTarget', 'patientRole') ?? parseXml('<x/>'),
      'id'
    );

    expect(ids.map((node) => attr(node, 'extension'))).toContain('OR-100482');
  });
});

describe('every section, out and back', () => {
  it('round-trips allergies, reaction and criticality included', () => {
    expect(roundTrip().allergies).toEqual(sampleDocument().allergies);
  });

  it('round-trips medications, including the instruction', () => {
    expect(roundTrip().medications).toEqual(sampleDocument().medications);
  });

  it('round-trips problems', () => {
    expect(roundTrip().problems).toEqual(sampleDocument().problems);
  });

  it('round-trips results, both numeric and qualitative', () => {
    expect(roundTrip().results).toEqual(sampleDocument().results);
  });

  it('round-trips vital signs', () => {
    expect(roundTrip().vitals).toEqual(sampleDocument().vitals);
  });

  it('round-trips immunisations, lot number included', () => {
    expect(roundTrip().immunisations).toEqual(sampleDocument().immunisations);
  });

  it('round-trips encounters', () => {
    expect(roundTrip().encounters).toEqual(sampleDocument().encounters);
  });

  it('round-trips the plan of treatment', () => {
    expect(roundTrip().plan).toEqual(sampleDocument().plan);
  });

  it('round-trips social history', () => {
    expect(roundTrip().socialHistory).toEqual(sampleDocument().socialHistory);
  });
});

describe('the things a real chart does that a tidy one does not', () => {
  /**
   * The majority of allergy entries in a real chart have a name and no code.
   * Writing the display name into `@code` would assert a code in a system this
   * document names, and the receiving system would look it up and find something
   * else.
   */
  it('writes an uncoded substance as nullFlavor with the original text', () => {
    const section = sectionFor(tree(), SECTION_TEMPLATES.ALLERGIES.root);
    const entities = descendantsNamed(section, 'playingEntity');
    const uncoded = entities
      .map((entity) => childNamed(entity, 'code'))
      .find((code) => attr(code, 'nullFlavor') === 'OTH');

    expect(uncoded).toBeDefined();
    expect(textOf(childNamed(uncoded, 'originalText'))).toBe('Shellfish');
  });

  it('reads that substance back by its text', () => {
    const shellfish = roundTrip().allergies.find(
      (allergy) => allergy.substance.display === 'Shellfish'
    );

    expect(shellfish?.substance.code).toBeUndefined();
  });

  /**
   * A medication with no stop date is one the patient is still taking. CDA says
   * that with an open high; a closed span says it stopped, and an absent one
   * says nothing at all.
   */
  it('writes an open-ended span for a medication still being taken', () => {
    const section = sectionFor(tree(), SECTION_TEMPLATES.MEDICATIONS.root);
    const administration = descendantsNamed(section, 'substanceAdministration')[0];
    const high = childNamed(childNamed(administration, 'effectiveTime'), 'high');

    expect(attr(high, 'nullFlavor')).toBe('UNK');
  });

  /**
   * A receiving system trends a `PQ` and displays an `ST`. Writing "negative" as
   * a physical quantity produces a graph of nothing.
   */
  it('writes a numeric result as a quantity and a qualitative one as a string', () => {
    const section = sectionFor(tree(), SECTION_TEMPLATES.RESULTS.root);
    const values = descendantsNamed(section, 'value');

    const numeric = values.find((value) => attr(value, 'unit') === 'mmol/L');
    const qualitative = values.find((value) => textOf(value) === 'negative');

    expect(attr(numeric, 'xsi:type')).toBe('PQ');
    expect(attr(numeric, 'value')).toBe('6.2');
    expect(attr(qualitative, 'xsi:type')).toBe('ST');
  });

  /**
   * The mood code is the whole difference between "we did this" and "we intend
   * to". A plan written in the event mood tells the next clinician a
   * colonoscopy has already happened.
   */
  it('writes a planned activity in the intent mood', () => {
    const section = sectionFor(tree(), SECTION_TEMPLATES.PLAN_OF_TREATMENT.root);
    const act = descendantsNamed(section, 'act')[0];

    expect(attr(act, 'moodCode')).toBe('INT');
  });
});

describe('the narrative, which is what a clinician actually reads', () => {
  it('gives every section a table with a row per entry', () => {
    const document = tree();

    for (const [name, template] of Object.entries(SECTION_TEMPLATES)) {
      const section = sectionFor(document, template.root);
      const rows = descendantsNamed(section, 'tbody').flatMap((body) =>
        descendantsNamed(body, 'tr')
      );

      expect(rows.length, name).toBeGreaterThan(0);
    }
  });

  it('shows the values a clinician needs, not only the codes', () => {
    const section = sectionFor(tree(), SECTION_TEMPLATES.ALLERGIES.root);
    const text = textOf(childNamed(section, 'text'));

    expect(text).toContain('Penicillin');
    expect(text).toContain('Anaphylaxis');
    expect(text).toContain('2019-05-04');
  });

  it('draws an empty cell as a dash rather than leaving a hole in the table', () => {
    const section = sectionFor(tree(), SECTION_TEMPLATES.ALLERGIES.root);

    expect(textOf(childNamed(section, 'text'))).toContain('—');
  });

  it('links each entry to the row it is described by', () => {
    const section = sectionFor(tree(), SECTION_TEMPLATES.MEDICATIONS.root);
    const reference = attr(
      childNamed(
        childNamed(descendantsNamed(section, 'substanceAdministration')[0], 'text'),
        'reference'
      ),
      'value'
    );
    const rowIds = descendantsNamed(section, 'tr').map((row) => attr(row, 'ID'));

    expect(reference).toBe('#medication-1');
    expect(rowIds).toContain('medication-1');
  });
});

describe('a chart with nothing in it', () => {
  it('still writes every section, marked as holding no information', () => {
    const document = parseXml(generateCcd(emptyDocument()));

    for (const [name, template] of Object.entries(SECTION_TEMPLATES)) {
      const section = sectionFor(document, template.root);

      expect(attr(section, 'nullFlavor'), name).toBe('NI');
    }
  });

  /**
   * "This practice has no allergies recorded" and "this document does not cover
   * allergies" are different statements, and a receiving clinician acts
   * differently on them. Only one of the two is safe to act on.
   */
  it('says so in words, so the section is not blank to a person', () => {
    const document = parseXml(generateCcd(emptyDocument()));
    const section = sectionFor(document, SECTION_TEMPLATES.ALLERGIES.root);

    expect(textOf(childNamed(section, 'text'))).toBe('No known allergies recorded.');
  });

  it('round-trips to empty lists rather than to missing keys', () => {
    const parsed = parseCcd(generateCcd(emptyDocument()));

    expect(parsed.allergies).toEqual([]);
    expect(parsed.medications).toEqual([]);
    expect(parsed.socialHistory).toEqual([]);
  });
});

describe('a document from somebody else', () => {
  /**
   * Every document this codec will ever import was written by another vendor,
   * and the failure that makes an import feature unusable is refusing a whole
   * chart over one unfamiliar part of it.
   */
  it('reads a section that declares no template, by its LOINC code', () => {
    const xml = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <id root="other-1"/>
  <title>From Another System</title>
  <effectiveTime value="20260101000000+0000"/>
  <component><structuredBody>
    <component><section>
      <code code="11450-4" codeSystem="2.16.840.1.113883.6.1"/>
      <title>Problems</title>
      <entry><act classCode="ACT" moodCode="EVN">
        <id root="p-1"/>
        <statusCode code="active"/>
        <entryRelationship typeCode="SUBJ">
          <observation classCode="OBS" moodCode="EVN">
            <value xsi:type="CD" code="J45.909" codeSystem="2.16.840.1.113883.6.90" displayName="Asthma"/>
          </observation>
        </entryRelationship>
      </act></entry>
    </section></component>
  </structuredBody></component>
</ClinicalDocument>`;

    const parsed = parseCcd(xml);

    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]?.problem.display).toBe('Asthma');
    expect(parsed.problems[0]?.status).toBe('active');
  });

  it('returns empty lists for the sections such a document leaves out', () => {
    const xml = `<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="x"/></ClinicalDocument>`;

    const parsed = parseCcd(xml);

    expect(parsed.allergies).toEqual([]);
    expect(parsed.results).toEqual([]);
    expect(parsed.patient.mrn).toBe('');
  });

  /**
   * An entry whose substance cannot be read comes back named "Unknown" rather
   * than dropped or guessed. The person reconciling the import has to be able to
   * see which rows need checking.
   */
  it('names what it could not read rather than dropping the entry', () => {
    const xml = `<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="x"/>
  <component><structuredBody><component><section>
    <code code="48765-2" codeSystem="2.16.840.1.113883.6.1"/>
    <entry><act classCode="ACT" moodCode="EVN"><id root="a-1"/></act></entry>
  </section></component></structuredBody></component>
</ClinicalDocument>`;

    const parsed = parseCcd(xml);

    expect(parsed.allergies).toHaveLength(1);
    expect(parsed.allergies[0]?.substance.display).toBe('Unknown substance');
  });
});

/** Finds a section by template root, for assertions about what was written. */
function sectionFor(document: XmlElement, templateRoot: string): XmlElement {
  const sections = descendantsNamed(document, 'section');
  const found = sections.find((section) =>
    childrenNamed(section, 'templateId').some((node) => attr(node, 'root') === templateRoot)
  );
  if (found === undefined) throw new Error(`No section for template ${templateRoot}`);
  return found;
}

describe('a chart recorded with nothing optional filled in', () => {
  /**
   * Most of a document is optional fields, and the branch that handles an absent
   * one is the branch a tidy fixture never reaches. A practice that records a
   * name and nothing else is not an edge case; it is most of what a small clinic
   * holds.
   */
  it('round-trips every section without inventing anything', () => {
    const original = minimalDocument();

    const parsed = parseCcd(generateCcd(original));

    expect(parsed.allergies).toEqual(original.allergies);
    expect(parsed.medications).toEqual(original.medications);
    expect(parsed.problems).toEqual(original.problems);
    expect(parsed.results).toEqual(original.results);
    expect(parsed.vitals).toEqual(original.vitals);
    expect(parsed.immunisations).toEqual(original.immunisations);
    expect(parsed.encounters).toEqual(original.encounters);
    expect(parsed.plan).toEqual(original.plan);
    expect(parsed.socialHistory).toEqual(original.socialHistory);
  });

  it('round-trips a patient with no address, telephone or language', () => {
    const original = minimalDocument();

    const parsed = parseCcd(generateCcd(original));

    expect(parsed.patient).toEqual(original.patient);
    expect(parsed.custodian).toEqual(original.custodian);
    expect(parsed.author).toEqual(original.author);
    expect(parsed.coveringPeriod).toBeUndefined();
  });

  it('leaves out the elements it has nothing to put in', () => {
    const document = parseXml(generateCcd(minimalDocument()));
    const role = path(document, 'recordTarget', 'patientRole');

    expect(childNamed(role, 'addr')).toBeUndefined();
    expect(childrenNamed(role ?? document, 'telecom')).toHaveLength(0);
    expect(childNamed(document, 'documentationOf')).toBeUndefined();
  });
});

describe('a recorded sex, and the absence of one', () => {
  /**
   * `other` and `unknown` are different statements: one is an answer the
   * practice recorded, the other is the absence of one. Writing both as `UN`
   * loses that in the direction that matters - a receiving system reads a
   * recorded answer as a gap and goes asking for it again.
   */
  it('round-trips every value, keeping other apart from unknown', () => {
    for (const gender of ['male', 'female', 'other', 'unknown'] as const) {
      const document = { ...sampleDocument(), patient: { ...sampleDocument().patient, gender } };

      expect(parseCcd(generateCcd(document)).patient.gender, gender).toBe(gender);
    }
  });

  it('writes an unrecorded sex as a nullFlavor rather than as a code', () => {
    const document = {
      ...sampleDocument(),
      patient: { ...sampleDocument().patient, gender: 'unknown' as const },
    };

    const node = path(
      parseXml(generateCcd(document)),
      'recordTarget',
      'patientRole',
      'patient',
      'administrativeGenderCode'
    );

    expect(attr(node, 'nullFlavor')).toBe('UNK');
    expect(attr(node, 'code')).toBeUndefined();
  });

  it('writes a recorded other as the code that means it', () => {
    const document = {
      ...sampleDocument(),
      patient: { ...sampleDocument().patient, gender: 'other' as const },
    };

    const node = path(
      parseXml(generateCcd(document)),
      'recordTarget',
      'patientRole',
      'patient',
      'administrativeGenderCode'
    );

    expect(attr(node, 'code')).toBe('UN');
    expect(attr(node, 'nullFlavor')).toBeUndefined();
  });
});
