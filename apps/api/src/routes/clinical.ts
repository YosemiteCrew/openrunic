import {
  allergyIntoleranceInput,
  clinicalNoteInput,
  conditionInput,
  encounterCreateInput,
  immunizationInput,
  medicationRequestInput,
  medicationStatementInput,
  observationInput,
} from '@openrunic/database';
import { createBuiltInSafetyPort, missingCapabilities } from '@openrunic/clinical-safety';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam, parseQuery } from '../http/validate.js';
import { assertFacilityAccess, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';

import { growthRouteContracts, growthRoutes } from './growth.js';
import { registryRouteContracts, registryRoutes } from './registry.js';
import type {
  ClinicalNoteRow,
  EncounterStatus,
  MedicationRequestRow,
  MedicationRequestStatus,
  NoteState,
} from '../repositories/specs/clinical.js';
import {
  allergyDtoSchema,
  allergyListQuerySchema,
  allergyPatchSchema,
  encounterDtoSchema,
  encounterListQuerySchema,
  encounterPatchSchema,
  immunisationDtoSchema,
  immunisationListQuerySchema,
  immunisationPatchSchema,
  medicationStatementDtoSchema,
  medicationStatementListQuerySchema,
  medicationStatementPatchSchema,
  noteAddendumBodySchema,
  noteAddendumDtoSchema,
  noteAddendumListQuerySchema,
  noteDtoSchema,
  noteListQuerySchema,
  notePatchSchema,
  observationDtoSchema,
  observationListQuerySchema,
  observationPatchSchema,
  prescriptionDtoSchema,
  prescriptionListQuerySchema,
  prescriptionPatchSchema,
  problemDtoSchema,
  problemListQuerySchema,
  problemPatchSchema,
  toAllergyDto,
  toAllergyListQuery,
  toAllergyPatch,
  toEncounterDto,
  toEncounterListQuery,
  toEncounterPatch,
  toImmunisationDto,
  toImmunisationListQuery,
  toImmunisationPatch,
  toMedicationStatementDto,
  toMedicationStatementListQuery,
  toMedicationStatementPatch,
  toNoteAddendumDto,
  toNoteAddendumListQuery,
  toNoteDto,
  toNoteListQuery,
  toNotePatch,
  toObservationDto,
  toObservationListQuery,
  toObservationPatch,
  toPrescriptionDto,
  toPrescriptionListQuery,
  toPrescriptionPatch,
  toProblemDto,
  toProblemListQuery,
  toProblemPatch,
  type NotePatchBody,
} from '../schemas/clinical.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';

import {
  assertTransition,
  defineCrud,
  CONFLICT_RESPONSE,
  CRUD_ERRORS,
  NOT_FOUND_RESPONSE,
  UNPROCESSABLE_RESPONSE,
  type CrudModule,
} from './crud.js';
import { attributedTo, idParamSchema, policyOf, repositories, required } from './helpers.js';

/**
 * The chart, over HTTP.
 *
 * Thirty-two of these endpoints are list, read, create and amend, and they are
 * built by {@link defineCrud} from one description each, so the paging envelope,
 * the 404-not-403 rule and the facility check are written once rather than
 * thirty-two times. The seven that are not - signing a visit, signing a note,
 * addenda, and the three moves a prescription makes - are written out below by
 * hand, because a state transition is precisely where a generic abstraction
 * would hide the rules a reviewer came to read.
 *
 * Every one of those transitions is a lookup in a table declared as data. The
 * tables are the specification: "what can a signed note become" is answerable by
 * reading one object rather than by tracing conditionals through a handler, and
 * a move that is not in the table is refused with a typed 409 that names the
 * moves that were available.
 */

const MISSING_ENCOUNTER = 'No such encounter.';
const MISSING_NOTE = 'No such clinical note.';
const MISSING_PRESCRIPTION = 'No such prescription.';

/* ------------------------------------------------------------ the tables */

/**
 * The visit life cycle.
 *
 * Every state reaches `ENTERED_IN_ERROR`, including the cancelled one: a visit
 * that should never have been recorded is corrected by saying so, never by
 * deleting the row, because anything already written against it - a note, a
 * charge, a result - has to keep pointing somewhere. `CANCELLED` is terminal in
 * every other direction: a visit that was called off and then happened is a new
 * visit, and the schedule has to show two.
 */
const ENCOUNTER_TRANSITIONS: Readonly<Record<EncounterStatus, readonly EncounterStatus[]>> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED', 'ENTERED_IN_ERROR'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED', 'ENTERED_IN_ERROR'],
  COMPLETED: ['ENTERED_IN_ERROR'],
  CANCELLED: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: [],
};

