import {
  toFhirImagingStudy,
  toFhirAllergyIntolerance,
  toFhirAppointment,
  toFhirClaim,
  toFhirCondition,
  toFhirCoverage,
  toFhirMedicationDispense,
  toFhirCarePlan,
  toFhirGoal,
  toFhirCareTeam,
  toFhirProcedure,
  toFhirRelatedPerson,
  toFhirDiagnosticReport,
  toFhirDocumentReference,
  toFhirEncounter,
  toFhirImmunization,
  toFhirLocation,
  toFhirOrganization,
  toFhirMedicationRequest,
  toFhirMedicationStatement,
  toFhirObservation,
  toFhirPractitioner,
  toFhirPractitionerRole,
  toFhirProvenance,
  toFhirServiceRequest,
  toFhirSpecimen,
  toFhirTask,
  type AllergyIntolerance,
  type Appointment,
  type Claim,
  type Condition,
  type Coverage,
  type MedicationDispense,
  type CarePlan,
  type Goal,
  type CareTeam,
  type Procedure,
  type RelatedPerson,
  type Questionnaire,
  type QuestionnaireResponse,
  type DiagnosticReport,
  type DocumentReference,
  type Encounter,
  type Immunization,
  type Location,
  type Organization,
  type MedicationRequest,
  type MedicationStatement,
  type Observation,
  type Practitioner,
  type PractitionerRole,
  type Provenance,
  type ServiceRequest,
  type Specimen,
  type Task,
} from '@openrunic/fhir';

import {
  compileDefinition,
  toQuestionnaireResponse,
  type CompiledForm,
  type FormDefinition,
} from '@openrunic/forms-engine';

import { fhirBaseUrl } from '../env.js';
import type { Row, ScopedRow } from '../repositories/rows.js';

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

/**
 * A grant of a role to a user, as FHIR's PractitionerRole.
 *
 * The resource that answers "who may do what, and where" - which a directory
 * client asks before it asks anything else. It is assembled from three rows
 * rather than one: the grant itself, the role it names and the user it binds,
 * because FHIR models as one resource what this schema models as a grant plus
 * its context.
 *
 * The role key travels as the code rather than the role's display name. A
 * receiving system matches on codes, and a tenant that renamed `provider` to
 * "Clinician (MD)" would otherwise stop matching without anything having
 * changed about who the person is.
 *
 * ## `location` comes from where they work, narrowed by where the grant applies
 *
 * Two tables have a facility on them and they answer different questions.
 * `UserFacility` is a directory statement: this person works here.
 * `RoleAssignment.facilityId` is an authorisation statement: this permission
 * applies here and not there. They coincide often enough to be mistaken for
 * each other, and reading the wrong one gives the wrong answer in both
 * directions.
 *
 * FHIR's `location` is the directory question - the locations at which this
 * practitioner provides care - so it is built from the facility grants:
 *
 * - An organisation-wide assignment: every facility the person works at. The
 *   grant is not scoped to a place, so nothing narrows the list. Reading the
 *   assignment instead returned nothing at all for a nurse who works at three
 *   sites, which is the case that made this wrong rather than merely imprecise.
 * - A site-scoped assignment: the intersection. The grant applies at one
 *   facility, so the role is held there and only there, whatever else the
 *   person's working pattern is.
 *
 * The intersection can be empty - a role granted at a site the person is not
 * attached to. That emits no `location` rather than an empty array, and the
 * distinction is the same one as everywhere else here: an empty array is a
 * positive claim that this practitioner provides care nowhere, and a referring
 * practice would believe it. An absent element says only that this server is
 * not answering the question, which is what is true of an inconsistent pair of
 * grants nobody has reconciled.
 */
