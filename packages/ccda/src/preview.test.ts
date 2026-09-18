import { describe, expect, it } from 'vitest';

import { emptyDocument, sampleDocument } from './__fixtures__/document.js';
import { generateCcd, previewCcd } from './document.js';

describe('a C-CDA migration preview', () => {
  it('reconciles every entry in the documented fixture', () => {
    const document = sampleDocument();
    const preview = previewCcd(generateCcd(document));
    const expectedEntries =
      document.allergies.length +
      document.medications.length +
      document.problems.length +
      document.results.length +
      document.vitals.length +
      document.immunisations.length +
      document.encounters.length +
      document.plan.length +
      document.socialHistory.length;

    expect(preview.document).toEqual(document);
    expect(preview.totals).toEqual({
      sourceSections: 9,
      supportedSections: 9,
      absentSections: 0,
      unsupportedSections: 0,
      duplicateSections: 0,
      sourceEntries: expectedEntries,
      mappedEntries: expectedEntries,
      rejectedEntries: 0,
      unidentifiedEntries: 0,
    });
    expect(preview.sections.every((section) => section.status === 'mapped')).toBe(true);
    expect(preview.rejections).toEqual([]);
  });

  it('distinguishes a supported empty section from one the source omitted', () => {
    const empty = previewCcd(generateCcd(emptyDocument()));
    const omitted = previewCcd(
      '<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="doc-1"/></ClinicalDocument>'
    );

    expect(empty.sections.every((section) => section.status === 'empty')).toBe(true);
    expect(empty.totals).toMatchObject({ supportedSections: 9, absentSections: 0 });
    expect(omitted.sections.every((section) => section.status === 'absent')).toBe(true);
    expect(omitted.totals).toMatchObject({ supportedSections: 0, absentSections: 9 });
  });

  it('accounts for unsupported, unidentified and structurally unmapped entries by source offset', () => {
    const source = `<ClinicalDocument xmlns="urn:hl7-org:v3">
  <id root="doc-1"/>
  <component><structuredBody>
    <component><section>
      <code code="48765-2" codeSystem="2.16.840.1.113883.6.1"/>
      <title>Allergies</title>
      <entry><observation classCode="OBS" moodCode="EVN"><id root="wrong-shape"/></observation></entry>
      <entry><act classCode="ACT" moodCode="EVN"><id root="unknown-substance"/></act></entry>
    </section></component>
    <component><section>
      <code code="99999-9" codeSystem="2.16.840.1.113883.6.1"/>
      <title>Unsupported history</title>
      <entry><act/></entry>
      <entry><act/></entry>
    </section></component>
  </structuredBody></component>
</ClinicalDocument>`;
    const preview = previewCcd(source);
    const entryOffsets = [...source.matchAll(/<entry>/g)].map((match) => match.index);
    const unsupportedOffset = source.indexOf('<section>', source.indexOf('99999-9') - 80);

    expect(preview.totals).toEqual({
      sourceSections: 2,
      supportedSections: 1,
      absentSections: 8,
      unsupportedSections: 1,
      duplicateSections: 0,
      sourceEntries: 4,
      mappedEntries: 1,
      rejectedEntries: 3,
      unidentifiedEntries: 1,
    });
    expect(preview.sections.find((section) => section.name === 'allergies')).toMatchObject({
      status: 'partial',
      sourceEntries: 2,
      mappedEntries: 1,
      rejectedEntries: 1,
    });
    expect(preview.sections.find((section) => section.code === '99999-9')).toMatchObject({
      status: 'unsupported',
      sourceOffset: unsupportedOffset,
      rejectedEntries: 2,
    });
    expect(preview.rejections).toEqual([
      {
        kind: 'entry',
        section: 'allergies',
        reason: 'unmapped-entry',
        sourceOffset: entryOffsets[0],
      },
      {
        kind: 'section',
        section: '99999-9',
        reason: 'unsupported-section',
        sourceOffset: unsupportedOffset,
      },
    ]);
    expect(preview.unidentified).toEqual([
      {
        section: 'allergies',
        display: 'Unknown substance',
        sourceOffset: entryOffsets[1],
      },
    ]);
  });

  it('reports a second recognised section as a rejected duplicate', () => {
    const source = `<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="doc-1"/>
      <component><structuredBody>
        <component><section><code code="11450-4"/><entry><act/></entry></section></component>
        <component><section><code code="11450-4"/><entry><act/></entry></section></component>
      </structuredBody></component>
    </ClinicalDocument>`;
    const preview = previewCcd(source);

    expect(preview.totals).toMatchObject({ duplicateSections: 1, rejectedEntries: 1 });
    expect(preview.sections.filter((section) => section.name === 'problems')).toEqual([
      expect.objectContaining({ status: 'mapped' }),
      expect.objectContaining({ status: 'duplicate' }),
    ]);
    expect(preview.rejections).toContainEqual(
      expect.objectContaining({
        kind: 'section',
        section: 'problems',
        reason: 'duplicate-section',
      })
    );
  });
});