/**
 * Which visit statuses a signature may be taken from, written as a move to the
 * one status that has any. A signature attests to what was documented, so it
 * becomes available when the visit is over and not while it is still being
 * written.
 */
const ENCOUNTER_SIGNING_TRANSITIONS: Readonly<Record<EncounterStatus, readonly EncounterStatus[]>> =
  {
    PLANNED: [],
    IN_PROGRESS: [],
    ON_HOLD: [],
    COMPLETED: ['COMPLETED'],
    CANCELLED: [],
    ENTERED_IN_ERROR: [],
  };

type SignatureState = 'UNSIGNED' | 'SIGNED';

/**
 * A signature exists or it does not, and it is never replaced in place. Signing
 * a second time is refused rather than made idempotent, because the second
 * caller believes they are attesting to something and the first signature is
 * what the record would actually keep.
 */
const SIGNATURE_TRANSITIONS: Readonly<Record<SignatureState, readonly SignatureState[]>> = {
  UNSIGNED: ['SIGNED'],
  SIGNED: [],
};

/**
 * What a note's state may become through a plain amendment.
 *
 * `SIGNED` and `AMENDED` are absent as targets on purpose. Signing stamps a
 * signature and a lock, and an addendum writes a row; both are things a bare
 * status write would skip, so both have a route instead.
 */
const NOTE_PATCH_TRANSITIONS: Readonly<Record<NoteState, readonly NoteState[]>> = {
  DRAFT: ['AI_DRAFT_REVIEW', 'UNSIGNED', 'ENTERED_IN_ERROR'],
  AI_DRAFT_REVIEW: ['DRAFT', 'UNSIGNED', 'ENTERED_IN_ERROR'],
  UNSIGNED: ['DRAFT', 'AI_DRAFT_REVIEW', 'ENTERED_IN_ERROR'],
  SIGNED: ['ENTERED_IN_ERROR'],
  AMENDED: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: [],
};

/** Which states a note may be signed from. A draft under AI review counts. */
const NOTE_SIGN_TRANSITIONS: Readonly<Record<NoteState, readonly NoteState[]>> = {
  DRAFT: ['SIGNED'],
  AI_DRAFT_REVIEW: ['SIGNED'],
  UNSIGNED: ['SIGNED'],
  SIGNED: [],
  AMENDED: [],
  ENTERED_IN_ERROR: [],
};

/**
 * Which states accept an addendum. Only the signed ones: an addendum to a draft
 * is an edit, and an edit to a draft needs no ceremony at all.
 */
const NOTE_ADDENDUM_TRANSITIONS: Readonly<Record<NoteState, readonly NoteState[]>> = {
  DRAFT: [],
  AI_DRAFT_REVIEW: [],
  UNSIGNED: [],
  SIGNED: ['AMENDED'],
  AMENDED: ['AMENDED'],
  ENTERED_IN_ERROR: [],
};

/**
 * What a prescription may become through this API.
 *
 * This is not the whole of the FHIR life cycle, and it says so deliberately:
 * `ACTIVE`, `ON_HOLD` and `COMPLETED` are reached by dispense and fill messages
 * from a pharmacy network that this service does not yet receive, so the only
 * moves listed are the three a prescriber makes here. The four terminal states
 * accept nothing, which is what makes cancelling a cancelled prescription a 409
 * rather than a second cancellation.
 */
const PRESCRIPTION_TRANSITIONS: Readonly<
  Record<MedicationRequestStatus, readonly MedicationRequestStatus[]>