export function practitionerRoleResource(
  row: ScopedRow<'RoleAssignment'>,
  context: {
    roleKey?: string;
    email?: string;
    active?: boolean;
    /**
     * The user's NUCC taxonomy code, when the practice recorded one.
     *
     * From `User.taxonomyCode` rather than hard-coded empty. An empty specialty
     * list is the same false claim as an empty `location`: a directory client
     * reading it concludes the practitioner has no recorded specialty, which is
     * exactly the field a referring practice filters on.
     */
    taxonomyCode?: string;
    /**
     * The newest timestamp among the rows this resource is built from, other
     * than the grant itself.
     *
     * The user row and the facility grants both feed the resource - the first
     * decides `active` and `specialty`, the second decides `location` - and
     * neither is touched when the other changes. Without the newest of them the
     * resource keeps the assignment's stamp and an incremental export silently
     * omits a resource that changed. `resources.ts` says what this still cannot
     * see, which is a deleted facility grant.
     */
    userUpdatedAt?: Date;
    /**
     * The facilities this practitioner works at, from `UserFacility`.
     *
     * Not from the grant's own `facilityId`, which answers a different
     * question - see the header.
     */
    worksAt: readonly string[];
  }
): PractitionerRole {
  const resource = toFhirPractitionerRole(
    compactDomain({
      id: row.id,
      practitionerId: row.userId,
      organizationId: row.tenantId,
      // `compact` in the mapper drops an empty array, so an empty result emits
      // no `location` element at all rather than an empty one. See the header.
      locationIds:
        row.facilityId === null
          ? [...context.worksAt]
          : context.worksAt.filter((facilityId) => facilityId === row.facilityId),
      // The code the practice recorded against its own user, not a code this
      // repository supplies. What openrunic does not ship is the NUCC display
      // table, so the coding carries a code and a system and no display text -
      // which is why an absent code stays absent rather than being filled from
      // a lookup that is not here.
      specialtyCodes: context.taxonomyCode === undefined ? [] : [context.taxonomyCode],
      roleCode: context.roleKey,
      email: context.email,
      active: context.active,
    })
  );

  // The grant row does not move when the user it names is deactivated, so the
  // resource declares the later of the two and `stampLastUpdated` keeps it.
  // Without this an `$export?_since=` between the two timestamps drops a
  // PractitionerRole whose `active` had just flipped, and reports success.
  return context.userUpdatedAt === undefined
    ? resource
    : { ...resource, meta: { ...resource.meta, lastUpdated: context.userUpdatedAt.toISOString() } };
}

/**
 * The tenant's own organisation.
 *
 * Thin on purpose. `Organisation` holds the practice's name and its deployment
 * state, and nothing else a directory client would want: no NPI, no address, no
 * telephone. Those live on `Facility`, which is what `Location` serves. So this
 * emits the identity and the `prov` type and stops, rather than inventing a
 * postal address out of the first facility - a client cannot tell an invented
 * address from a recorded one, and the practice may have several sites.
 *
 * `status` is deployment state rather than a clinical fact, so only `ACTIVE`
 * maps to `active: true`; a suspended tenant is not an active organisation.
 */
