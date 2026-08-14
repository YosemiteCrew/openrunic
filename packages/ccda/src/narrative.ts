import { attr, childNamed, descendantsNamed, element, textOf } from './xml/tree.js';
import type { XmlElement } from './xml/tree.js';

/**
 * THE NARRATIVE BLOCK, AND WHY IT IS NOT DECORATION.
 *
 * Every CDA section carries two representations of the same information: coded
 * entries for a machine, and a `<text>` block for a person. The specification is
 * explicit that the narrative is the attested content - it is what a clinician
 * is deemed to have read - and in practice it is what a receiving system
 * displays whenever it cannot map an entry, which is often.
 *
 * A generated document with an empty narrative therefore looks complete, passes
 * schema validation, and shows a clinician nothing. That failure is silent at
 * both ends: the sender sees entries, the receiver sees a blank section, and
 * nobody finds out until somebody asks why the allergy list was empty.
 *
 * So the narrative is generated from the same data as the entries, in one pass,
 * and every section renders it through this builder. Entries and narrative
 * cannot drift when neither is written by hand.
 *
 * It also carries real information back. Some of what a chart holds has no coded
 * home in CDA - a free-text sig, a reference range as written by the laboratory -
 * and the specification's answer is that it lives in the narrative and the entry
 * points at it. So an entry's `<text><reference value="#row-3"/></text>` is
 * resolved on the way back in, and the row it names is where those values come
 * from. That is the mechanism CDA defines, rather than a convention invented
 * here.
 */

export interface NarrativeTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Shown in place of the table when there are no rows. */
  readonly emptyText: string;
}

/** Renders `<text>`, one row per entry, each row addressable by id. */
export function narrative(table: NarrativeTable, idPrefix: string): XmlElement {
  if (table.rows.length === 0) {
    return element('text', {}, [element('paragraph', {}, [table.emptyText])]);
  }

  const head = element('thead', {}, [
    element(
      'tr',
      {},
      table.columns.map((column) => element('th', {}, [column]))
    ),
  ]);

  const body = element(
    'tbody',
    {},
    table.rows.map((row, index) =>
      element(
        'tr',
        { ID: rowId(idPrefix, index) },
        row.map((cell) =>
          // An empty cell still gets an em dash. A blank one reads as a
          // rendering fault to anybody looking at the table, and the whole point
          // of the narrative is that a person is looking at it.
          element('td', {}, [cell === '' ? EMPTY_CELL : cell])
        )
      )
    )
  );

  return element('text', {}, [element('table', { border: '1', width: '100%' }, [head, body])]);
}

/** What an empty cell is drawn as, and therefore what to read back as absent. */
const EMPTY_CELL = '—';

export function rowId(idPrefix: string, index: number): string {
  return `${idPrefix}-${index + 1}`;
}

/** The `<text><reference value="#..."/></text>` an entry uses to point at its row. */
export function narrativeReference(idPrefix: string, index: number): XmlElement {
  return element('text', {}, [element('reference', { value: `#${rowId(idPrefix, index)}` })]);
}

/**
 * The narrative row an entry points at, cell by cell.
 *
 * Undefined when the entry carries no reference, when the reference names a row
 * that is not there, or when the section has no table - all three of which are
 * ordinary in a document from another vendor, and none of which is a reason to
 * refuse the entry itself.
 */
export function referencedRow(
  section: XmlElement,
  statement: XmlElement
): readonly string[] | undefined {
  const reference = attr(childNamed(childNamed(statement, 'text'), 'reference'), 'value');
  if (reference === undefined || !reference.startsWith('#')) return undefined;

  const target = reference.slice(1);
  const row = descendantsNamed(section, 'tr').find((node) => attr(node, 'ID') === target);
  if (row === undefined) return undefined;

  return descendantsNamed(row, 'td').map((cell) => {
    const text = textOf(cell);
    return text === EMPTY_CELL ? '' : text;
  });
}

/** One cell of the referenced row, or undefined when it was empty or absent. */
export function referencedCell(
  section: XmlElement,
  statement: XmlElement,
  column: number
): string | undefined {
  const value = referencedRow(section, statement)?.[column];
  return value === undefined || value === '' ? undefined : value;
}
