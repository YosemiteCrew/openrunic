import { describe, expect, it } from 'vitest';

import { fromFhirGoal, toFhirGoal, type DomainGoal } from './goal.js';
import { SYSTEMS } from './systems.js';

/**
 * Goals, across the boundary and back.
 *
 * The target carries almost all of the risk. `Goal.target.detail[x]` is a
 * choice, so a resource carrying both a quantity and a range is malformed and a
 * client reading whichever element it prefers gets a different answer from one
 * reading the other. Everything else about a goal is a code or a date.
 */

const PATIENT = '0192f1a0-0000-7000-8000-0000000000p1';
const AUTHOR = '0192f1a0-0000-7000-8000-0000000000u1';

const A1C: DomainGoal = {
  id: '0192f1a0-0000-7000-8000-0000000000g1',
  patientId: PATIENT,
  lifecycleStatus: 'ACTIVE',
  achievementStatus: 'IMPROVING',
  priority: 'HIGH',
  description: 'HbA1c below 7%',
  descriptionCode: '443631005',
  descriptionSystem: SYSTEMS.snomed,
  targetMeasureCode: '4548-4',
  targetMeasureSystem: SYSTEMS.loinc,
  targetValue: 7,
  targetUnit: '%',
  startDate: '2026-01-05',
  dueDate: '2026-07-05',
  expressedByUserId: AUTHOR,
};

const SYSTOLIC: DomainGoal = {
  id: '0192f1a0-0000-7000-8000-0000000000g2',
  patientId: PATIENT,
  lifecycleStatus: 'ACTIVE',
  description: 'Systolic between 110 and 130',
  targetMeasureCode: '8480-6',
  targetMeasureSystem: SYSTEMS.loinc,
  targetLow: 110,
  targetHigh: 130,
  targetUnit: 'mm[Hg]',
  dueDate: '2026-07-05',
};

const WALKING: DomainGoal = {
  id: '0192f1a0-0000-7000-8000-0000000000g3',
  patientId: PATIENT,
  lifecycleStatus: 'ACTIVE',
  description: 'Walk for twenty minutes most days',
  dueDate: '2026-07-05',
};

describe('toFhirGoal', () => {
  it('emits a quantity for a single value, and no range beside it', () => {
    const target = toFhirGoal(A1C).target?.[0];

    expect(target?.detailQuantity).toEqual({
      value: 7,
      unit: '%',
      system: 'http://unitsofmeasure.org',
      code: '%',
    });
    expect(target?.detailRange).toBeUndefined();
  });

  it('emits a range for two bounds, and no quantity beside it', () => {
    const target = toFhirGoal(SYSTOLIC).target?.[0];

    expect(target?.detailRange?.low?.value).toBe(110);
    expect(target?.detailRange?.high?.value).toBe(130);
    expect(target?.detailQuantity).toBeUndefined();
  });

  it('carries the unit onto both bounds of a range', () => {
    /* A range whose low bound has a unit and whose high bound does not is a
       comparison waiting to go wrong two systems downstream. */
    const range = toFhirGoal(SYSTOLIC).target?.[0]?.detailRange;

    expect(range?.low?.code).toBe('mm[Hg]');
    expect(range?.high?.code).toBe('mm[Hg]');
  });

  it('still emits a target for a goal with only a due date', () => {
    /* "Walk daily by March" is a real goal, and the due date is the one target
       element US Core requires support for. Dropping the target because there
       was no number would lose it. */
    const target = toFhirGoal(WALKING).target?.[0];

    expect(target?.dueDate).toBe('2026-07-05');
    expect(target?.detailQuantity).toBeUndefined();
    expect(target?.detailRange).toBeUndefined();
  });

  it('omits the target entirely when there is nothing to put in it', () => {
    /* An empty target element asserts nothing and makes a client look for a
       value that is not there. */
    expect(toFhirGoal({ ...WALKING, dueDate: undefined }).target).toBeUndefined();
  });

  it('describes an uncoded goal in text, which is most of them', () => {
    const description = toFhirGoal(WALKING).description;

    expect(description.text).toBe('Walk for twenty minutes most days');
    expect(description.coding).toBeUndefined();
  });

  it('keeps achievement separate from the lifecycle', () => {
    /*
     * The failure a single column causes: a goal recorded as `worsening` stops
     * being active, and the clinician's worklist of active goals quietly sheds
     * the patients who most need to be on it.
     */
    const resource = toFhirGoal({ ...A1C, achievementStatus: 'WORSENING' });

    expect(resource.lifecycleStatus).toBe('active');
    expect(resource.achievementStatus?.coding?.[0]?.code).toBe('worsening');
  });

  it('maps every lifecycle status to its FHIR code', () => {
    const codes = (
      [
        'PROPOSED',
        'PLANNED',
        'ACCEPTED',
        'ACTIVE',
        'ON_HOLD',
        'COMPLETED',
        'CANCELLED',
        'ENTERED_IN_ERROR',
        'REJECTED',
      ] as const
    ).map((lifecycleStatus) => toFhirGoal({ ...A1C, lifecycleStatus }).lifecycleStatus);

    expect(codes).toEqual([
      'proposed',
      'planned',
      'accepted',
      'active',
      'on-hold',
      'completed',
      'cancelled',
      'entered-in-error',
      'rejected',
    ]);
  });

  it('maps every achievement status and every priority', () => {
    const achievements = (
      [
        'IN_PROGRESS',
        'IMPROVING',
        'WORSENING',
        'NO_CHANGE',
        'ACHIEVED',
        'SUSTAINING',
        'NOT_ACHIEVED',
        'NO_PROGRESS',
        'NOT_ATTAINABLE',
      ] as const
    ).map(
      (achievementStatus) =>
        toFhirGoal({ ...A1C, achievementStatus }).achievementStatus?.coding?.[0]?.code
    );
    const priorities = (['HIGH', 'MEDIUM', 'LOW'] as const).map(
      (priority) => toFhirGoal({ ...A1C, priority }).priority?.coding?.[0]?.code
    );

    expect(achievements).toEqual([
      'in-progress',
      'improving',
      'worsening',
      'no-change',
      'achieved',
      'sustaining',
      'not-achieved',
      'no-progress',
      'not-attainable',
    ]);
    expect(priorities).toEqual(['high-priority', 'medium-priority', 'low-priority']);
  });
});