> = {
  DRAFT: ['SIGNED', 'CANCELLED'],
  PENDED: ['SIGNED', 'CANCELLED'],
  SIGNED: ['TRANSMITTED', 'CANCELLED'],
  TRANSMITTED: ['CANCELLED'],
  ACTIVE: ['CANCELLED'],
  ON_HOLD: ['CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
  STOPPED: [],
  ERROR: [],
};

/* ---------------------------------------------------- the plain operations */

/**
 * The eight aggregates whose four plain operations are all they need. Note
 * addenda are absent: they exist only under the note they correct, so they are
 * reached through the nested routes further down and never as a collection of
 * their own.
 */
function crudModules(): CrudModule[] {
  return [
    defineCrud({
      segment: 'encounters',
      singular: 'encounter',
      plural: 'encounters',
      tag: 'encounters',
      operation: 'Encounter',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.encounters,
      listQuerySchema: encounterListQuerySchema,
      toQuery: toEncounterListQuery,
      listDescription:
        'The visit list for a chart is `patientId`; a site day is `facilityId` plus `from`/`to`, where `from` is inclusive and `to` exclusive.',
      createSchema: encounterCreateInput,
      toCreate: (body) => body,
      patchSchema: encounterPatchSchema,
      toPatch: (body, row) => {
        if (body.status !== undefined && body.status !== row.status) {
          assertTransition(ENCOUNTER_TRANSITIONS, 'visit', row.status, body.status);
        }
        return toEncounterPatch(body);
      },
      dtoSchema: encounterDtoSchema,
      toDto: toEncounterDto,
      facilityOfRow: (row) => row.facilityId,
      facilityOfInput: (input) => input.facilityId,
      writeResponses: [
        { status: 409, description: 'The visit cannot move to that status from this one.' },
      ],
    }),

    defineCrud({
      segment: 'notes',
      singular: 'clinical note',
      plural: 'clinical notes',
      tag: 'notes',
      operation: 'Note',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.notes,
      listQuerySchema: noteListQuerySchema,
      toQuery: toNoteListQuery,
      listDescription:
        'The signing debt board is `authorId` plus `state`; a chart timeline is `patientId`. Sorting by `signedAt` puts unsigned notes last.',
      createSchema: clinicalNoteInput,
      toCreate: (body) => body,
      patchSchema: notePatchSchema,
      toPatch: (body, row) => {
        assertNoteIsEditable(body, row);
        if (body.state !== undefined && body.state !== row.state) {
          assertTransition(NOTE_PATCH_TRANSITIONS, 'clinical note', row.state, body.state);
        }
        return toNotePatch(body);
      },
      dtoSchema: noteDtoSchema,
      toDto: toNoteDto,
      writeResponses: [
        {
          status: 409,
          description: 'The note is signed, or cannot move to that state from this one.',
        },
      ],
    }),

    defineCrud({
      segment: 'problems',
      singular: 'problem',
      plural: 'problems',
      tag: 'problems',
      operation: 'Problem',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.problems,
      listQuerySchema: problemListQuerySchema,
      toQuery: toProblemListQuery,
      listDescription:
        "The problem list is `patientId` plus `clinicalStatus=ACTIVE`; a visit's diagnoses are `patientId` plus `category=ENCOUNTER_DIAGNOSIS`.",
      createSchema: conditionInput,
      toCreate: (body) => body,
      patchSchema: problemPatchSchema,
      toPatch: (body) => toProblemPatch(body),
      dtoSchema: problemDtoSchema,
      toDto: toProblemDto,
    }),

    defineCrud({
      segment: 'medications/statements',
      singular: 'medication statement',
      plural: 'medication statements',
      tag: 'medications',
      operation: 'MedicationStatement',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.medicationStatements,
      listQuerySchema: medicationStatementListQuerySchema,
      toQuery: toMedicationStatementListQuery,
      listDescription:
        'What the patient is taking, however it was learned. The active medication list is `patientId` plus `status=ACTIVE`.',
      createSchema: medicationStatementInput,
      toCreate: (body) => body,
      patchSchema: medicationStatementPatchSchema,
      toPatch: (body) => toMedicationStatementPatch(body),
      dtoSchema: medicationStatementDtoSchema,
      toDto: toMedicationStatementDto,
    }),

    defineCrud({
      segment: 'medications/prescriptions',
      singular: 'prescription',
      plural: 'prescriptions',
      tag: 'medications',
      operation: 'Prescription',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.prescriptions,
      listQuerySchema: prescriptionListQuerySchema,
      toQuery: toPrescriptionListQuery,
      listDescription:
        'What this practice wrote. A prescriber queue is `prescriberId` plus `status`; status itself moves through the sign, transmit and cancel operations rather than through a patch.',
      createSchema: medicationRequestInput,
      toCreate: (body) => body,
      patchSchema: prescriptionPatchSchema,
      toPatch: (body) => toPrescriptionPatch(body),
      dtoSchema: prescriptionDtoSchema,
      toDto: toPrescriptionDto,
    }),

    defineCrud({
      segment: 'allergies',
      singular: 'allergy',
      plural: 'allergies',
      tag: 'allergies',
      operation: 'Allergy',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.allergies,
      listQuerySchema: allergyListQuerySchema,
      toQuery: toAllergyListQuery,
      listDescription:
        'The banner list is `patientId` plus `clinicalStatus=ACTIVE`; `criticality=HIGH` is the subset a prescribing check must never miss.',
      createSchema: allergyIntoleranceInput,
      toCreate: (body) => body,
      patchSchema: allergyPatchSchema,
      toPatch: (body) => toAllergyPatch(body),
      dtoSchema: allergyDtoSchema,
      toDto: toAllergyDto,
    }),

    defineCrud({
      segment: 'immunisations',
      singular: 'immunisation',
      plural: 'immunisations',
      tag: 'immunisations',
      operation: 'Immunisation',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.immunisations,
      listQuerySchema: immunisationListQuerySchema,
      toQuery: toImmunisationListQuery,
      listDescription:
        'The immunisation record is `patientId`; a registry submission window is `cvxCode` plus `from`/`to` over `administeredAt`.',
      createSchema: immunizationInput,
      toCreate: (body) => body,
      patchSchema: immunisationPatchSchema,
      toPatch: (body) => toImmunisationPatch(body),
      dtoSchema: immunisationDtoSchema,
      toDto: toImmunisationDto,
    }),

    defineCrud({
      segment: 'observations',
      singular: 'observation',
      plural: 'observations',
      tag: 'observations',
      operation: 'Observation',
      readPermission: 'encounter.read',
      writePermission: 'encounter.write',
      collection: (repos) => repos.observations,
      listQuerySchema: observationListQuerySchema,
      toQuery: toObservationListQuery,
      listDescription:
        'The vitals flowsheet is `patientId` plus `category=VITAL_SIGNS` plus a `from`/`to` window over `effectiveAt`, sorted by `effectiveAt`. A single trend line adds `loincCode`.',
      createSchema: observationInput,
      toCreate: (body) => body,
      patchSchema: observationPatchSchema,
      toPatch: (body) => toObservationPatch(body),
      dtoSchema: observationDtoSchema,
      toDto: toObservationDto,
    }),
  ];
}

/**
 * A signed note is what someone attested to at a moment, so its text stops
 * being editable at that moment. The correction path is an addendum, which
 * leaves both versions readable; an in-place edit would leave a record that
 * disagrees with the decisions taken from it.
 */
function assertNoteIsEditable(body: NotePatchBody, row: ClinicalNoteRow): void {
  const changesContent = body.title !== undefined || body.blocks !== undefined;
  if (changesContent && (row.state === 'SIGNED' || row.state === 'AMENDED')) {
    throw ApiError.conflict(
      'A signed note cannot be edited. Record an addendum against it instead.'
    );
  }
}

/* ------------------------------------------------------------- the routes */

export function clinicalRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  registerMedicationSafety(router);
  growthRoutes(router);
  registryRoutes(router);

  for (const module of crudModules()) {
    router.route('/', module.routes);
  }

  router.post('/encounters/:id/sign', requirePermission('encounter.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const { encounters } = repositories(c);
    const row = required(await encounters.findById(id), MISSING_ENCOUNTER);
    assertFacilityAccess(policyOf(c), row.facilityId);
    assertTransition(ENCOUNTER_SIGNING_TRANSITIONS, 'visit', row.status, 'COMPLETED');
    assertTransition(
      SIGNATURE_TRANSITIONS,
      "visit's signature",
      row.signedAt === null ? 'UNSIGNED' : 'SIGNED',
      'SIGNED'
    );

    const signed = await encounters.update(id, { signedById: attributedTo(c) });
    return c.json(toEncounterDto(required(signed, MISSING_ENCOUNTER)));
  });

  router.post('/notes/:id/sign', requirePermission('encounter.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const { notes } = repositories(c);
    const row = required(await notes.findById(id), MISSING_NOTE);
    assertTransition(NOTE_SIGN_TRANSITIONS, 'clinical note', row.state, 'SIGNED');

    const signed = await notes.update(id, { signedById: attributedTo(c) });
    return c.json(toNoteDto(required(signed, MISSING_NOTE)));
  });

  router.get('/notes/:id/addenda', requirePermission('encounter.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const input = parseQuery(c, noteAddendumListQuerySchema);
    const { notes, noteAddenda } = repositories(c);
    // The note is read first so that addenda on a chart this principal cannot
    // reach are a 404 rather than an empty list. An empty list would say the
    // note has no addenda, which is a different and false statement.
    required(await notes.findById(id), MISSING_NOTE);

    const page = await noteAddenda.list(toNoteAddendumListQuery(input, id));
    return c.json(toListResponse(page, toNoteAddendumDto));
  });

  router.post('/notes/:id/addenda', requirePermission('encounter.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, noteAddendumBodySchema);
    const { notes, noteAddenda } = repositories(c);
    const note = required(await notes.findById(id), MISSING_NOTE);
    assertTransition(NOTE_ADDENDUM_TRANSITIONS, 'clinical note', note.state, 'AMENDED');

    // The author comes from the token for the same reason the signer does:
    // see attributedTo below.
    const addendum = await noteAddenda.create({
      noteId: id,
      authorId: attributedTo(c),
      ...body,
    });
    // The note moves with its addendum. A reader who sees `AMENDED` knows to
    // look for one; a reader who does not, does not have to.
    await notes.update(id, { state: 'AMENDED' });

    // There is no route to one addendum: an addendum is only ever read in the
    // context of the note it corrects, so the header points at the list it has
    // just joined.
    return c.json(toNoteAddendumDto(addendum), 201, {
      Location: `/bff/v0/notes/${id}/addenda`,
    });
  });

  // See ROUTED_PRESCRIPTION_MOVES: three routes that differed only by segment and
  // status, declared once instead of written three times.
  for (const [segment, status] of ROUTED_PRESCRIPTION_MOVES) {
    router.post(
      `/medications/prescriptions/:id/${segment}`,
      requirePermission('encounter.write'),
      async (c) => {
        const id = parseParam(c.req.param('id'), idParamSchema, 'id');
        return c.json(toPrescriptionDto(await movePrescription(c, id, status)));
      }
    );
  }

  return router;
}

