import {
  createBuiltInSafetyPort,
  missingCapabilities,
  type MedicationSafetyPort,
} from '@openrunic/clinical-safety';
import {
  card,
  contextString,
  draftOrders,
  requireContextString,
  type Card,
  type CdsRequest,
  type ServiceDefinition,
  type Source,
} from '@openrunic/cds-hooks';
import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import type { Permission } from '../policy/permissions.js';
import { repositories } from '../routes/helpers.js';

/**
 * WHAT THIS SERVER HAS TO SAY, AND WHEN.
 *
 * CDS Hooks is the moment the screening in `packages/clinical-safety` becomes
 * worth having. It already knew how to compare a proposed medication against a
 * patient's recorded allergies; until now the only way to ask was an endpoint a
 * prescriber's screen had to remember to call. A hook is the other way round -
 * the EMR calls at the moment of the decision, every time, whether or not
 * anybody remembered.
 *
 * Three services, and the restraint is deliberate:
 *
 * - `patient-view` says something only when there is something a clinician
 *   opening a chart would want said before they do anything else. That is a
 *   high-criticality allergy and nothing else. A card on every chart open is a
 *   card nobody reads by the second week.
 * - `order-select` and `order-sign` screen the draft orders. Two hooks rather
 *   than one because they are different moments: select is while choosing, when
 *   an alternative is still cheap, and sign is the last chance, when it is not.
 *
 * Every card names what was checked. `clinical-safety` reports its own
 * `capabilities` precisely so an empty result is not read as a clean bill, and
 * dropping that on the way into a card would undo the whole point of it.
 */

const SOURCE: Source = {
  label: 'openrunic clinical safety',
  url: 'https://github.com/YosemiteCrew/openrunic',
};

/** The screening implementation. Allergy and duplicate therapy; see its port. */
const safetyPort = createBuiltInSafetyPort();

/** Enough of a page of allergies to screen against; more is a chart with a problem. */
const ALLERGY_LIMIT = 200;

export interface CdsServiceDefinition {
  readonly definition: ServiceDefinition;
  /** What a caller must hold to invoke it. A hook is a read of the chart. */
  readonly permission: Permission;
  evaluate(c: Context<AppEnv>, request: CdsRequest): Promise<readonly Card[]>;
}

/**
 * The patient id out of the hook context, as a bare id.
 *
 * CDS Hooks contexts carry either `Patient/01890000-...` or the id alone,
 * depending on the calling EMR. Both are accepted; a reference read as an id
 * would look up a patient called "Patient" and find nothing, which reads to a
 * clinician as "this patient has no allergies".
 */
function patientIdOf(request: CdsRequest): string {
  const value = requireContextString(request, 'patientId');
  const slash = value.lastIndexOf('/');
  return slash === -1 ? value : value.slice(slash + 1);
}

/** The patient's ACTIVE medication allergies, in the shape the screener wants. */
async function activeMedicationAllergies(
  c: Context<AppEnv>,
  patientId: string
): Promise<
  {
    id: string;
    substanceCode?: string;
    substanceDisplay: string;
    criticality: 'LOW' | 'HIGH' | 'UNABLE_TO_ASSESS';
    reactionText?: string;
  }[]
> {
  const page = await repositories(c).allergies.list({
    page: 1,
    pageSize: ALLERGY_LIMIT,
    sort: 'recordedAt',
    order: 'desc',
    patientId,
    // ACTIVE only, filtered in the query. Re-warning on an allergy somebody has
    // already disproved is how a prescriber learns to dismiss the panel.
    clinicalStatus: 'ACTIVE',
  });

  return (
    page.rows
      // A latex or food allergy is real and is not a reason to warn about an
      // antibiotic.
      .filter((row) => row.category === 'MEDICATION')
      .map((row) => ({
        id: row.id,
        ...(row.substanceCode === null ? {} : { substanceCode: row.substanceCode }),
        substanceDisplay: row.substanceDisplay,
        criticality: row.criticality,
        ...(row.reactionText === null ? {} : { reactionText: row.reactionText }),
      }))
  );
}

/** The patient's active medication list, for the duplicate-therapy check. */
async function activeMedications(
  c: Context<AppEnv>,
  patientId: string
): Promise<{ rxnormCode?: string; display: string }[]> {
  const page = await repositories(c).medicationStatements.list({
    page: 1,
    pageSize: ALLERGY_LIMIT,
    sort: 'reportedAt',
    order: 'desc',
    patientId,
    status: 'ACTIVE',
  });

  return page.rows.map((row) => ({
    ...(row.rxnormCode === null ? {} : { rxnormCode: row.rxnormCode }),
    display: row.display,
  }));
}

/**
 * The medication a draft order is for, out of a FHIR MedicationRequest.
 *
 * `medicationCodeableConcept` is the inline form and the one an order-entry
 * screen sends; `medicationReference` points at a Medication resource this
 * server would have to fetch, and a draft order rarely uses it. An order this
 * cannot read is skipped rather than screened against an empty medication,
 * because screening nothing and reporting no findings is the one outcome worse
 * than not screening at all.
 */
function medicationOf(
  order: Record<string, unknown>
): { rxnormCode?: string; display: string } | undefined {
  if (order.resourceType !== 'MedicationRequest') return undefined;

  const concept = order.medicationCodeableConcept;
  if (typeof concept !== 'object' || concept === null) return undefined;

  const { text, coding } = concept as { text?: unknown; coding?: unknown };
  const first = Array.isArray(coding)
    ? (coding[0] as Record<string, unknown> | undefined)
    : undefined;
  const code = typeof first?.code === 'string' ? first.code : undefined;
  const display =
    (typeof first?.display === 'string' ? first.display : undefined) ??
    (typeof text === 'string' ? text : undefined);

  if (display === undefined || display === '') return undefined;
  return { ...(code === undefined ? {} : { rxnormCode: code }), display };
}

