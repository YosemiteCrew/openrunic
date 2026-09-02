/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  codeableConcept,
  compact,
  compactOrUndefined,
  readCodeSystem,
  readConceptText,
  readQuantityUnit,
  readQuantityValue,
  readString,
  setOptional,
  simpleQuantity,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * What the patient and the clinician agreed to aim at.
 *
 * A goal is not a plan and not an order. The plan says what will be done, the
 * order says do it, and the goal says what would count as it having worked. A
 * receiving system can hold every medication and every visit and still not know
 * what anybody was trying to achieve, which is the first thing a clinician
 * taking over a patient asks.
 *
 * ## The target is a choice, and that is the whole of the mapping
 *
 * `Goal.target.detail[x]` is a choice: a single value, a range, or nothing.
 * "HbA1c below 7%", "systolic between 110 and 130" and "walk daily" are three
 * different shapes, not one shape with holes. Emitting a target with both
 * `detailQuantity` and `detailRange` is malformed, and a client reading
 * whichever it prefers gets a different answer from one reading the other.
 */

export type DomainGoalLifecycleStatus =
  | 'PROPOSED'
  | 'PLANNED'
  | 'ACCEPTED'
  | 'ACTIVE'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR'
  | 'REJECTED';

export type DomainGoalAchievementStatus =
  | 'IN_PROGRESS'
  | 'IMPROVING'
  | 'WORSENING'
  | 'NO_CHANGE'
  | 'ACHIEVED'
  | 'SUSTAINING'
  | 'NOT_ACHIEVED'
  | 'NO_PROGRESS'
  | 'NOT_ATTAINABLE';

export type DomainGoalPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export const GOAL_LIFECYCLE_STATUS = enumMapping<
  DomainGoalLifecycleStatus,
  NonNullable<fhir4.Goal['lifecycleStatus']>
>({
  map: {
    PROPOSED: 'proposed',
    PLANNED: 'planned',
    ACCEPTED: 'accepted',
    ACTIVE: 'active',
    ON_HOLD: 'on-hold',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    ENTERED_IN_ERROR: 'entered-in-error',
    REJECTED: 'rejected',
  },
  fallback: 'PROPOSED',
});

/**
 * Achievement, which is a CodeableConcept rather than a bare code.
 *
 * Kept separate from the lifecycle deliberately, the way FHIR keeps them. An
 * active goal can be improving or worsening, and a single column would lose
 * whichever of the two it was not set from: a goal recorded as `worsening`
 * would stop being active, and a clinician's worklist of active goals would
 * quietly shed the patients who most need to be on it.
 */
const ACHIEVEMENT_CODES: Readonly<Record<DomainGoalAchievementStatus, string>> = {
  IN_PROGRESS: 'in-progress',
  IMPROVING: 'improving',
  WORSENING: 'worsening',
  NO_CHANGE: 'no-change',
  ACHIEVED: 'achieved',
  SUSTAINING: 'sustaining',
  NOT_ACHIEVED: 'not-achieved',
  NO_PROGRESS: 'no-progress',
  NOT_ATTAINABLE: 'not-attainable',
};

const ACHIEVEMENT_SYSTEM = 'http://terminology.hl7.org/CodeSystem/goal-achievement';

const PRIORITY_CODES: Readonly<Record<DomainGoalPriority, string>> = {
  HIGH: 'high-priority',
  MEDIUM: 'medium-priority',
  LOW: 'low-priority',
};

const PRIORITY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/goal-priority';

export interface DomainGoal {
  id: string;
  patientId: string;
  carePlanId?: string;
  lifecycleStatus: DomainGoalLifecycleStatus;
  achievementStatus?: DomainGoalAchievementStatus;
  priority?: DomainGoalPriority;
  description: string;
  descriptionCode?: string;
  descriptionSystem?: string;
  targetMeasureCode?: string;
  targetMeasureSystem?: string;
  /** The single value aimed at. Never set beside the range bounds. */
  targetValue?: number;
  targetLow?: number;
  targetHigh?: number;
  /** UCUM unit for whichever of the two is set. */
  targetUnit?: string;
  startDate?: string;
  dueDate?: string;
  statusReason?: string;
  expressedByUserId?: string;
}

/** Reverses a code table, so a read cannot drift from the write. */
function inverseOf<D extends string>(codes: Readonly<Record<D, string>>): ReadonlyMap<string, D> {
  return new Map(Object.entries(codes).map(([domain, code]) => [code as string, domain as D]));
}

const ACHIEVEMENT_BY_CODE = inverseOf(ACHIEVEMENT_CODES);
const PRIORITY_BY_CODE = inverseOf(PRIORITY_CODES);

/**
 * The target, or nothing when there is nothing to aim a number at.
 *
 * A goal with a due date and no measure is ordinary: "walk daily by March" is a
 * real goal. So an absent target is absent rather than an empty object, which
 * would be a target element asserting nothing.
 */
