import {
  codedValue,
  effectiveTime,
  id,
  readCodedValue,
  readStatus,
  statusCode,
  templateId,
} from '../datatypes.js';
import type { AllergyEntry } from '../domain.js';
import { narrativeReference } from '../narrative.js';
import { CODE_SYSTEMS, ENTRY_TEMPLATES, SECTION_TEMPLATES } from '../oids.js';
import { entryStatements, type SectionSpec } from '../section.js';
import { fromHl7, readableDate } from '../time.js';
import { attr, childNamed, childrenNamed, descendantsNamed, element, textOf } from '../xml/tree.js';
import type { XmlElement } from '../xml/tree.js';

/**
 * ALLERGIES AND INTOLERANCES.
 *
 * The section a receiving clinician reads first and the one an import must not
 * lose, so it is written at full depth: the concern act, the observation inside
 * it, the reaction observation, and the criticality. A flatter document - just
 * the substance, no reaction - validates and imports, and arrives at the other
 * end saying "penicillin" without saying "anaphylaxis, 2019", which is the half
 * that changes what the next prescriber does.
 *
 * The nesting is the specification's, not a preference:
 *
 *     act (Allergy Concern)
 *       entryRelationship
 *         observation (Allergy - Intolerance)
 *           participant -> playingEntity (the substance)
 *           entryRelationship -> observation (Reaction)
 *           entryRelationship -> observation (Criticality)
 */

/** The criticality vocabulary, which is SNOMED rather than a local code list. */
const CRITICALITY: Readonly<Record<string, { code: string; display: string }>> = {
  low: { code: '62482003', display: 'Low criticality' },
  high: { code: '75540009', display: 'High criticality' },
  'unable-to-assess': { code: '260245000', display: 'Criticality unassessable' },
};

function criticalityOf(code: string | undefined): AllergyEntry['criticality'] {
  for (const [key, value] of Object.entries(CRITICALITY)) {
    if (value.code === code) return key as AllergyEntry['criticality'];
  }
  return undefined;
}

