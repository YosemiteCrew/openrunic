import { describe, expect, it } from 'vitest';

import { parseCcd, parseDocumentTree } from './document.js';
import { narrative, narrativeReference, referencedCell, referencedRow } from './narrative.js';
import { findSection, renderSection } from './section.js';
import { allergiesSection } from './sections/allergies.js';
import { medicationsSection } from './sections/medications.js';
import { childNamed, element, textOf } from './xml/tree.js';

/**
 * What a document from another vendor does to the parser.
 *
 * Every import this codec will ever handle was written by somebody else's
 * generator, and those omit things: an entry with no id, a section with no
 * narrative, a reference pointing at a row that is not there. None of those is a
 * reason to lose a chart, so each has to come back as an absent field rather
 * than as an exception or an invention.
 */

/** Wraps sections in the smallest document the parser will accept. */
function documentWith(sections: string): string {
  return `<ClinicalDocument xmlns="urn:hl7-org:v3">
  <id root="doc-1"/>
  <component><structuredBody>${sections}</structuredBody></component>
</ClinicalDocument>`;
}

describe('entries missing the parts a generator usually writes', () => {
  it('reads an allergy with no id, no status and no dates', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="48765-2" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><act classCode="ACT" moodCode="EVN">
          <entryRelationship typeCode="SUBJ"><observation classCode="OBS" moodCode="EVN">
            <participant typeCode="CSM"><participantRole classCode="MANU"><playingEntity classCode="MMAT">
              <code code="7980" codeSystem="2.16.840.1.113883.6.88" displayName="Penicillin"/>
            </playingEntity></participantRole></participant>
          </observation></entryRelationship>
        </act></entry>
      </section></component>`)
    );

    expect(parsed.allergies).toEqual([
      {
        id: '',
        substance: { code: '7980', codeSystem: '2.16.840.1.113883.6.88', display: 'Penicillin' },
        status: 'active',
      },
    ]);
  });

  it('reads a medication with no consumable at all', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="10160-0" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><substanceAdministration classCode="SBADM" moodCode="EVN">
          <id root="m-1"/>
        </substanceAdministration></entry>
      </section></component>`)
    );

    expect(parsed.medications[0]?.medication.display).toBe('Unknown medication');
    expect(parsed.medications[0]?.sig).toBeUndefined();
  });

  it('reads a medication whose span is a single instant rather than a range', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="10160-0" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><substanceAdministration classCode="SBADM" moodCode="EVN">
          <id root="m-1"/>
          <effectiveTime value="20260201"/>
        </substanceAdministration></entry>
      </section></component>`)
    );

    expect(parsed.medications[0]?.startDate).toBe('2026-02-01');
    expect(parsed.medications[0]?.endDate).toBeUndefined();
  });

  it('reads a problem with no observation inside the concern', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="11450-4" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><act classCode="ACT" moodCode="EVN"><id root="p-1"/></act></entry>
      </section></component>`)
    );

    expect(parsed.problems[0]?.problem.display).toBe('Unknown problem');
  });

  it('reads a result organiser with no observations and no time', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="30954-2" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><organizer classCode="BATTERY" moodCode="EVN"><id root="r-1"/></organizer></entry>
      </section></component>`)
    );

    expect(parsed.results[0]).toEqual({
      id: 'r-1',
      panel: { display: 'Unknown panel' },
      observations: [],
    });
  });

  it('reads an organiser whose time is written as a span', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="30954-2" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><organizer classCode="BATTERY" moodCode="EVN">
          <id root="r-1"/>
          <effectiveTime><low value="20260701100000+0000"/></effectiveTime>
        </organizer></entry>
      </section></component>`)
    );

    expect(parsed.results[0]?.effectiveAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('reads an encounter with no facility and no end', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="46240-8" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><encounter classCode="ENC" moodCode="EVN">
          <id root="e-1"/>
          <effectiveTime value="20260814090000+0000"/>
        </encounter></entry>
      </section></component>`)
    );

    expect(parsed.encounters[0]).toEqual({
      id: 'e-1',
      type: { display: 'Encounter' },
      startedAt: '2026-08-14T09:00:00.000Z',
    });
  });

  it('reads an immunisation and a plan item with nothing but an id', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="11369-6" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><substanceAdministration classCode="SBADM" moodCode="EVN"><id root="i-1"/></substanceAdministration></entry>
      </section></component>
      <component><section>
        <code code="18776-5" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><act classCode="ACT" moodCode="INT"><id root="pl-1"/></act></entry>
      </section></component>
      <component><section>
        <code code="29762-2" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><observation classCode="OBS" moodCode="EVN"><id root="s-1"/></observation></entry>
      </section></component>`)
    );

    expect(parsed.immunisations[0]?.vaccine.display).toBe('Unknown vaccine');
    expect(parsed.immunisations[0]?.lotNumber).toBeUndefined();
    expect(parsed.plan[0]?.activity.display).toBe('Planned activity');
    expect(parsed.socialHistory[0]?.value.display).toBe('Unknown');
  });

  it('reads an encounter with no effective time at all', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="46240-8" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><encounter classCode="ENC" moodCode="EVN"><id root="e-1"/></encounter></entry>
      </section></component>`)
    );

    expect(parsed.encounters[0]?.startedAt).toBe('');
  });

  it('ignores an entry whose statement is not the one the section expects', () => {
    const parsed = parseCcd(
      documentWith(`<component><section>
        <code code="48765-2" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><observation classCode="OBS" moodCode="EVN"><id root="x"/></observation></entry>
      </section></component>`)
    );

    expect(parsed.allergies).toEqual([]);
  });
});

describe('the narrative, read back', () => {
  it('finds the row an entry points at', () => {
    const section = childNamed(
      renderSection(medicationsSection, [
        { id: 'm-1', medication: { display: 'Aspirin' }, sig: 'One daily', status: 'active' },
      ]),
      'section'
    );
    const statement = childNamed(childNamed(section, 'entry'), 'substanceAdministration');

    expect(referencedRow(section ?? element('x'), statement ?? element('x'))).toEqual([
      'Aspirin',
      'One daily',
      'active',
      '',
      '',
    ]);
  });

  it('reads an empty cell back as empty rather than as an em dash', () => {
    const section = childNamed(
      renderSection(medicationsSection, [
        { id: 'm-1', medication: { display: 'Aspirin' }, status: 'active' },
      ]),
      'section'
    );
    const statement = childNamed(childNamed(section, 'entry'), 'substanceAdministration');

    expect(referencedCell(section ?? element('x'), statement ?? element('x'), 1)).toBeUndefined();
  });

  it('finds nothing when the entry carries no reference', () => {
    const section = element('section', {}, [element('text')]);

    expect(referencedRow(section, element('act'))).toBeUndefined();
  });

  it('finds nothing when the reference names a row that is not there', () => {
    const section = element('section', {}, [
      narrative({ columns: [], rows: [], emptyText: 'x' }, 'a'),
    ]);
    const statement = element('act', {}, [narrativeReference('a', 0)]);

    expect(referencedRow(section, statement)).toBeUndefined();
  });

  it('finds nothing when the reference is not a fragment', () => {
    const statement = element('act', {}, [
      element('text', {}, [element('reference', { value: 'http://example.invalid/x' })]),
    ]);

    expect(referencedRow(element('section'), statement)).toBeUndefined();
  });
});

describe('finding a section at all', () => {
  it('finds nothing in a document with no structured body', () => {
    const root = parseDocumentTree(
      '<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="x"/></ClinicalDocument>'
    );

    expect(findSection(root, allergiesSection)).toBeUndefined();
  });

  it('finds nothing when no section matches by template or by code', () => {
    const root = parseDocumentTree(
      documentWith(`<component><section><code code="99999-9"/></section></component>`)
    );

    expect(findSection(root, allergiesSection)).toBeUndefined();
  });

  it('prefers the template over the code when both are present', () => {
    const root = parseDocumentTree(
      documentWith(
        `<component><section><code code="48765-2" codeSystem="2.16.840.1.113883.6.1"/><title>By code</title></section></component>` +
          `<component><section><templateId root="2.16.840.1.113883.10.20.22.2.6.1"/><title>By template</title></section></component>`
      )
    );

    expect(textOf(childNamed(findSection(root, allergiesSection), 'title'))).toBe('By template');
  });
});
