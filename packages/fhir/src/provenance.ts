/// <reference types="fhir" preserve="true" />

import {
  booleanExtension,
  codeExtension,
  openrunicCodeSystem,
  openrunicExtension,
  readBooleanExtension,
  readCodeExtension,
} from './extensions.js';
import {
  codeableConcept,
  compact,
  isPresentString,
  present,
  readCode,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, referenceId, referenceType } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Carries the breakglass flag, which R4 Provenance has no element for. */
export const BREAKGLASS_EXTENSION = openrunicExtension('breakglass');

/** Carries the outcome of the audited action. */
export const AUDIT_OUTCOME_EXTENSION = openrunicExtension('audit-outcome');

/** Code system for Openrunic's audit action vocabulary. */
export const AUDIT_ACTION_SYSTEM = openrunicCodeSystem('audit-action');

/** Code system for the kinds of principal that can act. */
export const ACTOR_TYPE_SYSTEM = openrunicCodeSystem('actor-type');

/** Namespace for non-user principals: services, adapters, the system itself. */
export const ACTOR_SYSTEM = 'https://openrunic.org/fhir/sid/actor';

/**
 * One audited action, projected from an `AuditEvent` row.
 *
 * `actorType` is a plain string, not an enum, because plugins introduce actor
 * kinds. A `user` actor becomes a literal Practitioner reference; every other
 * kind becomes a logical reference carrying the actor id, so the resource stays
 * valid without inventing a resource type that does not exist.
 */
export interface DomainProvenance {
  id: string;
  /** Model name of the audited record, e.g. `Patient`. */
  targetType: string;
  targetId?: string;
  /** ISO 8601 instant. */
  occurredAt: string;
  /** Kind of principal: `user`, `patient`, `system`, `service`, `adapter`. */
  actorType: string;
  actorId: string;
  actorDisplay?: string;
  action: string;
  /** HL7 PurposeOfUse code, e.g. `TREAT`, `HPAYMT`. */
  purposeOfUse?: string;
  breakglass: boolean;
  outcome: string;
}

/**
 * Audit columns that stay inside Openrunic. The hash chain (`seq`, `prevHash`,
 * `hash`) is the tamper-evidence mechanism and is served by the audit export
 * API, not by Provenance; `sourceIp` and `userAgent` are request forensics that
 * would leak staff network detail to any app with read access.
 */
export const PROVENANCE_DROPPED_FIELDS = [
  'tenantId',
  'seq',
  'prevHash',
  'hash',
  'sourceIp',
  'userAgent',
  'metadata',
  'patientId',
  'encounterId',
  'facilityId',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainProvenance} to a FHIR R4 `Provenance`. */
export function toFhirProvenance(input: DomainProvenance): fhir4.Provenance {
  const target: fhir4.Reference =
    input.targetId === undefined || input.targetId === ''
      ? { type: input.targetType }
      : fhirReference(input.targetType, input.targetId);

  const who: fhir4.Reference =
    input.actorType === 'user'
      ? fhirReference('Practitioner', input.actorId, input.actorDisplay)
      : compact<fhir4.Reference>({
          identifier: isPresentString(input.actorId)
            ? { system: ACTOR_SYSTEM, value: input.actorId }
            : undefined,
          display: input.actorDisplay,
        });

  return compact<fhir4.Provenance>({
    resourceType: 'Provenance',
    id: input.id,
    extension: present<fhir4.Extension>([
      booleanExtension(BREAKGLASS_EXTENSION, input.breakglass),
      codeExtension(AUDIT_OUTCOME_EXTENSION, input.outcome),
    ]),
    target: [target],
    recorded: input.occurredAt,
    activity: codeableConcept({ system: AUDIT_ACTION_SYSTEM, code: input.action }),
    reason: present<fhir4.CodeableConcept>([
      codeableConcept({ system: SYSTEMS.actReason, code: input.purposeOfUse }),
    ]),
    agent: [
      compact<fhir4.ProvenanceAgent>({
        type: codeableConcept({ system: ACTOR_TYPE_SYSTEM, code: input.actorType }),
        who,
      }),
    ],
  });
}

/** Maps a FHIR R4 `Provenance` back to a {@link DomainProvenance}. */
export function fromFhirProvenance(resource: fhir4.Provenance): DomainProvenance {
  const target = resource.target?.[0];
  const agent = resource.agent?.[0];
  const who = agent?.who;
  const actorType = readCode(agent?.type, ACTOR_TYPE_SYSTEM) ?? '';
  const actorId =
    actorType === 'user'
      ? (referenceId(who, 'Practitioner') ?? '')
      : (readString(who?.identifier?.value) ?? '');

  const domain: DomainProvenance = {
    id: resource.id ?? '',
    targetType: referenceType(target) ?? '',
    occurredAt: resource.recorded ?? '',
    actorType,
    actorId,
    action: readCode(resource.activity, AUDIT_ACTION_SYSTEM) ?? '',
    breakglass: readBooleanExtension(resource.extension, BREAKGLASS_EXTENSION) ?? false,
    outcome: readCodeExtension(resource.extension, AUDIT_OUTCOME_EXTENSION) ?? '',
  };
  setOptional(domain, 'targetId', referenceId(target));
  setOptional(domain, 'actorDisplay', readString(who?.display));
  setOptional(domain, 'purposeOfUse', readCode(resource.reason?.[0], SYSTEMS.actReason));
  return domain;
}
