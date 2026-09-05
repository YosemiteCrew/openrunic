import { buildVxu, parseAck, type Immunisation, type MessageHeader } from '@openrunic/hl7v2';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseQuery } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { ScopedRow } from '../repositories/types.js';
import { gateCharts, repositories } from './helpers.js';

/**
 * IMMUNISATION REGISTRY SUBMISSION, AND WHY IT IS THREE STEPS.
 *
 * Every jurisdiction requires immunisations to be reported to its registry, and
 * `Immunization.reportedToRegistryAt` has been on the model since the beginning
 * with nothing to set it. This sets it - but not when the message is built.
 *
 * ## The defect this shape exists to prevent
 *
 * The obvious design is one endpoint: build the message, send it, stamp the
 * rows. It fails the moment the send fails. The rows are stamped, the practice's
 * outstanding list is empty, the registry has nothing, and nobody finds out
 * until a school asks a parent for a vaccination record the state cannot produce.
 * A silent gap in a public health record is not a defect anybody notices from
 * inside this system.
 *
 * So the stamp is not applied by the endpoint that builds the message. Three
 * steps, and the middle one belongs to somebody else:
 *
 *   1. `GET  .../pending`     what has not been reported
 *   2. `POST .../message`     the VXU for those doses. Stamps nothing.
 *   3. `POST .../acknowledge` the registry accepted them. Stamps.
 *
 * Between two and three sits an interface engine and a socket, which is not this
 * system's job - `packages/hl7v2` reads and writes strings, and transport
 * belongs to whatever carries them. What this owns is refusing to believe a
 * dose was reported until something said so.
 *
 * ## What is deliberately absent
 *
 * Per-jurisdiction configuration. Every registry has its own onboarding, its own
 * sending-facility identifiers, its own required fields and its own opinion
 * about which of them are really required. That belongs with the interface, not
 * in a codec every interface shares - so the sender identity is supplied per
 * request rather than guessed.
 */

const pendingQuerySchema = z.object({
  /** Only doses given on or after this instant. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const senderSchema = z.object({
  sendingApplication: z.string().min(1).max(64),
  sendingFacility: z.string().min(1).max(64),
  receivingApplication: z.string().min(1).max(64),
  receivingFacility: z.string().min(1).max(64),
  /** `P` production, `T` training, `D` debugging. */
  processingId: z.enum(['P', 'T', 'D']),
  version: z.string().min(1).max(16),
});

const messageBodySchema = z.object({
  immunisationIds: z.array(z.uuid()).min(1).max(200),
  sender: senderSchema,
  /** Unique per message; the acknowledgement quotes it back. */
  controlId: z.string().min(1).max(64),
});

const acknowledgeBodySchema = z.object({
  immunisationIds: z.array(z.uuid()).min(1).max(200),
  /**
   * The registry's ACK, verbatim. Parsed rather than trusted: a caller that
   * simply asserted success would put this endpoint back in the position the
   * three-step shape exists to avoid.
   */
  acknowledgement: z.string().min(1),
  /** When the registry accepted them. Supplied, because it already happened. */
  reportedAt: z.coerce.date(),
});

const pendingDoseSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  cvxCode: z.string(),
  display: z.string(),
  administeredAt: z.string(),
  lotNumber: z.string().nullable(),
});

const messageResponseSchema = z.object({
  /** The VXU, as text. Transport is somebody else's job. */
  message: z.string(),
  controlId: z.string(),
  /** What went into it, so a caller can acknowledge exactly these. */
  immunisationIds: z.array(z.string()),
});

const acknowledgeResponseSchema = z.object({
  accepted: z.boolean(),
  acknowledgementCode: z.string(),
  /** Doses now recorded as reported. Empty when the registry did not accept. */
  reported: z.array(z.string()),
  /** The registry's own text, when it sent any. */
  text: z.string().optional(),
});

/** Enough doses for one submission run; a registry batch is not unbounded. */
const PENDING_LIMIT = 200;

