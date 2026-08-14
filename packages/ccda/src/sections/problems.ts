import {
  codedValue,
  effectiveTime,
  id,
  readCodedValue,
  readStatus,
  statusCode,
  templateId,
} from '../datatypes.js';
import type { ProblemEntry } from '../domain.js';
import { narrativeReference } from '../narrative.js';
import { CODE_SYSTEMS, ENTRY_TEMPLATES, SECTION_TEMPLATES } from '../oids.js';
import { entryStatements, type SectionSpec } from '../section.js';
import { fromHl7, readableDate } from '../time.js';
import { attr, childNamed, descendantsNamed, element } from '../xml/tree.js';
import type { XmlElement } from '../xml/tree.js';

/**
 * PROBLEM LIST.
 *
 * Concern act outside, problem observation inside - the same two-layer shape as
 * allergies, and for the same reason: the concern is the practice's ongoing
 * attention to something, and the observation is the assertion of what it is.
 * They have separate lifetimes. A problem can be resolved (the observation ends)
 * while the concern stays active because somebody is still watching for it, and
 * a document that collapsed the two would lose that distinction entirely.
 */
export const problemsSection: SectionSpec<ProblemEntry> = {
  template: SECTION_TEMPLATES.PROBLEMS,
  code: '11450-4',
  display: 'Problem list',
  title: 'Problems',
  columns: ['Problem', 'Status', 'Onset', 'Resolved'],
  idPrefix: 'problem',
  emptyText: 'No problems recorded.',

  row: (entry) => [
    entry.problem.display,
    entry.status,
    readableDate(entry.onsetDate),
    readableDate(entry.resolvedDate),
  ],

  entry: (value, index) => {
    const observation: XmlElement[] = [
      templateId(ENTRY_TEMPLATES.PROBLEM_OBSERVATION),
      id(`${value.id}-observation`),
      element('code', {
        code: '55607006',
        codeSystem: CODE_SYSTEMS.SNOMED.oid,
        codeSystemName: CODE_SYSTEMS.SNOMED.name,
        displayName: 'Problem',
      }),
      element('statusCode', { code: 'completed' }),
    ];

    const time = effectiveTime(value.onsetDate, value.resolvedDate, { openEnded: true });
    if (time !== undefined) observation.push(time);
    observation.push(codedValue('value', value.problem, { 'xsi:type': 'CD' }));

    return element('act', { classCode: 'ACT', moodCode: 'EVN' }, [
      templateId(ENTRY_TEMPLATES.PROBLEM_CONCERN),
      id(value.id),
      element('code', {
        code: 'CONC',
        codeSystem: CODE_SYSTEMS.ACT_CODE.oid,
        displayName: 'Concern',
      }),
      narrativeReference('problem', index),
      statusCode(value.status),
      element('entryRelationship', { typeCode: 'SUBJ' }, [
        element('observation', { classCode: 'OBS', moodCode: 'EVN' }, observation),
      ]),
    ]);
  },

  read: (section) =>
    entryStatements(section, 'act').map((act) => {
      const observation = descendantsNamed(act, 'observation')[0];
      const problem = readCodedValue(childNamed(observation, 'value'));
      const time = childNamed(observation, 'effectiveTime');
      const onset = fromHl7(attr(childNamed(time, 'low'), 'value') ?? attr(time, 'value'));
      const resolved = fromHl7(attr(childNamed(time, 'high'), 'value'));

      return {
        id: attr(childNamed(act, 'id'), 'root') ?? '',
        problem: problem ?? { display: 'Unknown problem' },
        status: readStatus(act, 'active'),
        ...(onset === undefined ? {} : { onsetDate: onset.slice(0, 10) }),
        ...(resolved === undefined ? {} : { resolvedDate: resolved.slice(0, 10) }),
      } satisfies ProblemEntry;
    }),
};
