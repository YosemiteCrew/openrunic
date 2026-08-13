import {
  toFhirAllergyIntolerance,
  toFhirAppointment,
  toFhirCondition,
  toFhirCoverage,
  toFhirDiagnosticReport,
  toFhirDocumentReference,
  toFhirEncounter,
  toFhirImmunization,
  toFhirLocation,
  toFhirMedicationRequest,
  toFhirMedicationStatement,
  toFhirObservation,
  toFhirPractitioner,
  toFhirServiceRequest,
  toFhirSpecimen,
  toFhirTask,
  type AllergyIntolerance,
  type Appointment,
  type Condition,
  type Coverage,
  type DiagnosticReport,
  type DocumentReference,
  type Encounter,
  type Immunization,
  type Location,
  type MedicationRequest,
  type MedicationStatement,
  type Observation,
  type Practitioner,
  type ServiceRequest,
  type Specimen,
  type Task,
} from '@openrunic/fhir';

import type { ScopedRow } from '../repositories/rows.js';

/**
 * Stored rows, projected onto the domain shapes `packages/fhir` maps from.
 *
 * These are projections, not mappers. The package owns the translation in both
 * directions and has the round-trip tests ADR-0002 requires; all that happens
 * here is the change of spelling between how Postgres holds a value (`Date`,
 * `null`, a non-null column with a default) and how the package's domain shapes
 * spell it (ISO strings, an absent key, never an empty one).
 *
 * A mapper written on both sides of a package boundary is a mapper that
 * eventually disagrees with itself, so there is exactly one, and this file is
 * not it.
 */

/** Converts the storage spelling of absence into the domain spelling of it. */
function absent<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

function instant(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

function dateOnly(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString().slice(0, 10);
}

/**
 * Drops the keys that came out `undefined`.
 *
 * The package's round-trip guarantee distinguishes an absent key from an empty
 * value, and an own property holding `undefined` serializes differently from
 * one that was never there. Building the object and then compacting it keeps
 * the projections readable without giving that distinction away.
 */
function compactDomain<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function practitionerResource(row: ScopedRow<'User'>): Practitioner {
  return toFhirPractitioner(
    compactDomain({
      id: row.id,
      familyName: row.familyName,
      givenNames: [row.givenName],
      credential: absent(row.credential),
      npi: absent(row.npi),
      dea: absent(row.dea),
      email: row.email,
      active: row.status === 'ACTIVE',
    })
  );
}

export function locationResource(row: ScopedRow<'Facility'>): Location {
  return toFhirLocation(
    compactDomain({
      id: row.id,
      name: row.name,
      code: row.code,
      npi: absent(row.npi),
      posCode: absent(row.posCode),
      managingOrganizationId: row.tenantId,
      phone: absent(row.phone),
      addressLine1: absent(row.addressLine1),
      addressLine2: absent(row.addressLine2),
      city: absent(row.city),
      state: absent(row.state),
      postalCode: absent(row.postalCode),
      country: row.country,
      active: row.active,
    })
  );
}

export function coverageResource(row: ScopedRow<'Coverage'>): Coverage {
  return toFhirCoverage(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      payerId: row.payerId,
      rank: row.rank,
      status: row.status,
      memberId: row.memberId,
      groupNumber: absent(row.groupNumber),
      planName: absent(row.planName),
      subscriberRelationshipCode: row.subscriberRelationshipCode,
      effectiveFrom: dateOnly(row.effectiveFrom),
      effectiveTo: dateOnly(row.effectiveTo),
      copayCents: absent(row.copayCents),
      deductibleCents: absent(row.deductibleCents),
    })
  );
}

export function appointmentResource(row: ScopedRow<'Appointment'>): Appointment {
  return toFhirAppointment(
    compactDomain({
      id: row.id,
      facilityId: row.facilityId,
      patientId: absent(row.patientId),
      providerId: row.providerId,
      typeCode: row.typeCode,
      typeDisplay: row.typeDisplay,
      status: row.status,
      start: row.start.toISOString(),
      end: row.end.toISOString(),
      durationMinutes: row.durationMinutes,
      reasonText: absent(row.reasonText),
      cancelReason: absent(row.cancelReason),
    })
  );
}