/**
 * The sentence every safety card ends with, naming what was and was not checked.
 *
 * Takes the port rather than reading the module constant, because the whole
 * point of the port is that a deployer swaps in one that checks more - and a
 * function that hard-coded this build's gaps would keep announcing them after
 * they were filled. The `Not checked` half disappears when there is nothing
 * left to name.
 */
export function checkedLine(port: MedicationSafetyPort): string {
  const checked = port.capabilities.join(', ');
  const notChecked = missingCapabilities(port).join(', ');
  return notChecked === ''
    ? `\n\nChecked: ${checked}.`
    : `\n\nChecked: ${checked}. **Not checked: ${notChecked}.**`;
}

/**
 * One allergy as a line of the card's detail.
 *
 * The reaction is what changes what the next prescriber does - "penicillin" and
 * "penicillin, anaphylaxis 2019" are different pieces of information - so it is
 * appended when the chart has one and the line simply ends when it does not.
 */
function allergyLine(allergy: { substanceDisplay: string; reactionText?: string }): string {
  const reaction = allergy.reactionText === undefined ? '' : ` - ${allergy.reactionText}`;
  return `- **${allergy.substanceDisplay}**${reaction}`;
}

/**
 * Screens every draft order and turns the findings into cards.
 *
 * One card per finding rather than one per order. A prescriber signing three
 * medications needs to see which of them is the problem, and a card that says
 * "3 issues" makes them open it to find out - which is the interaction a card is
 * supposed to save.
 */
async function screenDrafts(c: Context<AppEnv>, request: CdsRequest): Promise<Card[]> {
  const patientId = patientIdOf(request);
  const orders = draftOrders(request);
  const medications = orders
    .map((order) => medicationOf(order))
    .filter(
      (medication): medication is { rxnormCode?: string; display: string } =>
        medication !== undefined
    );

  if (medications.length === 0) return [];

  const [allergies, current] = await Promise.all([
    activeMedicationAllergies(c, patientId),
    activeMedications(c, patientId),
  ]);

  const cards: Card[] = [];
  for (const medication of medications) {
    const result = await safetyPort.screen({ medication, allergies, currentMedications: current });

    for (const finding of result.findings) {
      cards.push(
        card({
          summary: finding.message,
          detail: `${finding.message}${checkedLine(safetyPort)}`,
          // `acknowledge` is what the screener uses for a finding a prescriber
          // must actively pass; anything else informs. The indicator is a
          // promise, and spending `critical` on a shared drug class is how a
          // system teaches people to dismiss it.
          indicator: finding.action === 'acknowledge' ? 'critical' : 'info',
          source: SOURCE,
        })
      );
    }
  }

  return cards;
}

const ORDER_PREFETCH = {
  // Advertised because the specification asks a service to say what it would
  // find useful. Never depended on: this server reads its own chart, and a
  // service that required prefetch would fail against every EMR that chose not
  // to send it.
  patient: 'Patient/{{context.patientId}}',
  allergies: 'AllergyIntolerance?patient={{context.patientId}}&clinical-status=active',
};

export const CDS_SERVICES: readonly CdsServiceDefinition[] = [
  {
    definition: {
      id: 'allergy-summary',
      hook: 'patient-view',
      title: 'High-criticality allergies',
      description:
        'Shows the allergies a clinician should know about before doing anything else on this chart. Silent when there are none.',
      prefetch: ORDER_PREFETCH,
      usageRequirements: 'Requires the patient.read permission on the calling token.',
    },
    permission: 'patient.read',
    evaluate: async (c, request) => {
      const allergies = await activeMedicationAllergies(c, patientIdOf(request));
      const severe = allergies.filter((allergy) => allergy.criticality === 'HIGH');

      // Silence is the right answer most of the time. A card on every chart open
      // is a card nobody reads by the second week, and this one has to still be
      // read on the day it matters.
      if (severe.length === 0) return [];

      const names = severe.map((allergy) => allergy.substanceDisplay).join(', ');
      const detail = severe.map(allergyLine).join('\n');

      return [
        card({
          summary: `High-criticality allergy recorded: ${names}`,
          detail: `${detail}${checkedLine(safetyPort)}`,
          indicator: 'warning',
          source: SOURCE,
        }),
      ];
    },
  },
  {
    definition: {
      id: 'order-select-safety',
      hook: 'order-select',
      title: 'Medication safety at selection',
      description:
        'Screens a medication being chosen against the recorded allergies and the current medication list, while an alternative is still cheap to pick.',
      prefetch: ORDER_PREFETCH,
    },
    permission: 'patient.read',
    evaluate: screenDrafts,
  },
  {
    definition: {
      id: 'order-sign-safety',
      hook: 'order-sign',
      title: 'Medication safety at signing',
      description:
        'The last screening before an order is committed: recorded allergies and duplicate therapy across every draft in the signing bundle.',
      prefetch: ORDER_PREFETCH,
    },
    permission: 'patient.read',
    evaluate: screenDrafts,
  },
];

/** The encounter a hook was invoked from, when the caller named one. */
export function encounterOf(request: CdsRequest): string | undefined {
  return contextString(request, 'encounterId');
}
