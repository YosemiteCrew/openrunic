import { templateId } from './datatypes.js';
import { narrative } from './narrative.js';
import { CODE_SYSTEMS, type TemplateId } from './oids.js';
import { attr, childNamed, childrenNamed, element, type XmlElement } from './xml/tree.js';

/**
 * ONE SECTION, DESCRIBED ONCE.
 *
 * Nine sections differ in four things: which template they declare, which LOINC
 * code names them, what a row of their narrative table looks like, and what one
 * coded entry contains. Everything else - the `<component><section>` wrapper,
 * the title, the narrative, the empty-section handling, finding the section
 * again when parsing - is identical, and writing it nine times is nine chances
 * for one section to be subtly different from the rest.
 *
 * So a section supplies only its four differences and this file does the rest,
 * in both directions. The generator and the parser then cannot disagree about
 * where a section lives or how it is recognised, because they read the same spec.
 */

export interface SectionSpec<T> {
  readonly template: TemplateId;
  /** LOINC code identifying the section. */
  readonly code: string;
  readonly display: string;
  readonly title: string;
  readonly columns: readonly string[];
  /** Prefix for the narrative row ids: `allergy`, `medication`, and so on. */
  readonly idPrefix: string;
  /** What is shown when the practice has nothing recorded. */
  readonly emptyText: string;
  row(entry: T): readonly string[];
  /** The coded entry, or undefined for an entry that cannot be coded. */
  entry(value: T, index: number): XmlElement | undefined;
  /** Reads every entry back out of a parsed section. */
  read(section: XmlElement): T[];
}

/**
 * Builds `<component><section>...</section></component>`.
 *
 * An empty section is written rather than omitted, carrying
 * `nullFlavor="NI"` - no information. The distinction matters clinically:
 * a document with no allergies section says nothing about allergies, and a
 * document with an empty one says this practice has none recorded. A receiving
 * clinician acts differently on those two, and only one of them is safe to act on.
 */
export function renderSection<T>(spec: SectionSpec<T>, entries: readonly T[]): XmlElement {
  const children: XmlElement[] = [
    templateId(spec.template),
    element('code', {
      code: spec.code,
      codeSystem: CODE_SYSTEMS.LOINC.oid,
      codeSystemName: CODE_SYSTEMS.LOINC.name,
      displayName: spec.display,
    }),
    element('title', {}, [spec.title]),
    narrative(
      {
        columns: spec.columns,
        rows: entries.map((entry) => spec.row(entry)),
        emptyText: spec.emptyText,
      },
      spec.idPrefix
    ),
  ];

  for (const [index, value] of entries.entries()) {
    const entry = spec.entry(value, index);
    if (entry !== undefined) children.push(element('entry', {}, [entry]));
  }

  return element('component', {}, [
    element('section', entries.length === 0 ? { nullFlavor: 'NI' } : {}, children),
  ]);
}

/**
 * Finds a section in a parsed document.
 *
 * By template id first, because that is the identity the specification gives a
 * section, and by LOINC code second, because documents in the field are written
 * by generators that get the template extension wrong or omit the template
 * entirely. Refusing those would mean refusing to import from real systems over
 * a version suffix.
 */
export function findSection<T>(root: XmlElement, spec: SectionSpec<T>): XmlElement | undefined {
  const body = childNamed(childNamed(root, 'component'), 'structuredBody');
  if (body === undefined) return undefined;

  const sections = childrenNamed(body, 'component')
    .map((component) => childNamed(component, 'section'))
    .filter((section): section is XmlElement => section !== undefined);

  return (
    sections.find((section) =>
      childrenNamed(section, 'templateId').some((node) => attr(node, 'root') === spec.template.root)
    ) ?? sections.find((section) => attr(childNamed(section, 'code'), 'code') === spec.code)
  );
}

/** Every entry a section carries, read through its own spec. */
export function readSection<T>(root: XmlElement, spec: SectionSpec<T>): T[] {
  const section = findSection(root, spec);
  return section === undefined ? [] : spec.read(section);
}

/** The `<entry>` children of a section, unwrapped to the statement inside each. */
export function entryStatements(section: XmlElement, name: string): XmlElement[] {
  return childrenNamed(section, 'entry')
    .map((entry) => childNamed(entry, name))
    .filter((statement): statement is XmlElement => statement !== undefined);
}