export function encounterResource(row: ScopedRow<'Encounter'>): Encounter {
  return toFhirEncounter(
    compactDomain({
      id: row.id,
      facilityId: row.facilityId,
      patientId: row.patientId,
      providerId: row.providerId,
      appointmentId: absent(row.appointmentId),
      class: row.class,
      status: row.status,
      reasonCode: absent(row.reasonCode),
      reasonText: absent(row.reasonText),
      startedAt: row.startedAt.toISOString(),
      endedAt: instant(row.endedAt),
    })
  );
}

export function conditionResource(row: ScopedRow<'Condition'>): Condition {
  return toFhirCondition(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      category: row.category,
      code: row.code,
      codeSystem: row.codeSystem,
      display: row.display,
      snomedCode: absent(row.snomedCode),
      clinicalStatus: row.clinicalStatus,
      verificationStatus: row.verificationStatus,
      onsetDate: dateOnly(row.onsetDate),
      abatementDate: dateOnly(row.abatementDate),
      severityCode: absent(row.severityCode),
      bodySiteCode: absent(row.bodySiteCode),
      note: absent(row.note),
      recordedAt: row.recordedAt.toISOString(),
    })
  );
}

export function medicationRequestResource(row: ScopedRow<'MedicationRequest'>): MedicationRequest {
  return toFhirMedicationRequest(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      prescriberId: row.prescriberId,
      rxnormCode: absent(row.rxnormCode),
      ndcCode: absent(row.ndcCode),
      display: row.display,
      sigText: row.sigText,
      quantity: row.quantity,
      quantityUnit: row.quantityUnit,
      refills: row.refills,
      daysSupply: absent(row.daysSupply),
      dispenseAsWritten: row.dispenseAsWritten,
      pharmacyName: absent(row.pharmacyName),
      pharmacyNcpdpId: absent(row.pharmacyNcpdpId),
      status: row.status,
      intent: row.intent,
      writtenAt: row.writtenAt.toISOString(),
    })
  );
}

export function medicationStatementResource(
  row: ScopedRow<'MedicationStatement'>
): MedicationStatement {
  return toFhirMedicationStatement(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      rxnormCode: absent(row.rxnormCode),
      display: row.display,
      sigText: absent(row.sigText),
      status: row.status,
      source: row.source,
      effectiveStart: dateOnly(row.effectiveStart),
      effectiveEnd: dateOnly(row.effectiveEnd),
      reportedAt: row.reportedAt.toISOString(),
      note: absent(row.note),
    })
  );
}

export function allergyResource(row: ScopedRow<'AllergyIntolerance'>): AllergyIntolerance {
  return toFhirAllergyIntolerance(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      type: row.type,
      category: row.category,
      criticality: row.criticality,
      clinicalStatus: row.clinicalStatus,
      substanceCode: absent(row.substanceCode),
      substanceCodeSystem: absent(row.substanceCodeSystem),
      substanceDisplay: row.substanceDisplay,
      reactionCodes: [...row.reactionCodes],
      reactionText: absent(row.reactionText),
      severity: absent(row.severity),
      onsetDate: dateOnly(row.onsetDate),
      note: absent(row.note),
      recordedAt: row.recordedAt.toISOString(),
    })
  );
}

export function immunizationResource(row: ScopedRow<'Immunization'>): Immunization {
  return toFhirImmunization(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      status: row.status,
      cvxCode: row.cvxCode,
      mvxCode: absent(row.mvxCode),
      ndcCode: absent(row.ndcCode),
      display: row.display,
      lotNumber: absent(row.lotNumber),
      expirationDate: dateOnly(row.expirationDate),
      siteCode: absent(row.siteCode),
      routeCode: absent(row.routeCode),
      doseQuantity: absent(row.doseQuantity),
      doseUnit: absent(row.doseUnit),
      administeredAt: row.administeredAt.toISOString(),
      administeredById: absent(row.administeredById),
      visDate: dateOnly(row.visDate),
      refusalReasonCode: absent(row.refusalReasonCode),
    })
  );
}