export function organizationResource(row: Row<'Organisation'>): Organization {
  return toFhirOrganization(
    compactDomain({
      id: row.id,
      name: row.name,
      typeCode: 'prov',
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

/**
 * What a dispense needs from beyond its own posting.
 *
 * A posting says who and when; the movements hanging off it say which product,
 * how much and from which lot. Both are loaded per page rather than per row.
 */
export interface DispensePageData {
  readonly movementsByPosting: ReadonlyMap<string, readonly ScopedRow<'StockMovement'>[]>;
  readonly itemsById: ReadonlyMap<string, ScopedRow<'StockItem'>>;
  readonly lotsById: ReadonlyMap<string, ScopedRow<'StockLot'>>;
}

/**
 * Medicine handed to a patient, from the stock posting that recorded it.
 *
 * One resource per posting, using its first movement for the product. A
 * posting of kind DISPENSE is one hand-over, and the ledger writes one movement
 * per lot it came from, so a second movement means the same medicine drawn from
 * two lots rather than a second medicine. The first lot is the one reported; a
 * split across lots is rare and losing the second lot number is a smaller wrong
 * answer than inventing a second dispense with an id nothing can address.
 */
export function medicationDispenseResource(
  row: ScopedRow<'StockPosting'>,
  page: DispensePageData
): MedicationDispense {
  const movements = page.movementsByPosting.get(row.id) ?? [];
  const first = movements[0];
  const item = first === undefined ? undefined : page.itemsById.get(first.itemId);
  const lot = first === undefined ? undefined : page.lotsById.get(first.lotId);

  return toFhirMedicationDispense(
    compactDomain({
      id: row.id,
      patientId: row.patientId ?? '',
      encounterId: absent(row.encounterId),
      prescriptionId: absent(row.prescriptionId),
      rxnormCode: absent(item?.rxnormCode ?? null),
      ndcCode: absent(item?.ndcCode ?? null),
      /* The ledger cannot hold a movement without an item, so an absent name
         means the item row is gone rather than unnamed. Saying so beats an
         empty string, which reads as a product with no name. */
      medicationDisplay: item?.name ?? 'Unknown product',
      quantityValue: first === undefined ? undefined : Number(first.quantity),
      quantityUnit: absent(item?.unit ?? null),
      whenHandedOver: row.occurredOn.toISOString(),
      performerId: row.postedById,
      lotNumber: absent(lot?.lotNumber ?? null),
    })
  );
}

/**
 * The row's definition, rebuilt into the shape the compiler takes.
 *
 * The columns and the JSON document are two halves of one definition: key,
 * version, title, description and binding live as columns because they are
 * queried, and the fields live in `definition` because nothing queries inside
 * them. The compiler wants them back together.
 */
export function compileFormRow(row: ScopedRow<'FormDefinition'>): CompiledForm {
  const baseUrl = fhirBaseUrl();
  const document = (row.definition ?? {}) as { fields?: unknown };
  const result = compileDefinition(
    {
      key: row.key,
      version: row.version,
      title: row.title,
      ...(row.description === null ? {} : { description: row.description }),
      bindTo: row.bindTo,
      fields: (document.fields ?? []) as FormDefinition['fields'],
    },
    /*
     * The canonical base is the deployment's own. Left unset the compiler
     * falls back to this project's domain, and a self-hosted practice would
     * publish Questionnaires claiming a canonical URL on a host it does not
     * run and nobody can resolve to its forms. `.env.example` says to set it.
     */
    baseUrl === undefined ? {} : { baseUrl }
  );
  if (!result.ok) {
    /* Unreachable for a PUBLISHED row: publishing compiles first. Reaching it
       means the invariant broke, and saying so beats serving a form that
       appears to ask nothing. */
    throw new Error(`form definition ${row.key} v${row.version} is PUBLISHED but does not compile`);
  }
  return result.value;
}

/**
 * A published form, as its FHIR `Questionnaire`.
 *
 * Compiled here from the row's own definition rather than read from the stored
 * `compiled` blob. That blob arrives from whoever called publish, and a
 * standards resource this server puts its name to should be derived from the
 * record, not from something a client handed us.
 *
 * Compiling cannot fail for a row this module serves, and that is an invariant
 * rather than an assumption: `publishDefinition` compiles first, so a
 * definition that will not compile can never reach PUBLISHED, and the module
 * searches PUBLISHED only. If it does fail, the invariant has broken and the
 * honest answer is an error rather than a Questionnaire with no items, which a
 * client would read as a form that asks nothing.
 */
export function questionnaireResource(row: ScopedRow<'FormDefinition'>): Questionnaire {
  const compiled = compileFormRow(row);
  return { ...compiled.questionnaire, id: row.id } as unknown as Questionnaire;
}

/**
 * One submitted form, as its FHIR `QuestionnaireResponse`.
 *
 * The item tree comes from `toQuestionnaireResponse` in `packages/forms-engine`,
 * which already handles repeating groups and the columnar answer layout, so
 * this only supplies the row's own metadata and the compiled form it was
 * authored against.
 */
export function questionnaireResponseResource(
  row: ScopedRow<'FormSubmission'>,
  compiled: CompiledForm
): QuestionnaireResponse {
  const response = toQuestionnaireResponse(compiled, {
    values: (row.values ?? {}) as Record<string, unknown>,
    status: row.status,
    authored: (row.completedAt ?? row.effectiveAt).toISOString(),
    subjectReference: `Patient/${row.patientId}`,
  });
  return {
    ...response,
    id: row.id,
    /*
     * The visit the form was filled in during, when there was one. A response
     * that drops it reads as free-floating, and an intake answered at a visit
     * is not the same clinical statement as one answered from home.
     */
    ...(row.encounterId === null
      ? {}
      : { encounter: { reference: `Encounter/${row.encounterId}` } }),
    /*
     * Who filled it in, when a member of staff did. `completedByType` also
     * allows the patient, and the row records no id for them, so an absent
     * author here means "not staff" rather than "unknown".
     */
    ...(row.completedByUserId === null
      ? {}
      : { author: { reference: `Practitioner/${row.completedByUserId}` } }),
  } as unknown as QuestionnaireResponse;
}

/** A procedure performed, from its own row. */
export function procedureResource(row: ScopedRow<'Procedure'>): Procedure {
  return toFhirProcedure(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      code: row.code,
      codeSystem: row.codeSystem,
      display: row.display,
      snomedCode: absent(row.snomedCode),
      status: row.status,
      performedStart: row.performedStart.toISOString(),
      performedEnd: row.performedEnd?.toISOString(),
      bodySiteCode: absent(row.bodySiteCode),
      outcomeCode: absent(row.outcomeCode),
      notDoneReason: absent(row.notDoneReason),
      note: absent(row.note),
      performedById: absent(row.performedById),
    })
  );
}

/**
 * A goal, from its own row.
 *
 * The three target bounds are `Decimal` columns and are read here as plain
 * numbers, which they already are: `toPlainRow` flattens every decimal once, at
 * the row boundary, so nothing above it has to know. Converting again here
 * would be a second answer to a question already settled, and the kind of
 * duplicate that goes stale when the first one changes.
 */
export function goalResource(row: ScopedRow<'Goal'>): Goal {
  return toFhirGoal(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      carePlanId: absent(row.carePlanId),
      lifecycleStatus: row.lifecycleStatus,
      achievementStatus: absent(row.achievementStatus),
      priority: absent(row.priority),
      description: row.description,
      descriptionCode: absent(row.descriptionCode),
      descriptionSystem: absent(row.descriptionSystem),
      targetMeasureCode: absent(row.targetMeasureCode),
      targetMeasureSystem: absent(row.targetMeasureSystem),
      targetValue: absent(row.targetValue),
      targetLow: absent(row.targetLow),
      targetHigh: absent(row.targetHigh),
      targetUnit: absent(row.targetUnit),
      startDate: row.startDate?.toISOString().slice(0, 10),
      dueDate: row.dueDate?.toISOString().slice(0, 10),
      statusReason: absent(row.statusReason),
      expressedByUserId: absent(row.expressedByUserId),
    })
  );
}

