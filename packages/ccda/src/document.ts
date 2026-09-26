import type { CcdDocument, CodedValue } from './domain.js';
import { clinicalDocument, headerElements, readHeader } from './header.js';
import { renderSection } from './section.js';
import type { SectionSpec } from './section.js';
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
import { attr, childNamed, childrenNamed, element, isElement, path, textOf } from './xml/tree.js';
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
  return readCcd(parseXml(xml));
}

function readCcd(root: XmlElement): CcdDocument {
  if (root.name !== 'ClinicalDocument') {
    throw new CcdaError(`Expected a ClinicalDocument, found <${root.name}>`);
  }

  const sourceSections = sectionsOf(root);
  const selected = new Set<XmlElement>();
  const read = <T>(spec: SectionSpec<T>): T[] => {
    const section = preferredSection(sourceSections, descriptorFor(spec), selected);
    if (section === undefined) return [];
    selected.add(section);
    return spec.read(section);
  };

  return {
    ...readHeader(root),
    allergies: read(allergiesSection),
    medications: read(medicationsSection),
    problems: read(problemsSection),
    results: read(resultsSection),
    vitals: read(vitalsSection),
    immunisations: read(immunisationsSection),
    encounters: read(encountersSection),
    plan: read(planSection),
    socialHistory: read(socialHistorySection),
  };
}

export type CcdSectionName =
  | 'allergies'
  | 'medications'
  | 'problems'
  | 'results'
  | 'vitals'
  | 'immunisations'
  | 'encounters'
  | 'plan'
  | 'socialHistory';

export type CcdSectionStatus =
  'absent' | 'empty' | 'mapped' | 'partial' | 'rejected' | 'unsupported' | 'duplicate';

export interface CcdSectionPreview {
  readonly name: string;
  readonly title: string;
  readonly code?: string;
  readonly status: CcdSectionStatus;
  readonly sourceOffset?: number;
  readonly sourceEntries: number;
  readonly mappedEntries: number;
  readonly rejectedEntries: number;
}

export interface CcdPreviewRejection {
  readonly kind: 'section' | 'entry';
  readonly section: string;
  readonly reason: 'unsupported-section' | 'duplicate-section' | 'unmapped-entry';
  readonly sourceOffset?: number;
}

export interface CcdPreviewUnidentified {
  readonly section: CcdSectionName;
  readonly display: string;
  readonly sourceOffset?: number;
}

export interface CcdPreview {
  readonly document: CcdDocument;
  readonly sourceDocumentId: string;
  readonly patientMrnAuthority?: string;
  readonly patientBirthDatePrecision: number;
  readonly sections: readonly CcdSectionPreview[];
  readonly rejections: readonly CcdPreviewRejection[];
  readonly unidentified: readonly CcdPreviewUnidentified[];
  readonly totals: {
    readonly sourceSections: number;
    readonly supportedSections: number;
    readonly absentSections: number;
    readonly unsupportedSections: number;
    readonly duplicateSections: number;
    readonly sourceEntries: number;
    readonly mappedEntries: number;
    readonly rejectedEntries: number;
    readonly unidentifiedEntries: number;
  };
}

interface InspectedEntry {
  readonly unidentified: readonly string[];
}

interface SectionDescriptor {
  readonly name: CcdSectionName;
  readonly title: string;
  readonly code: string;
  readonly templateRoot: string;
  inspect(section: XmlElement): readonly InspectedEntry[];
}

function descriptor<T>(
  name: CcdSectionName,
  spec: {
    readonly title: string;
    readonly code: string;
    readonly template: { readonly root: string };
    read(section: XmlElement): T[];
  },
  codedValues: (entry: T) => readonly CodedValue[]
): SectionDescriptor {
  return {
    name,
    title: spec.title,
    code: spec.code,
    templateRoot: spec.template.root,
    inspect: (section) =>
      spec.read(section).map((entry) => ({
        unidentified: codedValues(entry)
          .filter((value) => value.code === undefined && isUnidentifiedDisplay(value.display))
          .map((value) => value.display),
      })),
  };
}

