import { describe, expect, it } from 'vitest';

import { SERVED_MODULES } from '../fhir/resources.js';
import { COLLECTION_SPECS } from '../repositories/specs/index.js';

/**
 * Every resource that names a chart is gated by a care relationship.
 *
 * The gate landed covering exactly one resource, `Patient`, and that was the
 * defect rather than the increment: `GET /fhir/Condition/{id}` and twenty-three
 * others still turned a guessed id into somebody's chart, and each of them
 * hands back a patient reference the caller did not have. A boundary with one
 * door shut is not a boundary.
 *
 * So the rule is enumerated here rather than remembered. A module whose
 * collection spec declares a `patientColumn` must declare `chartFrom`, and the
 * only way out is an entry in `NO_CHART` with a reason. Adding a resource that
 * names a patient and forgetting the gate fails this test with the resource's
 * own name in the message.
 */

/**
 * Resources whose addressed read exposes no chart, and why.
 *
 * Each one was checked against what its projection actually emits rather than
 * against what its name suggests. The reason matters more than the entry: a
 * future reader deciding whether a new resource belongs here needs to know what
 * question was asked.
 */
const NO_CHART: Readonly<Record<string, string>> = {
  Practitioner:
    'a member of staff. The row is a User with no patient column at all, and gating it would need a chart that does not exist.',
  PractitionerRole:
    'a staff grant at a site. RoleAssignment names a user, a role and a facility, and no patient.',
  Organization: 'the tenant record itself: name, slug, timezone. It carries nothing about anybody.',
  Location: 'a place of service. A facility carries no chart, as its spec says in so many words.',
  Questionnaire:
    'a blank form the practice publishes. It is a template, not an answer, and the answers are QuestionnaireResponse, which is gated.',
  Provenance:
    'the audit trail, which is not a collection spec at all - it is a hand-written query repository outside COLLECTION_SPECS, so there is no patientColumn to derive from. Its rows are literally records of who read what, and gating them behind a care relationship would refuse the privacy officer the report they exist for. That it needs its own answer is recorded in the follow-up rather than hidden by this entry.',
};

describe('the chart gate covers every resource that names a chart', () => {
  it.each(SERVED_MODULES.map((module) => [module.type, module] as const))('%s', (type, module) => {
    const declared = (module as { chartFrom?: string }).chartFrom;
    const exempt = Object.hasOwn(NO_CHART, type);

    if (exempt) {
      expect(
        declared,
        `${type} is listed as carrying no chart but declares chartFrom`
      ).toBeUndefined();
      return;
    }

    expect(
      declared,
      `${type} serves a chart and does not gate its addressed read: ` +
        'declare chartFrom, or add it to NO_CHART with the reason it carries no chart'
    ).toBeDefined();

    const spec = COLLECTION_SPECS[declared as keyof typeof COLLECTION_SPECS] as
      { patientColumn?: string; model?: string } | undefined;
    expect(spec, `${type} names a collection that does not exist`).toBeDefined();
    expect(
      spec?.patientColumn !== undefined || spec?.model === 'Patient',
      `${type} gates on a collection whose spec names no patient column`
    ).toBe(true);
  });

  it('lists no exemption for a resource that is not served', () => {
    /* An exemption for a resource nobody serves is a comment pretending to be a
       decision, and it would go stale without failing anything. */
    const served = new Set<string>(SERVED_MODULES.map((module) => module.type));
    for (const type of Object.keys(NO_CHART)) {
      expect(served.has(type), `${type} is exempted but is not served`).toBe(true);
    }
  });

  it('gates more than it exempts, which is the shape the boundary should have', () => {
    /* Not a real invariant so much as a tripwire. If a change ever makes the
       exemption list the larger half, the rule has been inverted and somebody
       should look. */
    const gated = SERVED_MODULES.filter(
      (module) => (module as { chartFrom?: string }).chartFrom !== undefined
    );

    expect(gated.length).toBeGreaterThan(Object.keys(NO_CHART).length);
  });
});