/**
 * One prescription status move, shared by the three routes that make them.
 *
 * The move is refused before the write rather than repaired after it, so a
 * prescription that could not be transmitted is not left carrying a
 * transmission stamp.
 */
/**
 * The prescription moves that have a ROUTE, as `[url segment, resulting status]`.
 *
 * Not to be confused with PRESCRIPTION_TRANSITIONS, the legal-transition graph
 * a move is checked against: this says what a client may ask for, that says
 * what is allowed from where.
 * `as const` keeps each status a literal so the call below still type-checks
 * against MedicationRequestStatus rather than a widened string.
 */
const ROUTED_PRESCRIPTION_MOVES = [
  ['sign', 'SIGNED'],
  ['transmit', 'TRANSMITTED'],
  ['cancel', 'CANCELLED'],
] as const satisfies readonly (readonly [string, MedicationRequestStatus])[];

/** What order entry sends to be screened. */
const medicationScreenInput = z.object({
  patientId: z.uuid(),
  rxnormCode: z.string().min(1).max(32).optional(),
  display: z.string().min(1).max(300),
});

const safetyFindingSchema = z.object({
  allergyId: z.string(),
  kind: z.enum(['code', 'name', 'cross-sensitivity']),
  criticality: z.enum(['LOW', 'HIGH', 'UNABLE_TO_ASSESS']),
  action: z.enum(['inform', 'acknowledge']),
  message: z.string(),
});

