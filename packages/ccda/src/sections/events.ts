import {
  codedValue,
  effectiveTime,
  id,
  readCodedValue,
  readStatus,
  statusCode,
  templateId,
  writeTime,
} from '../datatypes.js';
import type {
  EncounterEntry,
  ImmunisationEntry,
  PlanEntry,
  SocialHistoryEntry,
} from '../domain.js';
import { narrativeReference } from '../narrative.js';
import { ENTRY_TEMPLATES, SECTION_TEMPLATES } from '../oids.js';
import { entryStatements, type SectionSpec } from '../section.js';
import { fromHl7, readableDate } from '../time.js';
import { attr, childNamed, descendantsNamed, element, textOf } from '../xml/tree.js';
import type { XmlElement } from '../xml/tree.js';

/**
 * The four smaller sections: immunisations, encounters, plan of treatment and
 * social history.
 *
 * Together rather than in four files because each is a single statement with no
 * nesting, and four files of thirty lines would hide how alike they are. The
 * thing they do NOT share is mood code, and that is the distinction worth
 * keeping in view while reading them: an immunisation and an encounter happened
 * (`EVN`), and a planned act has not (`INT`). Writing a plan in the event mood
 * is how a receiving system comes to believe a scheduled colonoscopy was
 * performed.
 */

export const immunisationsSection: SectionSpec<ImmunisationEntry> = {
  template: SECTION_TEMPLATES.IMMUNISATIONS,
  code: '11369-6',
  display: 'History of immunization',
  title: 'Immunizations',
  columns: ['Vaccine', 'Date', 'Status', 'Lot'],
  idPrefix: 'immunisation',
  emptyText: 'No immunizations recorded.',

  row: (entry) => [
    entry.vaccine.display,
    readableDate(entry.administeredAt),
    entry.status,
    entry.lotNumber ?? '',
  ],

  entry: (value, index) => {
    const children: XmlElement[] = [
      templateId(ENTRY_TEMPLATES.IMMUNISATION_ACTIVITY),
      id(value.id),
      narrativeReference('immunisation', index),
      statusCode(value.status),
    ];

    if (value.administeredAt !== undefined) {
      children.push(element('effectiveTime', { value: writeTime(value.administeredAt) }));
    }

    const material: XmlElement[] = [codedValue('code', value.vaccine)];
    if (value.lotNumber !== undefined && value.lotNumber !== '') {
      material.push(element('lotNumberText', {}, [value.lotNumber]));
    }

    children.push(
      element('consumable', {}, [
        element('manufacturedProduct', { classCode: 'MANU' }, [
          templateId({ root: '2.16.840.1.113883.10.20.22.4.54', extension: '2014-06-09' }),
          element('manufacturedMaterial', {}, material),
        ]),
      ])
    );

    // `negationInd` is what distinguishes "given" from "refused"; this codec
    // only records administrations, so it is written false explicitly rather
    // than omitted, because an absent attribute has a default a reader has to
    // look up.
    return element(
      'substanceAdministration',
      { classCode: 'SBADM', moodCode: 'EVN', negationInd: 'false' },
      children
    );
  },

  read: (section) =>
    entryStatements(section, 'substanceAdministration').map((administration) => {
      const material = descendantsNamed(administration, 'manufacturedMaterial')[0];
      const vaccine = readCodedValue(childNamed(material, 'code'));
      const lot = textOf(childNamed(material, 'lotNumberText'));
      const administered = fromHl7(attr(childNamed(administration, 'effectiveTime'), 'value'));

      return {
        id: attr(childNamed(administration, 'id'), 'root') ?? '',
        vaccine: vaccine ?? { display: 'Unknown vaccine' },
        ...(administered === undefined ? {} : { administeredAt: administered }),
        status: readStatus(administration),
        ...(lot === '' ? {} : { lotNumber: lot }),
      } satisfies ImmunisationEntry;
    }),
};

