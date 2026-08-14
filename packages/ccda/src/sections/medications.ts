import {
  codedValue,
  effectiveTime,
  id,
  readCodedValue,
  readStatus,
  statusCode,
  templateId,
} from '../datatypes.js';
import type { MedicationEntry } from '../domain.js';
import { narrativeReference, referencedCell } from '../narrative.js';
import { ENTRY_TEMPLATES, SECTION_TEMPLATES } from '../oids.js';
import { entryStatements, type SectionSpec } from '../section.js';
import { fromHl7, readableDate } from '../time.js';
import { attr, childNamed, descendantsNamed, element } from '../xml/tree.js';
import type { XmlElement } from '../xml/tree.js';

/**
 * MEDICATIONS.
 *
 * A `substanceAdministration` per medication, with the product inside a
 * `consumable`.
 *
 * The effective time is a span with an open high when the medication has no stop
 * date, which is CDA's way of saying the patient is still taking it. Writing a
 * closed span, or omitting the element, both say something else.
 *
 * The instruction itself has no coded home in CDA - `doseQuantity`, `routeCode`
 * and a timing `effectiveTime` between them express a structured sig, and this
 * chart holds one sentence rather than those fields. So the sentence goes in the
 * narrative, where the specification puts what it cannot code, and the entry
 * references the row it is on. That is what makes it survive a round trip.
 */
export const medicationsSection: SectionSpec<MedicationEntry> = {
  template: SECTION_TEMPLATES.MEDICATIONS,
  code: '10160-0',
  display: 'History of medication use',
  title: 'Medications',
  columns: ['Medication', 'Instructions', 'Status', 'Started', 'Stopped'],
  idPrefix: 'medication',
  emptyText: 'No medications recorded.',

  row: (entry) => [
    entry.medication.display,
    entry.sig ?? '',
    entry.status,
    readableDate(entry.startDate),
    readableDate(entry.endDate),
  ],

  entry: (value, index) => {
    const children: XmlElement[] = [
      templateId(ENTRY_TEMPLATES.MEDICATION_ACTIVITY),
      id(value.id),
      narrativeReference('medication', index),
      statusCode(value.status),
    ];

    const time = effectiveTime(value.startDate, value.endDate, { openEnded: true });
    if (time !== undefined) children.push(time);

    children.push(
      element('consumable', {}, [
        element('manufacturedProduct', { classCode: 'MANU' }, [
          templateId({ root: '2.16.840.1.113883.10.20.22.4.23', extension: '2014-06-09' }),
          element('manufacturedMaterial', {}, [codedValue('code', value.medication)]),
        ]),
      ])
    );

    return element('substanceAdministration', { classCode: 'SBADM', moodCode: 'EVN' }, children);
  },

  read: (section) =>
    entryStatements(section, 'substanceAdministration').map((administration) => {
      const material = descendantsNamed(administration, 'manufacturedMaterial')[0];
      const medication = readCodedValue(childNamed(material, 'code'));
      // The sig has no coded home in CDA, so it lives in the narrative and the
      // entry points at it - column 1 of the row this administration references.
      const sig = referencedCell(section, administration, 1);
      const time = childNamed(administration, 'effectiveTime');
      const start = fromHl7(attr(childNamed(time, 'low'), 'value') ?? attr(time, 'value'));
      const end = fromHl7(attr(childNamed(time, 'high'), 'value'));

      return {
        id: attr(childNamed(administration, 'id'), 'root') ?? '',
        medication: medication ?? { display: 'Unknown medication' },
        ...(sig === undefined ? {} : { sig }),
        status: readStatus(administration, 'active'),
        ...(start === undefined ? {} : { startDate: start.slice(0, 10) }),
        ...(end === undefined ? {} : { endDate: end.slice(0, 10) }),
      } satisfies MedicationEntry;
    }),
};