export function observationResource(row: ScopedRow<'Observation'>): Observation {
  return toFhirObservation(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      category: row.category,
      status: row.status,
      code: row.code,
      codeSystem: row.codeSystem,
      display: row.display,
      valueNumber: absent(row.valueNumber),
      valueText: absent(row.valueText),
      valueCode: absent(row.valueCode),
      valueBoolean: absent(row.valueBoolean),
      unit: absent(row.unit),
      referenceLow: absent(row.referenceLow),
      referenceHigh: absent(row.referenceHigh),
      interpretationCode: absent(row.interpretationCode),
      bodySiteCode: absent(row.bodySiteCode),
      effectiveAt: row.effectiveAt.toISOString(),
      issuedAt: instant(row.issuedAt),
      performerId: absent(row.performerId),
    })
  );
}

export function diagnosticReportResource(
  row: ScopedRow<'DiagnosticReport'>,
  resultIds: readonly string[]
): DiagnosticReport {
  return toFhirDiagnosticReport(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      serviceRequestId: absent(row.serviceRequestId),
      specimenId: absent(row.specimenId),
      status: row.status,
      category: row.category,
      code: row.code,
      codeSystem: row.codeSystem,
      display: row.display,
      performingLabName: absent(row.performingLabName),
      abnormalFlag: row.abnormalFlag,
      narrative: absent(row.narrative),
      resultIds: [...resultIds],
      effectiveAt: instant(row.effectiveAt),
      issuedAt: row.issuedAt.toISOString(),
    })
  );
}

export function serviceRequestResource(row: ScopedRow<'ServiceRequest'>): ServiceRequest {
  return toFhirServiceRequest(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      orderedById: row.orderedById,
      category: row.category,
      status: row.status,
      intent: row.intent,
      priority: row.priority,
      code: row.code,
      codeSystem: row.codeSystem,
      display: row.display,
      specimenTypeCode: absent(row.specimenTypeCode),
      reasonCodes: [...row.reasonCodes],
      note: absent(row.note),
      requisitionNumber: absent(row.requisitionNumber),
      performingLabName: absent(row.performingLabName),
      requestedAt: row.requestedAt.toISOString(),
      scheduledFor: instant(row.scheduledFor),
    })
  );
}

export function specimenResource(row: ScopedRow<'Specimen'>): Specimen {
  return toFhirSpecimen(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      serviceRequestId: absent(row.serviceRequestId),
      status: row.status,
      accessionNumber: absent(row.accessionNumber),
      typeCode: row.typeCode,
      typeDisplay: row.typeDisplay,
      collectionMethodCode: absent(row.collectionMethodCode),
      bodySiteCode: absent(row.bodySiteCode),
      collectedAt: instant(row.collectedAt),
      collectedById: absent(row.collectedById),
      receivedAt: instant(row.receivedAt),
      containerType: absent(row.containerType),
      volumeValue: absent(row.volumeValue),
      volumeUnit: absent(row.volumeUnit),
      rejectionReason: absent(row.rejectionReason),
      note: absent(row.note),
    })
  );
}

export function documentReferenceResource(row: ScopedRow<'Document'>): DocumentReference {
  return toFhirDocumentReference(
    compactDomain({
      id: row.id,
      patientId: absent(row.patientId),
      encounterId: absent(row.encounterId),
      category: row.category,
      title: row.title,
      // The object-storage key never crosses the boundary: it is an internal
      // routing detail, and publishing it would hand a client a path into the
      // bucket. What a client gets is the reference it can actually fetch.
      url: `Binary/${row.id}`,
      contentType: row.contentType,
      sha256: row.sha256,
      byteSize: row.byteSize,
      source: row.source,
      status: row.status,
      sensitivityClass: row.sensitivityClass,
      receivedAt: row.receivedAt.toISOString(),
    })
  );
}

export function taskResource(row: ScopedRow<'Task'>): Task {
  return toFhirTask(
    compactDomain({
      id: row.id,
      type: row.type,
      status: row.status,
      priority: row.priority,
      patientId: absent(row.patientId),
      encounterId: absent(row.encounterId),
      subjectType: absent(row.subjectType),
      subjectId: absent(row.subjectId),
      title: row.title,
      description: absent(row.description),
      assigneeType: row.assigneeType,
      assigneeUserId: absent(row.assigneeUserId),
      assigneeTeamKey: absent(row.assigneeTeamKey),
      dueAt: instant(row.dueAt),
      completedAt: instant(row.completedAt),
      outcome: absent(row.outcome),
    })
  );
}