/** The assessment and plan, from its own row. */
export function carePlanResource(row: ScopedRow<'CarePlan'>): CarePlan {
  return toFhirCarePlan(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      status: row.status,
      intent: row.intent,
      title: absent(row.title),
      narrative: row.narrative,
      periodStart: row.periodStart?.toISOString(),
      periodEnd: row.periodEnd?.toISOString(),
      authorId: absent(row.authorId),
    })
  );
}

/**
 * A care team, with the members that make it one.
 *
 * Takes its participants rather than fetching them, because the loader has
 * already read every member for the whole page: a lookup here would be one
 * round trip per team, which looks fine against three fixtures and degrades
 * with page size.
 *
 * `meta.lastUpdated` is the later of the team and its newest member, not the
 * team's own. Adding or removing a member changes the resource and does not
 * touch the team row, so the team's stamp would leave an
 * `$export?_since=` between the two instants excluding a team whose membership
 * had just changed. The consumer would never learn a clinician left, and
 * nothing would report an error.
 */
export function careTeamResource(
  row: ScopedRow<'CareTeam'>,
  participants: readonly ScopedRow<'CareTeamParticipant'>[]
): CareTeam {
  const resource = toFhirCareTeam(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      status: row.status,
      name: absent(row.name),
      periodStart: row.periodStart?.toISOString(),
      periodEnd: row.periodEnd?.toISOString(),
      participants: participants.map((participant) =>
        compactDomain({
          id: participant.id,
          memberType: participant.memberType,
          memberUserId: absent(participant.memberUserId),
          memberRelatedPersonId: absent(participant.memberRelatedPersonId),
          roleCode: participant.roleCode,
          roleSystem: participant.roleSystem,
          roleText: absent(participant.roleText),
          periodStart: participant.periodStart?.toISOString(),
          periodEnd: participant.periodEnd?.toISOString(),
        })
      ),
    })
  );

  const newest = participants.reduce<Date | undefined>(
    (latest, participant) =>
      latest === undefined || participant.updatedAt > latest ? participant.updatedAt : latest,
    undefined
  );
  if (newest === undefined || newest <= row.updatedAt) return resource;
  return { ...resource, meta: { ...resource.meta, lastUpdated: newest.toISOString() } };
}

/**
 * A guardian, an emergency contact or a portal proxy, as US Core sees them.
 *
 * The three booleans on the row become relationship codings and one extension
 * inside the mapper rather than here, so that the C-CDA and HL7 v2 paths get
 * the same reading of them if they ever need it.
 */
