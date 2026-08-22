import type { PrismaClient } from '../generated/prisma/client.js';
import { TENANT_SETTING } from '../rls.js';
import { buildDemoPractice, demoOrganisationId } from './data.js';
import type { DemoPractice, DemoPracticeOptions } from './data.js';

export { buildDemoPractice, demoOrganisationId } from './data.js';
export type { DemoPractice, DemoPracticeOptions } from './data.js';

/** Row counts written, keyed by table, for the CLI to print and tests to assert. */
export type SeedSummary = Record<string, number>;

/**
 * Writes the synthetic demo practice.
 *
 * One transaction: either the whole practice lands or none of it does, so a
 * failure halfway through never leaves a half-built chart behind. Insert order
 * follows the foreign keys, and every row already carries the id it was built
 * with, so nothing needs a round-trip to learn a generated key.
 *
 * This takes a root PrismaClient rather than a tenant client on purpose: it
 * creates the tenant, so there is no tenant to scope it to yet.
 *
 * It still has to announce that tenant to Postgres. Every table forces
 * row-level security, which applies to the table owner too, so the seed - which
 * runs as the owner - is filtered exactly like the application. The first
 * statement in the transaction below sets the organisation the practice is
 * about to be written under; without it the very first insert fails the
 * `Organisation` policy's WITH CHECK and the whole seed rolls back.
 */
export async function seedDemoPractice(
  client: PrismaClient,
  options: DemoPracticeOptions = {}
): Promise<SeedSummary> {
  const practice = buildDemoPractice(options);
  const summary: SeedSummary = {};

  // The id the API's demo-token resolver will open its session with. Asserted
  // here rather than trusted, because that resolver cannot query for it: under
  // row-level security an undeclared connection sees no organisations at all,
  // so a mismatch would surface as every token answering 401 with nothing in
  // any log to say why. Only reachable by seeding with a custom `today`, which
  // nothing in this repository does.
  if (practice.organisation.id !== demoOrganisationId()) {
    throw new Error(
      `seedDemoPractice: this practice would be written under ${practice.organisation.id}, but demoOrganisationId() answers ${demoOrganisationId()}. The API's demo-token resolver opens its session with the latter and would find nothing.`
    );
  }

  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${practice.organisation.id}, true)`;
    await tx.organisation.create({ data: practice.organisation });
    summary.organisation = 1;

    // Ordered by dependency: a table only appears after everything it points at.
    const steps: readonly [keyof DemoPractice, () => Promise<{ count: number }>][] = [
      ['facilities', () => tx.facility.createMany({ data: practice.facilities })],
      ['users', () => tx.user.createMany({ data: practice.users })],
      ['userFacilities', () => tx.userFacility.createMany({ data: practice.userFacilities })],
      ['roles', () => tx.role.createMany({ data: practice.roles })],
      ['permissions', () => tx.permission.createMany({ data: practice.permissions })],
      ['rolePermissions', () => tx.rolePermission.createMany({ data: practice.rolePermissions })],
      ['roleAssignments', () => tx.roleAssignment.createMany({ data: practice.roleAssignments })],
      [
        'terminologyCodes',
        () => tx.terminologyCode.createMany({ data: practice.terminologyCodes }),
      ],
      ['payers', () => tx.payer.createMany({ data: practice.payers })],
      ['formDefinitions', () => tx.formDefinition.createMany({ data: practice.formDefinitions })],
      ['patients', () => tx.patient.createMany({ data: practice.patients })],
      [
        'patientIdentifiers',
        () => tx.patientIdentifier.createMany({ data: practice.patientIdentifiers }),
      ],
      ['relatedPersons', () => tx.relatedPerson.createMany({ data: practice.relatedPersons })],
      ['coverages', () => tx.coverage.createMany({ data: practice.coverages })],
      ['appointments', () => tx.appointment.createMany({ data: practice.appointments })],
      [
        'appointmentStatusHistory',
        () => tx.appointmentStatusHistory.createMany({ data: practice.appointmentStatusHistory }),
      ],
      ['encounters', () => tx.encounter.createMany({ data: practice.encounters })],
      ['clinicalNotes', () => tx.clinicalNote.createMany({ data: practice.clinicalNotes })],
      ['noteAddenda', () => tx.noteAddendum.createMany({ data: practice.noteAddenda })],
      ['conditions', () => tx.condition.createMany({ data: practice.conditions })],
      ['allergies', () => tx.allergyIntolerance.createMany({ data: practice.allergies })],
      [
        'medicationStatements',
        () => tx.medicationStatement.createMany({ data: practice.medicationStatements }),
      ],
      [
        'medicationRequests',
        () => tx.medicationRequest.createMany({ data: practice.medicationRequests }),
      ],
      ['immunizations', () => tx.immunization.createMany({ data: practice.immunizations })],
      ['serviceRequests', () => tx.serviceRequest.createMany({ data: practice.serviceRequests })],
      ['specimens', () => tx.specimen.createMany({ data: practice.specimens })],
      [
        'diagnosticReports',
        () => tx.diagnosticReport.createMany({ data: practice.diagnosticReports }),
      ],
      [
        'resultObservations',
        () => tx.resultObservation.createMany({ data: practice.resultObservations }),
      ],
      ['documents', () => tx.document.createMany({ data: practice.documents })],
      ['formSubmissions', () => tx.formSubmission.createMany({ data: practice.formSubmissions })],
      [
        'formPromotedValues',
        () => tx.formPromotedValue.createMany({ data: practice.formPromotedValues }),
      ],
      // Observations come after form submissions: a promoted vital can point at
      // the submission it came from.
      ['observations', () => tx.observation.createMany({ data: practice.observations })],
      ['consentGrants', () => tx.consentGrant.createMany({ data: practice.consentGrants })],
      ['messageThreads', () => tx.messageThread.createMany({ data: practice.messageThreads })],
      ['messages', () => tx.message.createMany({ data: practice.messages })],
      ['tasks', () => tx.task.createMany({ data: practice.tasks })],
      ['chargeItems', () => tx.chargeItem.createMany({ data: practice.chargeItems })],
      ['claims', () => tx.claim.createMany({ data: practice.claims })],
      ['claimLines', () => tx.claimLine.createMany({ data: practice.claimLines })],
      [
        'claimStatusHistory',
        () => tx.claimStatusHistory.createMany({ data: practice.claimStatusHistory }),
      ],
      ['remittances', () => tx.remittance.createMany({ data: practice.remittances })],
      ['remittanceLines', () => tx.remittanceLine.createMany({ data: practice.remittanceLines })],
      ['payments', () => tx.payment.createMany({ data: practice.payments })],
      [
        'paymentAllocations',
        () => tx.paymentAllocation.createMany({ data: practice.paymentAllocations }),
      ],
      ['statements', () => tx.statement.createMany({ data: practice.statements })],
      ['auditEvents', () => tx.auditEvent.createMany({ data: practice.auditEvents })],
    ];

    for (const [name, run] of steps) {
      const result = await run();
      summary[name] = result.count;
    }
  });

  return summary;
}