export const encountersSection: SectionSpec<EncounterEntry> = {
  template: SECTION_TEMPLATES.ENCOUNTERS,
  code: '46240-8',
  display: 'History of encounters',
  title: 'Encounters',
  columns: ['Encounter', 'Facility', 'Started', 'Ended'],
  idPrefix: 'encounter',
  emptyText: 'No encounters recorded.',

  row: (entry) => [
    entry.type.display,
    entry.facilityName ?? '',
    readableDate(entry.startedAt),
    readableDate(entry.endedAt),
  ],

  entry: (value, index) => {
    const children: XmlElement[] = [
      templateId(ENTRY_TEMPLATES.ENCOUNTER_ACTIVITY),
      id(value.id),
      codedValue('code', value.type),
      narrativeReference('encounter', index),
    ];

    const time = effectiveTime(value.startedAt, value.endedAt, { openEnded: true });
    if (time !== undefined) children.push(time);

    if (value.facilityName !== undefined && value.facilityName !== '') {
      children.push(
        element('participant', { typeCode: 'LOC' }, [
          element('participantRole', { classCode: 'SDLOC' }, [
            element('playingEntity', { classCode: 'PLC' }, [
              element('name', {}, [value.facilityName]),
            ]),
          ]),
        ])
      );
    }

    return element('encounter', { classCode: 'ENC', moodCode: 'EVN' }, children);
  },

  read: (section) =>
    entryStatements(section, 'encounter').map((encounter) => {
      const time = childNamed(encounter, 'effectiveTime');
      const started = fromHl7(attr(childNamed(time, 'low'), 'value') ?? attr(time, 'value')) ?? '';
      const ended = fromHl7(attr(childNamed(time, 'high'), 'value'));
      const facility = textOf(childNamed(descendantsNamed(encounter, 'playingEntity')[0], 'name'));

      return {
        id: attr(childNamed(encounter, 'id'), 'root') ?? '',
        type: readCodedValue(childNamed(encounter, 'code')) ?? { display: 'Encounter' },
        startedAt: started,
        ...(ended === undefined ? {} : { endedAt: ended }),
        ...(facility === '' ? {} : { facilityName: facility }),
      } satisfies EncounterEntry;
    }),
};

export const planSection: SectionSpec<PlanEntry> = {
  template: SECTION_TEMPLATES.PLAN_OF_TREATMENT,
  code: '18776-5',
  display: 'Plan of treatment',
  title: 'Plan of Treatment',
  columns: ['Planned activity', 'Scheduled', 'Status'],
  idPrefix: 'plan',
  emptyText: 'No planned activities recorded.',

  row: (entry) => [entry.activity.display, readableDate(entry.scheduledFor), entry.status],

  entry: (value, index) => {
    const children: XmlElement[] = [
      templateId(ENTRY_TEMPLATES.PLANNED_ACT),
      id(value.id),
      codedValue('code', value.activity),
      narrativeReference('plan', index),
      statusCode(value.status),
    ];

    if (value.scheduledFor !== undefined) {
      children.push(element('effectiveTime', { value: writeTime(value.scheduledFor) }));
    }

    // INT: an intent. The mood code is the whole difference between a plan and
    // a record of care given.
    return element('act', { classCode: 'ACT', moodCode: 'INT' }, children);
  },

  read: (section) =>
    entryStatements(section, 'act').map((act) => {
      const scheduled = fromHl7(attr(childNamed(act, 'effectiveTime'), 'value'));
      return {
        id: attr(childNamed(act, 'id'), 'root') ?? '',
        activity: readCodedValue(childNamed(act, 'code')) ?? { display: 'Planned activity' },
        ...(scheduled === undefined ? {} : { scheduledFor: scheduled }),
        status: readStatus(act, 'active'),
      } satisfies PlanEntry;
    }),
};

export const socialHistorySection: SectionSpec<SocialHistoryEntry> = {
  template: SECTION_TEMPLATES.SOCIAL_HISTORY,
  code: '29762-2',
  display: 'Social history',
  title: 'Social History',
  columns: ['Observation', 'Value', 'Date'],
  idPrefix: 'social',
  emptyText: 'No social history recorded.',

  row: (entry) => [entry.observation.display, entry.value.display, readableDate(entry.effectiveAt)],

  entry: (value, index) => {
    const children: XmlElement[] = [
      templateId(ENTRY_TEMPLATES.SOCIAL_HISTORY_OBSERVATION),
      id(value.id),
      codedValue('code', value.observation),
      narrativeReference('social', index),
      element('statusCode', { code: 'completed' }),
    ];

    if (value.effectiveAt !== undefined) {
      children.push(element('effectiveTime', { value: writeTime(value.effectiveAt) }));
    }
    children.push(codedValue('value', value.value, { 'xsi:type': 'CD' }));

    return element('observation', { classCode: 'OBS', moodCode: 'EVN' }, children);
  },

  read: (section) =>
    entryStatements(section, 'observation').map((observation) => {
      const effective = fromHl7(attr(childNamed(observation, 'effectiveTime'), 'value'));
      return {
        id: attr(childNamed(observation, 'id'), 'root') ?? '',
        observation: readCodedValue(childNamed(observation, 'code')) ?? { display: 'Observation' },
        value: readCodedValue(childNamed(observation, 'value')) ?? { display: 'Unknown' },
        ...(effective === undefined ? {} : { effectiveAt: effective }),
      } satisfies SocialHistoryEntry;
    }),
};