export function registryRoutes(router: Hono<AppEnv>): void {
  /**
   * Doses this practice has not yet reported.
   *
   * The work queue. A dose stays on it until something acknowledged it, which
   * is what makes a failed transmission visible rather than silent.
   */
  router.get('/immunisations/registry/pending', requirePermission('encounter.read'), async (c) => {
    const query = parseQuery(c, pendingQuerySchema);
    const rows = await pendingDoses(c, query.limit ?? PENDING_LIMIT, query.from, query.to);
    // The work queue names no chart, so nothing about the request looks like a
    // chart read - and it was answering with `patientId` for charts whose own
    // immunisation list is gated on exactly this (#300).
    await gateCharts(c, 'immunisations', rows);

    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        patientId: row.patientId,
        cvxCode: row.cvxCode,
        display: row.display,
        administeredAt: row.administeredAt.toISOString(),
        lotNumber: row.lotNumber,
      })),
      total: rows.length,
    });
  });

  /**
   * The VXU for a set of doses. Stamps nothing.
   *
   * Building a message is not reporting one, and this endpoint deliberately
   * cannot tell the difference between a message that was sent and one that was
   * generated and thrown away. That is why it does not record anything.
   */
  router.post('/immunisations/registry/message', requirePermission('encounter.read'), async (c) => {
    const body = await parseJsonBody(c, messageBodySchema);
    const repos = repositories(c);

    const doses = await Promise.all(
      body.immunisationIds.map(async (id) => repos.immunisations.findById(id))
    );
    const found = doses.filter((dose): dose is ScopedRow<'Immunization'> => dose !== null);
    if (found.length !== body.immunisationIds.length) {
      // Partly-found is refused rather than partly-reported. A caller that sent
      // a message for four of five doses and acknowledged all five would record
      // one as reported that never left.
      throw ApiError.notFound(
        `Only ${String(found.length)} of ${String(body.immunisationIds.length)} doses were found. A registry message is built for exactly the doses it names.`
      );
    }

    // One message per patient. A VXU carries one PID, so a batch spanning
    // several patients is several messages - and building one with the first
    // patient's demographics and everybody's doses would report every dose
    // against one person.
    const patientIds = new Set(found.map((dose) => dose.patientId));
    if (patientIds.size !== 1) {
      throw ApiError.malformed(
        'A VXU carries one patient. Build one message per patient rather than one for a mixed batch.'
      );
    }

    const patient = await repos.patients.findById(found[0]?.patientId ?? '');
    if (patient === null) throw ApiError.notFound('No such patient.');

    const message = buildVxu({
      header: headerFrom(body.sender, body.controlId, new Date()),
      patient: {
        mrn: patient.mrn,
        familyName: patient.familyName,
        givenName: patient.givenName,
        ...(patient.middleName === null ? {} : { middleName: patient.middleName }),
        birthDate: patient.birthDate.toISOString().slice(0, 10),
        ...(sexOf(patient.sexAtBirth) === undefined ? {} : { sex: sexOf(patient.sexAtBirth) }),
      },
      immunisations: found.map((dose, index) => toImmunisation(dose, index + 1)),
    });

    await c.get('audit')?.write({
      action: 'registry.message.built',
      targetType: 'Patient',
      targetId: patient.id,
      patientId: patient.id,
      metadata: { controlId: body.controlId, doses: found.length },
    });

    return c.json({
      message,
      controlId: body.controlId,
      immunisationIds: found.map((dose) => dose.id),
    });
  });

  /**
   * The registry acknowledged. Only now are the doses recorded as reported.
   *
   * The acknowledgement is parsed rather than taken on trust. `AA` is accepted;
   * `AE` and `AR` are not, and stamping on either would produce exactly the
   * silent gap the three-step shape exists to prevent - so a rejection leaves
   * every dose on the pending list, where somebody will see it.
   */
  router.post(
    '/immunisations/registry/acknowledge',
    requirePermission('encounter.write'),
    async (c) => {
      const body = await parseJsonBody(c, acknowledgeBodySchema);

      let code: string;
      let text: string | undefined;
      try {
        const ack = parseAck(body.acknowledgement);
        code = ack.code;
        text = ack.text;
      } catch (error) {
        throw ApiError.malformed(
          `That acknowledgement could not be read, so nothing was recorded as reported. ${error instanceof Error ? error.message : ''}`
        );
      }

      if (code !== 'AA') {
        await c.get('audit')?.write({
          action: 'registry.rejected',
          targetType: 'Immunization',
          metadata: {
            code,
            doses: body.immunisationIds.length,
            ...(text === undefined ? {} : { text }),
          },
        });

        return c.json({
          accepted: false,
          acknowledgementCode: code,
          reported: [],
          ...(text === undefined ? {} : { text }),
        });
      }

      const repos = repositories(c);
      const reported: string[] = [];
      for (const id of body.immunisationIds) {
        const updated = await repos.immunisations.update(id, {
          reportedToRegistryAt: body.reportedAt,
        });
        if (updated !== null) reported.push(updated.id);
      }

      await c.get('audit')?.write({
        action: 'registry.reported',
        targetType: 'Immunization',
        metadata: { code, doses: reported.length, reportedAt: body.reportedAt.toISOString() },
      });

      return c.json({
        accepted: true,
        acknowledgementCode: code,
        reported,
        ...(text === undefined ? {} : { text }),
      });
    }
  );
}

/**
 * Doses with no report stamp, oldest first.
 *
 * Oldest first because a registry submission that has been failing for a month
 * should surface the month-old dose, not the one given this morning.
 */
async function pendingDoses(
  c: Context<AppEnv>,
  limit: number,
  from?: Date,
  to?: Date
): Promise<ScopedRow<'Immunization'>[]> {
  const page = await repositories(c).immunisations.list({
    page: 1,
    pageSize: limit,
    sort: 'administeredAt',
    order: 'asc',
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  });

  return page.rows.filter((row) => row.reportedToRegistryAt === null);
}

