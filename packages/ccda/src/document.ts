import type { CcdDocument } from './domain.js';
import { clinicalDocument, headerElements, readHeader } from './header.js';
import { readSection, renderSection } from './section.js';
import { allergiesSection } from './sections/allergies.js';
import {
  encountersSection,
  immunisationsSection,
  planSection,
  socialHistorySection,
} from './sections/events.js';
import { medicationsSection } from './sections/medications.js';
import { problemsSection } from './sections/problems.js';
import { resultsSection, vitalsSection } from './sections/results.js';
import { CcdaError } from './xml/errors.js';
import { parseXml } from './xml/reader.js';
import { element } from './xml/tree.js';
import type { XmlElement } from './xml/tree.js';
import { renderDocument } from './xml/writer.js';

/**
 * GENERATE AND IMPORT, IN ONE FILE ON PURPOSE.
 *
 * The two directions have to agree about which sections exist and which key of
 * the document each one fills. Splitting them across two files is how a section
 * comes to be written and never read - a defect invisible from either side,
 * because the generator's tests pass and the parser's tests pass and nobody
 * wrote the one that goes out and back.
 *
 * The two lists below are written out rather than derived from a table, so the
 * compiler checks each pairing and a reader can hold both lists in view at once.
 * A generic table would have needed a cast per section to tie nine differently
 * typed specs to nine differently typed keys, and a cast is exactly the thing
 * that would stop the compiler noticing the mismatch these lists exist to
 * prevent. `ccda.test.ts` round-trips every section through both.
 */

/** Serialises a document to C-CDA R2.1 XML. */
export function generateCcd(document: CcdDocument): string {
  return renderDocument(
    clinicalDocument([
      ...headerElements(document),
      element('component', {}, [
        element('structuredBody', {}, [
          renderSection(allergiesSection, document.allergies),
          renderSection(medicationsSection, document.medications),
          renderSection(problemsSection, document.problems),
          renderSection(resultsSection, document.results),
          renderSection(vitalsSection, document.vitals),
          renderSection(immunisationsSection, document.immunisations),
          renderSection(encountersSection, document.encounters),
          renderSection(planSection, document.plan),
          renderSection(socialHistorySection, document.socialHistory),
        ]),
      ]),
    ])
  );
}

/**
 * Reads a C-CDA back into the same shape.
 *
 * Lenient about what it accepts and strict about what it claims. A section that
 * is absent, empty, or written by a generator this codec has never seen yields
 * an empty list rather than an exception: refusing a whole chart because one
 * section was unfamiliar is what makes an import feature unusable in the field,
 * where every document comes from a different vendor.
 *
 * What it will not do is guess. An entry it cannot read a substance or a
 * medication out of comes back with an explicit "Unknown" display rather than a
 * plausible one, because the person reconciling the import needs to see which
 * rows to check.
 */
export function parseCcd(xml: string): CcdDocument {
  const root = parseXml(xml);
  if (root.name !== 'ClinicalDocument') {
    throw new CcdaError(`Expected a ClinicalDocument, found <${root.name}>`);
  }

  return {
    ...readHeader(root),
    allergies: readSection(root, allergiesSection),
    medications: readSection(root, medicationsSection),
    problems: readSection(root, problemsSection),
    results: readSection(root, resultsSection),
    vitals: readSection(root, vitalsSection),
    immunisations: readSection(root, immunisationsSection),
    encounters: readSection(root, encountersSection),
    plan: readSection(root, planSection),
    socialHistory: readSection(root, socialHistorySection),
  };
}

/** The parsed tree, for a caller that wants to inspect a document it did not write. */
export function parseDocumentTree(xml: string): XmlElement {
  return parseXml(xml);
}