export const allergiesSection: SectionSpec<AllergyEntry> = {
  template: SECTION_TEMPLATES.ALLERGIES,
  code: '48765-2',
  display: 'Allergies and adverse reactions',
  title: 'Allergies and Intolerances',
  columns: ['Substance', 'Reaction', 'Criticality', 'Status', 'Onset'],
  idPrefix: 'allergy',
  emptyText: 'No known allergies recorded.',

  row: (entry) => [
    entry.substance.display,
    entry.reaction ?? '',
    entry.criticality ?? '',
    entry.status,
    readableDate(entry.onsetDate),
  ],

  entry: (value, index) => {
    const observationChildren: XmlElement[] = [
      templateId(ENTRY_TEMPLATES.ALLERGY_OBSERVATION),
      id(`${value.id}-observation`),
      // Fixed by the template: this observation asserts a propensity to an
      // adverse reaction, and the substance itself arrives through the
      // participant below rather than through this code.
      element('code', {
        code: 'ASSERTION',
        codeSystem: CODE_SYSTEMS.ACT_CODE.oid,
        codeSystemName: CODE_SYSTEMS.ACT_CODE.name,
      }),
      element('statusCode', { code: 'completed' }),
    ];

    const onset = effectiveTime(value.onsetDate, undefined, { openEnded: true });
    if (onset !== undefined) observationChildren.push(onset);

    observationChildren.push(
      element('value', {
        'xsi:type': 'CD',
        code: '419199007',
        codeSystem: CODE_SYSTEMS.SNOMED.oid,
        codeSystemName: CODE_SYSTEMS.SNOMED.name,
        displayName: 'Allergy to substance',
      }),
      element('participant', { typeCode: 'CSM' }, [
        element('participantRole', { classCode: 'MANU' }, [
          element('playingEntity', { classCode: 'MMAT' }, [codedValue('code', value.substance)]),
        ]),
      ])
    );

    if (value.reaction !== undefined && value.reaction !== '') {
      observationChildren.push(
        element('entryRelationship', { typeCode: 'MFST', inversionInd: 'true' }, [
          element('observation', { classCode: 'OBS', moodCode: 'EVN' }, [
            templateId(ENTRY_TEMPLATES.REACTION_OBSERVATION),
            id(`${value.id}-reaction`),
            element('code', {
              code: 'ASSERTION',
              codeSystem: CODE_SYSTEMS.ACT_CODE.oid,
            }),
            element('statusCode', { code: 'completed' }),
            // The reaction is free text in our chart, so it is written as an
            // uncoded value rather than pretending to a SNOMED code we do not
            // hold. A receiving system shows the text; it would have shown a
            // wrong code as a wrong reaction.
            element('value', { 'xsi:type': 'CD', nullFlavor: 'OTH' }, [
              element('originalText', {}, [value.reaction]),
            ]),
          ]),
        ])
      );
    }

    if (value.criticality !== undefined) {
      const criticality = CRITICALITY[value.criticality];
      if (criticality !== undefined) {
        observationChildren.push(
          element('entryRelationship', { typeCode: 'SUBJ', inversionInd: 'true' }, [
            element('observation', { classCode: 'OBS', moodCode: 'EVN' }, [
              templateId(ENTRY_TEMPLATES.CRITICALITY_OBSERVATION),
              element('code', {
                code: '82606-5',
                codeSystem: CODE_SYSTEMS.LOINC.oid,
                displayName: 'Criticality',
              }),
              element('statusCode', { code: 'completed' }),
              element('value', {
                'xsi:type': 'CD',
                code: criticality.code,
                codeSystem: CODE_SYSTEMS.SNOMED.oid,
                displayName: criticality.display,
              }),
            ]),
          ])
        );
      }
    }

    return element('act', { classCode: 'ACT', moodCode: 'EVN' }, [
      templateId(ENTRY_TEMPLATES.ALLERGY_CONCERN),
      id(value.id),
      element('code', {
        code: 'CONC',
        codeSystem: CODE_SYSTEMS.ACT_CODE.oid,
        displayName: 'Concern',
      }),
      narrativeReference('allergy', index),
      statusCode(value.status),
      element('entryRelationship', { typeCode: 'SUBJ' }, [
        element('observation', { classCode: 'OBS', moodCode: 'EVN' }, observationChildren),
      ]),
    ]);
  },

  read: (section) =>
    entryStatements(section, 'act').map((act) => {
      const observation = descendantsNamed(act, 'observation')[0];
      const substance = readCodedValue(playingEntityCode(act));

      const reaction = reactionText(act);
      const criticality = criticalityOf(criticalityCode(act));

      return {
        id: attr(childNamed(act, 'id'), 'root') ?? '',
        substance: substance ?? { display: 'Unknown substance' },
        ...(reaction === undefined ? {} : { reaction }),
        ...(criticality === undefined ? {} : { criticality }),
        status: readStatus(act, 'active'),
        ...onsetOf(observation),
      } satisfies AllergyEntry;
    }),
};

/** The substance sits three levels down; this is the only path it may take. */
function playingEntityCode(act: XmlElement): XmlElement | undefined {
  for (const entity of descendantsNamed(act, 'playingEntity')) {
    const code = childNamed(entity, 'code');
    if (code !== undefined) return code;
  }
  return undefined;
}

/** The reaction, whether the sender coded it or wrote it as original text. */
function reactionText(act: XmlElement): string | undefined {
  for (const relationship of descendantsNamed(act, 'entryRelationship')) {
    if (attr(relationship, 'typeCode') !== 'MFST') continue;
    const value = childNamed(childNamed(relationship, 'observation') ?? relationship, 'value');
    const text =
      attr(value, 'displayName') ?? textOf(childNamed(value ?? relationship, 'originalText'));
    if (text !== '' && text !== undefined) return text;
  }
  return undefined;
}

function criticalityCode(act: XmlElement): string | undefined {
  for (const observation of descendantsNamed(act, 'observation')) {
    if (
      childrenNamed(observation, 'templateId').some(
        (node) => attr(node, 'root') === ENTRY_TEMPLATES.CRITICALITY_OBSERVATION.root
      )
    ) {
      return attr(childNamed(observation, 'value'), 'code');
    }
  }
  return undefined;
}

function onsetOf(observation: XmlElement | undefined): { onsetDate?: string } {
  const time = childNamed(observation, 'effectiveTime');
  const low = attr(childNamed(time, 'low'), 'value') ?? attr(time, 'value');
  const onset = fromHl7(low);
  return onset === undefined ? {} : { onsetDate: onset.slice(0, 10) };
}
