import {
  codedValue,
  effectiveTime,
  id,
  readCodedValue,
  templateId,
  writeTime,
} from '../datatypes.js';
import type { ObservationEntry, ResultEntry } from '../domain.js';
import { narrativeReference, referencedCell } from '../narrative.js';
import { CODE_SYSTEMS, ENTRY_TEMPLATES, type TemplateId } from '../oids.js';
import { entryStatements, type SectionSpec } from '../section.js';
import { fromHl7, readableDate } from '../time.js';
import { attr, childNamed, childrenNamed, element, textOf } from '../xml/tree.js';
import type { XmlElement } from '../xml/tree.js';

/**
 * RESULTS AND VITAL SIGNS, WHICH ARE THE SAME SHAPE.
 *
 * Both are an organiser holding observations: a laboratory panel holds its
 * analytes, a set of vitals holds the readings taken at one moment. CDA models
 * them identically and differs only in which templates and codes they declare,
 * so they are built by one factory here rather than by two files that would
 * drift.
 *
 * The measured value is written as `PQ` when it has a unit and `ST` when it does
 * not. That is not cosmetic: a receiving system trends a `PQ` and displays an
 * `ST`, so writing "negative" as a physical quantity produces a graph of
 * nothing, and writing 6.2 mmol/L as a string produces a number nobody can plot.
 *
 * The reference range has no coded home this chart can fill - CDA models it as
 * an `observationRange` with its own value and unit, and what the laboratory
 * sends us is one string - so it travels in the narrative, and the observation
 * points at the row. Same mechanism as the medication sig, same reason.
 */

interface OrganiserSpec {
  readonly template: TemplateId;
  readonly sectionTemplate: TemplateId;
  readonly organiserTemplate: TemplateId;
  readonly observationTemplate: TemplateId;
  readonly code: string;
  readonly display: string;
  readonly title: string;
  readonly idPrefix: string;
  readonly emptyText: string;
}

export function organiserSection(spec: OrganiserSpec): SectionSpec<ResultEntry> {
  return {
    template: spec.sectionTemplate,
    code: spec.code,
    display: spec.display,
    title: spec.title,
    columns: ['Panel', 'Test', 'Result', 'Reference range', 'Date'],
    idPrefix: spec.idPrefix,
    emptyText: spec.emptyText,

    // One row per organiser, listing its observations. A row per observation
    // would read better and would break the entry-to-row reference, which is
    // one per entry by construction.
    row: (entry) => [
      entry.panel.display,
      entry.observations.map((observation) => observation.code.display).join('; '),
      entry.observations.map(describeValue).join('; '),
      entry.observations.map((observation) => observation.referenceRange ?? '').join('; '),
      readableDate(entry.effectiveAt),
    ],

    entry: (value, index) => {
      const children: XmlElement[] = [
        templateId(spec.organiserTemplate),
        id(value.id),
        codedValue('code', value.panel),
        element('statusCode', { code: 'completed' }),
        narrativeReference(spec.idPrefix, index),
      ];

      const time = effectiveTime(value.effectiveAt);
      if (time !== undefined) children.push(time);

      for (const observation of value.observations) {
        children.push(
          element('component', {}, [
            element(
              'observation',
              { classCode: 'OBS', moodCode: 'EVN' },
              observationElement(observation, spec.observationTemplate)
            ),
          ])
        );
      }

      return element('organizer', { classCode: 'BATTERY', moodCode: 'EVN' }, children);
    },

    read: (section) =>
      entryStatements(section, 'organizer').map((organiser) => {
        const panel = readCodedValue(childNamed(organiser, 'code'));
        const ranges = (referencedCell(section, organiser, 3) ?? '')
          .split(';')
          .map((part) => part.trim());

        return {
          id: attr(childNamed(organiser, 'id'), 'root') ?? '',
          panel: panel ?? { display: 'Unknown panel' },
          ...timeOf(organiser),
          observations: childrenNamed(organiser, 'component')
            .map((component) => childNamed(component, 'observation'))
            .filter((observation): observation is XmlElement => observation !== undefined)
            .map((observation, index) => readObservation(observation, ranges[index])),
        } satisfies ResultEntry;
      }),
  };
}