export function relatedPersonResource(row: ScopedRow<'RelatedPerson'>): RelatedPerson {
  return toFhirRelatedPerson(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      relationshipCode: row.relationshipCode,
      relationshipText: absent(row.relationshipText),
      givenName: row.givenName,
      familyName: row.familyName,
      phone: absent(row.phone),
      email: absent(row.email),
      addressLine1: absent(row.addressLine1),
      city: absent(row.city),
      state: absent(row.state),
      postalCode: absent(row.postalCode),
      country: row.country,
      isGuardian: row.isGuardian,
      isEmergencyContact: row.isEmergencyContact,
      isPortalProxy: row.isPortalProxy,
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

/**
 * An audit event as US Core Provenance.
 *
 * The audit log is the right source for this and not merely a convenient one:
 * it is append-only, hash-chained, and written by the same code path that
 * performs the action, so a Provenance derived from it cannot claim an author
 * the record does not have. Deriving it from the target row instead would give
 * an answer assembled after the fact.
 *
 * What is deliberately NOT carried across is listed in PROVENANCE_DROPPED_FIELDS
 * in `packages/fhir`: the chain columns (`seq`, `prevHash`, `hash`) are the
 * tamper-evidence mechanism and belong to the audit export rather than to a
 * resource any SMART app can read, and `sourceIp` and `userAgent` are request
 * forensics that would hand a third-party app a map of staff network layout.
 * The mapper takes a DomainProvenance, which has no field for either, so this
 * is enforced by the shape rather than by remembering.
 */
export function provenanceResource(row: ScopedRow<'AuditEvent'>): Provenance {
  return toFhirProvenance(
    compactDomain({
      id: row.id,
      targetType: row.targetType,
      targetId: absent(row.targetId),
      occurredAt: row.occurredAt.toISOString(),
      actorType: row.actorType,
      actorId: row.actorId,
      actorDisplay: absent(row.actorDisplay),
      action: row.action,
      purposeOfUse: absent(row.purposeOfUse),
      breakglass: row.breakglass,
      outcome: row.outcome,
    })
  );
}

/**
 * A claim as submitted, with its lines.
 *
 * The lines arrive through `prepared` rather than being fetched here: a bundle
 * of claims would otherwise be one query per claim, which is fine with the three
 * fixtures a test seeds and not fine on a payer's page of fifty.
 *
 * The billing provider is passed in for the same reason. A Claim row has no
 * provider column - it carries an encounter, and the provider is the
 * encounter's - so resolving it here would be a second query per claim on top
 * of the lines.
 *
 * `units` is a Decimal in the database because a claim can bill a fraction of a
 * unit, and DomainClaimLine wants a number, so it is converted once here rather
 * than left for the mapper to guess at.
 */
/** Who a claim names as its biller, and which kind of thing that is. */
export interface ClaimBiller {
  readonly id: string;
  readonly type: 'Practitioner' | 'Organization';
}

export function claimResource(
  row: ScopedRow<'Claim'>,
  lines: readonly ScopedRow<'ClaimLine'>[],
  biller: ClaimBiller
): Claim {
  return toFhirClaim(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      coverageId: row.coverageId,
      payerId: row.payerId,
      providerId: biller.id,
      providerType: biller.type,
      status: row.status,
      frequency: row.frequency,
      diagnosisCodes: row.diagnosisCodes,
      totalChargedCents: row.totalChargedCents,
      createdAt: row.createdAt.toISOString(),
      lines: lines.map((line) => ({
        sequence: line.sequence,
        code: line.code,
        codeSystem: line.codeSystem,
        modifiers: line.modifiers,
        units: Number(line.units),
        chargedCents: line.chargedCents,
        diagnosisPointers: line.diagnosisPointers,
        serviceDateFrom: line.serviceDateFrom.toISOString().slice(0, 10),
        ...(line.serviceDateTo === null
          ? {}
          : { serviceDateTo: line.serviceDateTo.toISOString().slice(0, 10) }),
      })),
    })
  );
}

/**
 * An imaging study, as FHIR sees it.
 *
 * `diagnosticReportId` is deliberately not projected. The link travels the
 * other way, from the report to the study, and carrying it in both directions
 * would give one association two records that can disagree about which report
 * read which study.
 */
export function imagingStudyResource(row: ScopedRow<'ImagingStudy'>): fhir4.ImagingStudy {
  return toFhirImagingStudy(
    compactDomain({
      id: row.id,
      patientId: row.patientId,
      encounterId: absent(row.encounterId),
      serviceRequestId: absent(row.serviceRequestId),
      studyInstanceUid: row.studyInstanceUid,
      accessionNumber: absent(row.accessionNumber),
      modalities: row.modalities,
      description: absent(row.description),
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      numberOfSeries: row.numberOfSeries,
      numberOfInstances: row.numberOfInstances,
      retrieveUrl: absent(row.retrieveUrl),
    })
  );
}