const medicationScreenResultSchema = z.object({
  findings: z.array(safetyFindingSchema),
  requiresAcknowledgement: z.boolean(),
  /** What this build checked. An empty finding list means nothing found in THESE. */
  checked: z.array(z.string()),
  /** And what it did not, so the empty list cannot be read as a clean bill. */
  notChecked: z.array(z.string()),
});

/**
 * The safety port this build screens through.
 *
 * Built in and allergy-only. A deployer with a licensed interaction service
 * swaps this for one whose `capabilities` list is longer; nothing else here
 * changes, which is the point of the port existing.
 */
const safetyPort = createBuiltInSafetyPort();

/** Enough of a page of allergies to screen against; a chart with more is a chart with a problem. */
const ALLERGY_SCREEN_LIMIT = 200;

function registerMedicationSafety(router: Hono<AppEnv>): void {
  /**
   * Screens a proposed medication against the patient's recorded allergies.
   *
   * A separate call rather than a check inside the create, because screening
   * belongs at order entry: the prescriber needs the answer while deciding,
   * not as a rejection after committing. Prescribing itself stays a plain
   * write - this endpoint informs the human who signs it.
   *
   * `checked` is returned alongside the findings and is the load-bearing half.
   * An empty finding list means "nothing found in THESE checks", and a
   * prescriber reading a safety panel will otherwise assume it covered the
   * checks safety panels usually cover. Naming what was not checked is what
   * keeps the empty result honest.
   */
  router.post('/medications/screen', requirePermission('encounter.write'), async (c) => {
    const body = await parseJsonBody(c, medicationScreenInput);
    const repos = repositories(c);

    // ACTIVE only, and filtered in the query rather than in memory: a resolved
    // or refuted allergy is not a reason to warn, and re-warning on one someone
    // has already disproved is how a prescriber learns to dismiss the panel.
    const page = await repos.allergies.list({
      page: 1,
      pageSize: ALLERGY_SCREEN_LIMIT,
      sort: 'recordedAt',
      order: 'desc',
      patientId: body.patientId,
      clinicalStatus: 'ACTIVE',
    });

    const result = await safetyPort.screen({
      medication: { rxnormCode: body.rxnormCode, display: body.display },
      allergies: page.rows
        // Medication allergies only. A latex or food allergy is real and is not
        // a reason to warn about an antibiotic.
        .filter((row) => row.category === 'MEDICATION')
        .map((row) => ({
          id: row.id,
          substanceCode: row.substanceCode ?? undefined,
          substanceDisplay: row.substanceDisplay,
          criticality: row.criticality,
          reactionText: row.reactionText ?? undefined,
        })),
    });

    return c.json({
      findings: result.findings,
      requiresAcknowledgement: result.requiresAcknowledgement,
      checked: safetyPort.capabilities,
      notChecked: missingCapabilities(safetyPort),
    });
  });
}