describe('round trip', () => {
  it('returns every field of a single-value goal', () => {
    expect(fromFhirGoal(toFhirGoal(A1C))).toEqual(A1C);
  });

  it('returns every field of a range goal', () => {
    expect(fromFhirGoal(toFhirGoal(SYSTOLIC))).toEqual(SYSTOLIC);
  });

  it('returns every field of a goal with no number at all', () => {
    expect(fromFhirGoal(toFhirGoal(WALKING))).toEqual(WALKING);
  });

  it('does not invent a range from a single value, or a value from a range', () => {
    /* The failure this guards is a target that survives one round trip as a
       quantity and comes back the next time as a range from 7 to 7, which is a
       different clinical statement. */
    const back = fromFhirGoal(toFhirGoal(A1C));
    expect(back.targetLow).toBeUndefined();
    expect(back.targetHigh).toBeUndefined();

    const range = fromFhirGoal(toFhirGoal(SYSTOLIC));
    expect(range.targetValue).toBeUndefined();
  });

  it('survives a goal with nothing but a subject, a status and a description', () => {
    const bare: DomainGoal = {
      id: '0192f1a0-0000-7000-8000-0000000000g4',
      patientId: PATIENT,
      lifecycleStatus: 'PROPOSED',
      description: 'Stop smoking',
    };

    expect(fromFhirGoal(toFhirGoal(bare))).toEqual(bare);
  });
});

describe('fromFhirGoal, on input it did not write', () => {
  const foreign = (overrides: Partial<fhir4.Goal>): fhir4.Goal => ({
    resourceType: 'Goal',
    id: 'external-1',
    lifecycleStatus: 'active',
    description: { text: 'Something' },
    subject: { reference: `Patient/${PATIENT}` },
    ...overrides,
  });

  it('falls back to PROPOSED for a lifecycle status outside the value set', () => {
    expect(
      fromFhirGoal(foreign({ lifecycleStatus: 'nonsense' as fhir4.Goal['lifecycleStatus'] }))
        .lifecycleStatus
    ).toBe('PROPOSED');
  });

  it('leaves achievement and priority unset for codes it does not know', () => {
    /*
     * Unset, not guessed. An unrecognised achievement mapped to `IN_PROGRESS`
     * would report progress nobody assessed, and "nobody has looked" is a real
     * and different state from "no progress".
     */
    const domain = fromFhirGoal(
      foreign({
        achievementStatus: { coding: [{ system: 'urn:example', code: 'going-well' }] },
        priority: { coding: [{ system: 'urn:example', code: 'urgent' }] },
      })
    );

    expect(domain.achievementStatus).toBeUndefined();
    expect(domain.priority).toBeUndefined();
  });

  it('reads a target that carries only a low bound', () => {
    const domain = fromFhirGoal(
      foreign({
        target: [{ detailRange: { low: { value: 110, code: 'mm[Hg]' } }, dueDate: '2026-07-05' }],
      })
    );

    expect(domain.targetLow).toBe(110);
    expect(domain.targetHigh).toBeUndefined();
    expect(domain.targetUnit).toBe('mm[Hg]');
  });

  it('takes the unit from the high bound when only that one carries it', () => {
    const domain = fromFhirGoal(
      foreign({ target: [{ detailRange: { high: { value: 130, code: 'mm[Hg]' } } }] })
    );

    expect(domain.targetUnit).toBe('mm[Hg]');
  });

  it('reads a goal with no description text as an empty one rather than failing', () => {
    expect(fromFhirGoal(foreign({ description: { coding: [{ code: 'x' }] } })).description).toBe(
      ''
    );
  });

  it('emits no addresses, because a CarePlan is not a thing a goal addresses', () => {
    /* FHIR R4 restricts Goal.addresses to clinical concerns (Condition,
       Observation, and the like); a CarePlan is not one, and the care-plan link
       is CarePlan.goal. So the projection carries no addresses at all rather
       than a reference a validator rejects. */
    expect(toFhirGoal(A1C).addresses).toBeUndefined();
  });
});