function targetOf(input: DomainGoal): fhir4.GoalTarget[] | undefined {
  const measure =
    input.targetMeasureCode === undefined
      ? undefined
      : codeableConcept({
          system: input.targetMeasureSystem ?? SYSTEMS.loinc,
          code: input.targetMeasureCode,
        });

  /* One or the other, never both. The database refuses a row carrying both, so
     this branch is the shape of the data rather than a preference applied to
     it. */
  const detail =
    input.targetValue === undefined
      ? {
          detailRange: compactOrUndefined<fhir4.Range>({
            low: simpleQuantity(input.targetLow, input.targetUnit),
            high: simpleQuantity(input.targetHigh, input.targetUnit),
          }),
        }
      : { detailQuantity: simpleQuantity(input.targetValue, input.targetUnit) };

  const target = compactOrUndefined<fhir4.GoalTarget>({
    measure,
    ...detail,
    dueDate: input.dueDate,
  });
  return target === undefined ? undefined : [target];
}

/** Maps a {@link DomainGoal} to a FHIR R4 `Goal`. */
export function toFhirGoal(input: DomainGoal): fhir4.Goal {
  return compact<fhir4.Goal>({
    resourceType: 'Goal',
    id: input.id,
    lifecycleStatus: GOAL_LIFECYCLE_STATUS.toFhir(input.lifecycleStatus),
    achievementStatus:
      input.achievementStatus === undefined
        ? undefined
        : codeableConcept({
            system: ACHIEVEMENT_SYSTEM,
            code: ACHIEVEMENT_CODES[input.achievementStatus],
          }),
    priority:
      input.priority === undefined
        ? undefined
        : codeableConcept({ system: PRIORITY_SYSTEM, code: PRIORITY_CODES[input.priority] }),
    /* The description carries its code when there is one and its text always.
       Text always, because most goals are agreed in words and never coded, and
       a description that only appeared for coded goals would leave the ordinary
       case blank. */
    description: {
      ...(input.descriptionCode === undefined
        ? {}
        : {
            coding: [
              { system: input.descriptionSystem ?? SYSTEMS.snomed, code: input.descriptionCode },
            ],
          }),
      text: input.description,
    },
    subject: fhirReference('Patient', input.patientId),
    startDate: input.startDate,
    target: targetOf(input),
    statusReason: input.statusReason,
    expressedBy:
      input.expressedByUserId === undefined
        ? undefined
        : fhirReference('Practitioner', input.expressedByUserId),
    addresses:
      input.carePlanId === undefined ? undefined : [fhirReference('CarePlan', input.carePlanId)],
  });
}

/** Reads the code of the first coding in a concept, whatever its system. */
function firstCode(concept: fhir4.CodeableConcept | undefined): string | undefined {
  return readString(concept?.coding?.[0]?.code);
}

/** Maps a FHIR R4 `Goal` back to a {@link DomainGoal}. */
export function fromFhirGoal(resource: fhir4.Goal): DomainGoal {
  const target = resource.target?.[0];
  const range = target?.detailRange;

  const domain: DomainGoal = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    lifecycleStatus: GOAL_LIFECYCLE_STATUS.fromFhir(resource.lifecycleStatus),
    description: readConceptText(resource.description) ?? '',
  };

  setOptional(
    domain,
    'achievementStatus',
    ACHIEVEMENT_BY_CODE.get(firstCode(resource.achievementStatus) ?? '')
  );
  setOptional(domain, 'priority', PRIORITY_BY_CODE.get(firstCode(resource.priority) ?? ''));
  setOptional(domain, 'descriptionCode', firstCode(resource.description));
  setOptional(domain, 'descriptionSystem', readCodeSystem(resource.description));
  setOptional(domain, 'targetMeasureCode', firstCode(target?.measure));
  setOptional(domain, 'targetMeasureSystem', readCodeSystem(target?.measure));
  setOptional(domain, 'targetValue', readQuantityValue(target?.detailQuantity));
  setOptional(domain, 'targetLow', readQuantityValue(range?.low));
  setOptional(domain, 'targetHigh', readQuantityValue(range?.high));
  /*
   * The unit belongs to whichever bound carried it, and the low bound is read
   * first only because it is the one more often present. A range whose bounds
   * disagreed about units would be malformed input; taking one of them keeps a
   * unit rather than dropping the target's meaning entirely.
   */
  setOptional(
    domain,
    'targetUnit',
    readQuantityUnit(target?.detailQuantity) ??
      readQuantityUnit(range?.low) ??
      readQuantityUnit(range?.high)
  );
  setOptional(domain, 'startDate', readString(resource.startDate));
  setOptional(domain, 'dueDate', readString(target?.dueDate));
  setOptional(domain, 'statusReason', readString(resource.statusReason));
  setOptional(domain, 'expressedByUserId', referenceId(resource.expressedBy, 'Practitioner'));
  setOptional(domain, 'carePlanId', referenceId(resource.addresses?.[0], 'CarePlan'));
  return domain;
}