/** "6.2 mmol/L", "negative", or nothing at all. */
function describeValue(observation: ObservationEntry): string {
  if (observation.value === undefined) return '';
  return observation.unit === undefined
    ? observation.value
    : `${observation.value} ${observation.unit}`;
}

function observationElement(observation: ObservationEntry, template: TemplateId): XmlElement[] {
  const children: XmlElement[] = [
    templateId(template),
    id(observation.id),
    codedValue('code', observation.code),
    element('statusCode', { code: 'completed' }),
  ];

  if (observation.effectiveAt !== undefined) {
    children.push(element('effectiveTime', { value: writeTime(observation.effectiveAt) }));
  }

  if (observation.value !== undefined) {
    children.push(
      observation.unit === undefined
        ? element('value', { 'xsi:type': 'ST' }, [observation.value])
        : element('value', {
            'xsi:type': 'PQ',
            value: observation.value,
            unit: observation.unit,
          })
    );
  }

  if (observation.interpretation !== undefined) {
    children.push(
      element('interpretationCode', {
        code: observation.interpretation,
        codeSystem: CODE_SYSTEMS.OBSERVATION_INTERPRETATION.oid,
        codeSystemName: CODE_SYSTEMS.OBSERVATION_INTERPRETATION.name,
      })
    );
  }

  return children;
}

function readObservation(node: XmlElement, referenceRange: string | undefined): ObservationEntry {
  const value = childNamed(node, 'value');
  const quantity = attr(value, 'value');
  const text = textOf(value);
  const effective = fromHl7(attr(childNamed(node, 'effectiveTime'), 'value'));
  const interpretation = attr(childNamed(node, 'interpretationCode'), 'code');
  const unit = attr(value, 'unit');

  return {
    id: attr(childNamed(node, 'id'), 'root') ?? '',
    code: readCodedValue(childNamed(node, 'code')) ?? { display: 'Unknown observation' },
    // A `PQ` carries its number in `@value`; an `ST` carries it as text. Reading
    // both the same way would turn every string result into an empty one.
    ...(quantity === undefined ? (text === '' ? {} : { value: text }) : { value: quantity }),
    ...(unit === undefined ? {} : { unit }),
    ...(effective === undefined ? {} : { effectiveAt: effective }),
    ...(interpretation === undefined ? {} : { interpretation }),
    ...(referenceRange === undefined || referenceRange === '' ? {} : { referenceRange }),
  };
}

function timeOf(organiser: XmlElement): { effectiveAt?: string } {
  const time = childNamed(organiser, 'effectiveTime');
  const value = fromHl7(attr(time, 'value') ?? attr(childNamed(time, 'low'), 'value'));
  return value === undefined ? {} : { effectiveAt: value };
}

export const resultsSection = organiserSection({
  template: ENTRY_TEMPLATES.RESULT_ORGANISER,
  sectionTemplate: { root: '2.16.840.1.113883.10.20.22.2.3.1', extension: '2015-08-01' },
  organiserTemplate: ENTRY_TEMPLATES.RESULT_ORGANISER,
  observationTemplate: ENTRY_TEMPLATES.RESULT_OBSERVATION,
  code: '30954-2',
  display: 'Relevant diagnostic tests and laboratory data',
  title: 'Results',
  idPrefix: 'result',
  emptyText: 'No results recorded.',
});

export const vitalsSection = organiserSection({
  template: ENTRY_TEMPLATES.VITAL_SIGNS_ORGANISER,
  sectionTemplate: { root: '2.16.840.1.113883.10.20.22.2.4.1', extension: '2015-08-01' },
  organiserTemplate: ENTRY_TEMPLATES.VITAL_SIGNS_ORGANISER,
  observationTemplate: ENTRY_TEMPLATES.VITAL_SIGN_OBSERVATION,
  code: '8716-3',
  display: 'Vital signs',
  title: 'Vital Signs',
  idPrefix: 'vital',
  emptyText: 'No vital signs recorded.',
});