async function movePrescription(
  c: Context<AppEnv>,
  id: string,
  to: MedicationRequestStatus
): Promise<MedicationRequestRow> {
  const { prescriptions } = repositories(c);
  const row = required(await prescriptions.findById(id), MISSING_PRESCRIPTION);
  assertTransition(PRESCRIPTION_TRANSITIONS, 'prescription', row.status, to);

  const moved = await prescriptions.update(id, { status: to });
  return required(moved, MISSING_PRESCRIPTION);
}

/* ---------------------------------------------------------- the contracts */

/** One transition operation: a POST on an instance path, no body, one 409. */
function transitionContract(operation: {
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tag: string;
  subject: string;
  response: z.ZodType;
  conflict: string;
}): RouteContract {
  return {
    method: 'post',
    path: operation.path,
    operationId: operation.operationId,
    summary: operation.summary,
    description: operation.description,
    tags: [operation.tag],
    permission: 'encounter.write',
    pathParams: [
      { name: 'id', description: `${operation.subject} id (UUIDv7).`, schema: idParamSchema },
    ],
    responses: [
      {
        status: 200,
        description: `The ${operation.subject.toLowerCase()}, as it now stands.`,
        schema: operation.response,
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      { status: 409, description: operation.conflict, schema: problemDocumentSchema },
    ],
  };
}

export function clinicalRouteContracts(): RouteContract[] {
  return [
    ...crudModules().flatMap((module) => module.contracts),
    ...growthRouteContracts(),
    ...registryRouteContracts(),

    {
      method: 'post',
      path: '/bff/v0/medications/screen',
      operationId: 'screenMedication',
      summary: 'Screen a proposed medication before prescribing it.',
      description:
        'Compares a proposed medication against the patient ACTIVE medication allergies and, when the caller supplies them, against what they are already taking. Returns findings rather than refusing: a prescriber may knowingly prescribe against a recorded allergy, and refusing outright would be clinically wrong. `checked` and `notChecked` name the screens this build performs and the ones it does not, so an empty finding list reads as "nothing found in these checks" rather than as a clean bill.',
      tags: ['medications'],
      permission: 'encounter.write',
      body: medicationScreenInput,
      responses: [
        {
          status: 200,
          description: 'The findings, and what was and was not checked to produce them.',
          schema: medicationScreenResultSchema,
        },
        {
          status: 400,
          description: 'The request body is not valid.',
          schema: problemDocumentSchema,
        },
      ],
    },

    transitionContract({
      path: '/bff/v0/encounters/{id}/sign',
      operationId: 'signEncounter',
      summary: 'Sign a completed visit.',
      description:
        'Records the attestation against the acting principal. Only a `COMPLETED` visit can be signed, and only once: a second signature is refused rather than silently ignored.',
      tag: 'encounters',
      subject: 'Encounter',
      response: encounterDtoSchema,
      conflict: 'The visit is not completed, or it is already signed.',
    }),

    transitionContract({
      path: '/bff/v0/notes/{id}/sign',
      operationId: 'signNote',
      summary: 'Sign a clinical note.',
      description:
        'Moves a `DRAFT`, `AI_DRAFT_REVIEW` or `UNSIGNED` note to `SIGNED`, stamping the signature and the lock together. A signed note is no longer editable; corrections are addenda.',
      tag: 'notes',
      subject: 'Note',
      response: noteDtoSchema,
      conflict: 'The note is not in a state that can be signed.',
    }),

    {
      method: 'get',
      path: '/bff/v0/notes/{id}/addenda',
      operationId: 'listNoteAddenda',
      summary: "List a note's addenda.",
      description: 'Oldest first, which is the order they have to be read in.',
      tags: ['notes'],
      permission: 'encounter.read',
      pathParams: [{ name: 'id', description: 'Note id (UUIDv7).', schema: idParamSchema }],
      query: noteAddendumListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'One page of addenda.',
          schema: listResponseSchema(noteAddendumDtoSchema),
        },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
      ],
    },

    {
      method: 'post',
      path: '/bff/v0/notes/{id}/addenda',
      operationId: 'createNoteAddendum',
      summary: 'Add an addendum to a signed note.',
      description:
        'The way a signed note is corrected. Allowed only on a `SIGNED` or `AMENDED` note, because an addendum to a draft is just an edit, and the note moves to `AMENDED` with the addendum.',
      tags: ['notes'],
      permission: 'encounter.write',
      pathParams: [{ name: 'id', description: 'Note id (UUIDv7).', schema: idParamSchema }],
      body: noteAddendumBodySchema,
      responses: [
        { status: 201, description: 'The recorded addendum.', schema: noteAddendumDtoSchema },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
        CONFLICT_RESPONSE,
        UNPROCESSABLE_RESPONSE,
      ],
    },

    transitionContract({
      path: '/bff/v0/medications/prescriptions/{id}/sign',
      operationId: 'signPrescription',
      summary: 'Sign a prescription.',
      description: 'Moves a `DRAFT` or `PENDED` prescription to `SIGNED`.',
      tag: 'medications',
      subject: 'Prescription',
      response: prescriptionDtoSchema,
      conflict: 'The prescription is not in a state that can be signed.',
    }),

    transitionContract({
      path: '/bff/v0/medications/prescriptions/{id}/transmit',
      operationId: 'transmitPrescription',
      summary: 'Transmit a signed prescription.',
      description:
        'Moves a `SIGNED` prescription to `TRANSMITTED` and stamps `transmittedAt`, which is the record that it left this system.',
      tag: 'medications',
      subject: 'Prescription',
      response: prescriptionDtoSchema,
      conflict: 'The prescription is not signed, or has already left.',
    }),

    transitionContract({
      path: '/bff/v0/medications/prescriptions/{id}/cancel',
      operationId: 'cancelPrescription',
      summary: 'Cancel a prescription.',
      description:
        'Allowed from any state that is not already terminal. A cancelled prescription stays on the chart: it is a fact about what was intended.',
      tag: 'medications',
      subject: 'Prescription',
      response: prescriptionDtoSchema,
      conflict: 'The prescription has already reached a terminal state.',
    }),
  ];
}