const SECTION_DESCRIPTORS: readonly SectionDescriptor[] = [
  descriptor('allergies', allergiesSection, (entry) => [entry.substance]),
  descriptor('medications', medicationsSection, (entry) => [entry.medication]),
  descriptor('problems', problemsSection, (entry) => [entry.problem]),
  descriptor('results', resultsSection, (entry) => [
    entry.panel,
    ...entry.observations.map((observation) => observation.code),
  ]),
  descriptor('vitals', vitalsSection, (entry) => [
    entry.panel,
    ...entry.observations.map((observation) => observation.code),
  ]),
  descriptor('immunisations', immunisationsSection, (entry) => [entry.vaccine]),
  descriptor('encounters', encountersSection, (entry) => [entry.type]),
  descriptor('plan', planSection, (entry) => [entry.activity]),
  descriptor('socialHistory', socialHistorySection, (entry) => [entry.observation, entry.value]),
];

const MISSING_CODE_FALLBACKS = new Set(['Encounter', 'Planned activity', 'Observation', 'Unknown']);

function isUnidentifiedDisplay(display: string): boolean {
  return display.startsWith('Unknown') || MISSING_CODE_FALLBACKS.has(display);
}

function descriptorFor<T>(spec: SectionSpec<T>): SectionDescriptor {
  const result = SECTION_DESCRIPTORS.find(
    (candidate) => candidate.templateRoot === spec.template.root
  );
  if (result === undefined) throw new CcdaError(`No preview descriptor for ${spec.title}`);
  return result;
}

/** Parses one document and accounts for every section and machine-readable entry. */
export function previewCcd(xml: string): CcdPreview {
  const root = parseXml(xml);
  const document = readCcd(root);
  const sourceSections = sectionsOf(root);
  const selected = new Set<XmlElement>();
  const sections: CcdSectionPreview[] = [];
  const rejections: CcdPreviewRejection[] = [];
  const unidentified: CcdPreviewUnidentified[] = [];

  for (const sectionDescriptor of SECTION_DESCRIPTORS) {
    const section = preferredSection(sourceSections, sectionDescriptor, selected);
    if (section === undefined) {
      sections.push({
        name: sectionDescriptor.name,
        title: sectionDescriptor.title,
        code: sectionDescriptor.code,
        status: 'absent',
        sourceEntries: 0,
        mappedEntries: 0,
        rejectedEntries: 0,
      });
      continue;
    }

    selected.add(section);
    sections.push(inspectSection(section, sectionDescriptor, rejections, unidentified));
  }

  for (const section of sourceSections) {
    if (selected.has(section)) continue;
    const matching = SECTION_DESCRIPTORS.find((candidate) => sectionMatches(section, candidate));
    const entries = childrenNamed(section, 'entry');
    const name = matching?.name ?? attr(childNamed(section, 'code'), 'code') ?? 'unsupported';
    const status = matching === undefined ? 'unsupported' : 'duplicate';
    sections.push({
      name,
      title: textOf(childNamed(section, 'title')) || matching?.title || 'Unsupported section',
      ...(attr(childNamed(section, 'code'), 'code') === undefined
        ? {}
        : { code: attr(childNamed(section, 'code'), 'code') }),
      status,
      ...(section.sourceOffset === undefined ? {} : { sourceOffset: section.sourceOffset }),
      sourceEntries: entries.length,
      mappedEntries: 0,
      rejectedEntries: entries.length,
    });
    rejections.push({
      kind: 'section',
      section: name,
      reason: matching === undefined ? 'unsupported-section' : 'duplicate-section',
      ...(section.sourceOffset === undefined ? {} : { sourceOffset: section.sourceOffset }),
    });
  }

  return {
    document,
    sourceDocumentId: compositeIdentifier(childNamed(root, 'id')),
    ...patientMrnAuthority(root),
    patientBirthDatePrecision:
      attr(path(root, 'recordTarget', 'patientRole', 'patient', 'birthTime'), 'value')?.length ?? 0,
    sections,
    rejections,
    unidentified,
    totals: {
      sourceSections: sourceSections.length,
      supportedSections: sections.filter((section) =>
        ['empty', 'mapped', 'partial', 'rejected'].includes(section.status)
      ).length,
      absentSections: sections.filter((section) => section.status === 'absent').length,
      unsupportedSections: sections.filter((section) => section.status === 'unsupported').length,
      duplicateSections: sections.filter((section) => section.status === 'duplicate').length,
      sourceEntries: sections.reduce((total, section) => total + section.sourceEntries, 0),
      mappedEntries: sections.reduce((total, section) => total + section.mappedEntries, 0),
      rejectedEntries: sections.reduce((total, section) => total + section.rejectedEntries, 0),
      unidentifiedEntries: unidentified.length,
    },
  };
}