function headerFrom(
  sender: z.infer<typeof senderSchema>,
  controlId: string,
  now: Date
): MessageHeader {
  return {
    sendingApplication: sender.sendingApplication,
    sendingFacility: sender.sendingFacility,
    receivingApplication: sender.receivingApplication,
    receivingFacility: sender.receivingFacility,
    sentAt: now.toISOString(),
    controlId,
    processingId: sender.processingId,
    version: sender.version,
  };
}

function toImmunisation(row: ScopedRow<'Immunization'>, sequence: number): Immunisation {
  return {
    sequence,
    vaccine: { code: row.cvxCode, display: row.display, system: 'CVX' },
    administeredAt: row.administeredAt.toISOString(),
    ...(row.doseQuantity === null ? {} : { amount: String(row.doseQuantity) }),
    ...(row.doseUnit === null ? {} : { units: row.doseUnit }),
    ...(row.lotNumber === null ? {} : { lotNumber: row.lotNumber }),
    ...(row.mvxCode === null ? {} : { manufacturer: { code: row.mvxCode, system: 'MVX' } }),
    ...(row.routeCode === null ? {} : { route: { code: row.routeCode } }),
    ...(row.siteCode === null ? {} : { site: { code: row.siteCode } }),
    // `CP` complete for a dose given, `NA` for one that was not. The status is
    // what a registry uses to tell an administration from a refusal, and
    // reporting a refusal as complete puts a dose on a record nobody gave.
    completionStatus: row.status === 'COMPLETED' ? 'CP' : 'NA',
    ...(row.administeredById === null ? {} : { administeringProviderId: row.administeredById }),
  };
}

function sexOf(sexAtBirth: string): 'M' | 'F' | 'O' | 'U' | undefined {
  if (sexAtBirth === 'MALE') return 'M';
  if (sexAtBirth === 'FEMALE') return 'F';
  if (sexAtBirth === 'OTHER') return 'O';
  return 'U';
}

export function registryRouteContracts(): RouteContract[] {
  const errors = [
    { status: 401, description: 'No bearer token.', schema: problemDocumentSchema },
    { status: 403, description: 'The role lacks the permission.', schema: problemDocumentSchema },
  ];

  return [
    {
      method: 'get',
      path: '/bff/v0/immunisations/registry/pending',
      operationId: 'listPendingRegistrySubmissions',
      summary: 'Doses this practice has not yet reported to the registry.',
      description:
        'The work queue. A dose stays on it until an acknowledgement arrives, which is what makes a failed transmission visible rather than silent. Oldest first, because a submission that has been failing for a month should surface the month-old dose rather than the one given this morning.',
      tags: ['immunisations'],
      permission: 'encounter.read',
      query: pendingQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Doses awaiting submission.',
          schema: z.object({ items: z.array(pendingDoseSchema), total: z.number() }),
        },
        ...errors,
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/immunisations/registry/message',
      operationId: 'buildRegistryMessage',
      summary: 'Build the VXU for a set of doses. Records nothing.',
      description:
        'Returns the message as text; transport belongs to an interface engine. Deliberately stamps nothing: building a message is not reporting one, and this endpoint cannot tell a message that was sent from one that was generated and thrown away. A batch naming doses it cannot all find is refused rather than partly built, and a batch spanning several patients is refused because a VXU carries one PID - building one with the first patient’s demographics and everybody’s doses would report every dose against one person.',
      tags: ['immunisations'],
      permission: 'encounter.read',
      body: messageBodySchema,
      responses: [
        {
          status: 200,
          description: 'The message and what went into it.',
          schema: messageResponseSchema,
        },
        {
          status: 400,
          description: 'The batch spans several patients.',
          schema: problemDocumentSchema,
        },
        ...errors,
        {
          status: 404,
          description: 'Some named dose was not found.',
          schema: problemDocumentSchema,
        },
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/immunisations/registry/acknowledge',
      operationId: 'acknowledgeRegistrySubmission',
      summary: 'Record that the registry accepted the doses.',
      description:
        'The only thing that sets `reportedToRegistryAt`. The acknowledgement is parsed rather than taken on trust: `AA` is accepted, and `AE` or `AR` leaves every dose on the pending list where somebody will see it. Stamping on a rejection would produce exactly the silent gap this three-step shape exists to prevent - the practice believing it reported, the registry holding nothing, and nobody finding out until a school asks a parent for a record the state cannot produce.',
      tags: ['immunisations'],
      permission: 'encounter.write',
      body: acknowledgeBodySchema,
      responses: [
        {
          status: 200,
          description: 'What the registry said, and what was recorded as a result.',
          schema: acknowledgeResponseSchema,
        },
        {
          status: 400,
          description: 'The acknowledgement could not be read; nothing was recorded.',
          schema: problemDocumentSchema,
        },
        ...errors,
      ],
    },
  ];
}
