import { describe, expect, it } from 'vitest';

import {
  compileFormRow,
  questionnaireResource,
  questionnaireResponseResource,
} from '../fhir/projections.js';
import type { ScopedRow } from '../repositories/rows.js';

import { FIXED_NOW, testId } from './support.js';

/**
 * The two form projections, including the two failures they refuse to hide.
 *
 * Both lean on one invariant: a PUBLISHED definition compiles, because
 * `publishDefinition` compiles before it stamps the status and submissions are
 * refused against anything else. The happy path is exercised through the served
 * resources in `fhir.resources.test.ts`; what is asserted here is what happens
 * when that invariant does not hold, because the alternative to throwing is a
 * Questionnaire with no items, and a client cannot tell that apart from a form
 * that genuinely asks nothing.
 */

const TENANT = testId(1);
const PATIENT = testId(200);
const DEFINITION = testId(300);

function definitionRow(
  overrides: Partial<ScopedRow<'FormDefinition'>> = {}
): ScopedRow<'FormDefinition'> {
  return {
    id: DEFINITION,
    tenantId: TENANT,
    key: 'intake',
    version: 2,
    status: 'PUBLISHED',
    title: 'New patient intake',
    description: null,
    bindTo: 'PATIENT',
    definition: {
      fields: [{ type: 'shortText', key: 'reason', label: 'Reason for visit', maxLength: 120 }],
    },
    compiled: null,
    promotionManifest: null,
    publishedAt: FIXED_NOW,
    publishedById: null,
    retiredAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function submissionRow(
  overrides: Partial<ScopedRow<'FormSubmission'>> = {}
): ScopedRow<'FormSubmission'> {
  return {
    id: testId(301),
    tenantId: TENANT,
    formDefinitionId: DEFINITION,
    patientId: PATIENT,
    encounterId: null,
    status: 'COMPLETED',
    values: { reason: 'Annual review' },
    completedByType: 'USER',
    completedByUserId: null,
    completedAt: FIXED_NOW,
    signedAt: null,
    signedById: null,
    effectiveAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('questionnaireResource', () => {
  it('carries the row id, so the resource can be read back', () => {
    /* The compiler emits no id: it does not know it is being served from a
       table. Without this the search would return resources nothing can GET. */
    const resource = questionnaireResource(definitionRow());

    expect(resource.id).toBe(DEFINITION);
    expect(resource.resourceType).toBe('Questionnaire');
  });

  it('carries the version in the canonical url, not just the title', () => {
    const resource = questionnaireResource(definitionRow());

    expect(resource.version).toBe('2');
    expect(resource.title).toBe('New patient intake');
    expect(resource.item?.[0]).toMatchObject({ linkId: 'reason', type: 'string' });
  });

  it('refuses a published definition that does not compile, rather than emitting an empty form', () => {
    /*
     * Unreachable while the publish path holds: it compiles first, so this
     * definition could not have been stamped PUBLISHED. If it is ever reached
     * the invariant has broken, and a Questionnaire with no items would tell a
     * client the practice asks nothing on intake.
     */
    const broken = definitionRow({
      definition: {
        fields: [
          { type: 'shortText', key: 'reason', label: 'Reason', maxLength: 10 },
          { type: 'shortText', key: 'reason', label: 'Reason again', maxLength: 10 },
        ],
      },
    });

    expect(() => questionnaireResource(broken)).toThrow(/PUBLISHED but does not compile/);
  });

  it('names the definition it could not compile', () => {
    /* The message has to identify the row. "A form failed to compile" sends
       whoever is paged to grep a table. */
    const broken = definitionRow({
      key: 'consent',
      version: 7,
      definition: {
        fields: [
          { type: 'shortText', key: 'agree', label: 'Agree', maxLength: 4 },
          { type: 'shortText', key: 'agree', label: 'Agree twice', maxLength: 4 },
        ],
      },
    });

    expect(() => questionnaireResource(broken)).toThrow(/consent v7/);
  });
});

describe('questionnaireResponseResource', () => {
  it('answers the questionnaire it was authored against, with the subject and the answer', () => {
    const resource = questionnaireResponseResource(
      submissionRow(),
      compileFormRow(definitionRow())
    );

    expect(resource.resourceType).toBe('QuestionnaireResponse');
    expect(resource.id).toBe(testId(301));
    expect(resource.subject?.reference).toBe(`Patient/${PATIENT}`);
    expect(resource.questionnaire).toContain('|2');
    expect(resource.item?.[0]?.answer?.[0]).toMatchObject({ valueString: 'Annual review' });
  });

  it('authors from the completion instant when there is one', () => {
    expect(
      questionnaireResponseResource(submissionRow(), compileFormRow(definitionRow())).authored
    ).toBe(FIXED_NOW.toISOString());
  });

  it('falls back to the effective instant for a submission still in progress', () => {
    /*
     * `effectiveAt` is the clinically effective instant and is never null, so
     * it is the honest fallback. Leaving `authored` absent would make an
     * in-progress response undatable by a client sorting a list of them.
     */
    const effective = new Date('2026-02-01T09:15:00.000Z');
    const row = submissionRow({ status: 'IN_PROGRESS', completedAt: null, effectiveAt: effective });

    expect(questionnaireResponseResource(row, compileFormRow(definitionRow())).authored).toBe(
      effective.toISOString()
    );
  });

  it('maps the submission status rather than reporting every response as completed', () => {
    expect(
      questionnaireResponseResource(submissionRow(), compileFormRow(definitionRow())).status
    ).toBe('completed');
    expect(
      questionnaireResponseResource(
        submissionRow({ status: 'IN_PROGRESS' }),
        compileFormRow(definitionRow())
      ).status
    ).toBe('in-progress');
  });

  it('survives a submission with no answers recorded yet', () => {
    /* An empty intake is an ordinary state, not an error: the form was opened
       and nothing typed. It has to project as a response with no items. */
    const resource = questionnaireResponseResource(
      submissionRow({ values: {}, status: 'IN_PROGRESS' }),
      compileFormRow(definitionRow())
    );

    expect(resource.item ?? []).toEqual([]);
    expect(resource.subject?.reference).toBe(`Patient/${PATIENT}`);
  });
});