function sectionsOf(root: XmlElement): XmlElement[] {
  const body = path(root, 'component', 'structuredBody');
  return childrenNamed(body, 'component')
    .map((component) => childNamed(component, 'section'))
    .filter((section): section is XmlElement => section !== undefined);
}

function preferredSection(
  sections: readonly XmlElement[],
  sectionDescriptor: SectionDescriptor,
  selected: ReadonlySet<XmlElement>
): XmlElement | undefined {
  return (
    sections.find(
      (section) =>
        !selected.has(section) &&
        childrenNamed(section, 'templateId').some(
          (template) => attr(template, 'root') === sectionDescriptor.templateRoot
        )
    ) ??
    sections.find(
      (section) =>
        !selected.has(section) &&
        attr(childNamed(section, 'code'), 'code') === sectionDescriptor.code
    )
  );
}

function patientMrnAuthority(root: XmlElement): { patientMrnAuthority?: string } {
  const ids = childrenNamed(path(root, 'recordTarget', 'patientRole'), 'id');
  const authority = attr(ids[1], 'root');
  return authority === undefined ? {} : { patientMrnAuthority: authority };
}

function compositeIdentifier(node: XmlElement | undefined): string {
  const root = attr(node, 'root') ?? '';
  const extension = attr(node, 'extension');
  return extension === undefined ? root : `${root}^${extension}`;
}

function sectionMatches(section: XmlElement, sectionDescriptor: SectionDescriptor): boolean {
  return (
    childrenNamed(section, 'templateId').some(
      (template) => attr(template, 'root') === sectionDescriptor.templateRoot
    ) || attr(childNamed(section, 'code'), 'code') === sectionDescriptor.code
  );
}

function inspectSection(
  section: XmlElement,
  sectionDescriptor: SectionDescriptor,
  rejections: CcdPreviewRejection[],
  unidentified: CcdPreviewUnidentified[]
): CcdSectionPreview {
  const entries = childrenNamed(section, 'entry');
  const nonEntries = section.children.filter(
    (child) => !isElement(child) || (child.name !== 'entry' && child.name !== 'text')
  );
  let mappedEntries = 0;
  let rejectedEntries = 0;

  for (const entry of entries) {
    const isolated = {
      ...section,
      children: [...nonEntries, entry],
    };
    const inspected = sectionDescriptor.inspect(isolated);
    if (inspected.length === 0) {
      rejectedEntries += 1;
      rejections.push({
        kind: 'entry',
        section: sectionDescriptor.name,
        reason: 'unmapped-entry',
        ...(entry.sourceOffset === undefined ? {} : { sourceOffset: entry.sourceOffset }),
      });
      continue;
    }

    mappedEntries += inspected.length;
    for (const result of inspected) {
      for (const display of result.unidentified) {
        unidentified.push({
          section: sectionDescriptor.name,
          display,
          ...(entry.sourceOffset === undefined ? {} : { sourceOffset: entry.sourceOffset }),
        });
      }
    }
  }

  const status: CcdSectionStatus =
    entries.length === 0
      ? 'empty'
      : rejectedEntries === 0
        ? 'mapped'
        : mappedEntries === 0
          ? 'rejected'
          : 'partial';
  return {
    name: sectionDescriptor.name,
    title: textOf(childNamed(section, 'title')) || sectionDescriptor.title,
    code: attr(childNamed(section, 'code'), 'code') ?? sectionDescriptor.code,
    status,
    ...(section.sourceOffset === undefined ? {} : { sourceOffset: section.sourceOffset }),
    sourceEntries: entries.length,
    mappedEntries,
    rejectedEntries,
  };
}

/** The parsed tree, for a caller that wants to inspect a document it did not write. */
export function parseDocumentTree(xml: string): XmlElement {
  return parseXml(xml);
}
