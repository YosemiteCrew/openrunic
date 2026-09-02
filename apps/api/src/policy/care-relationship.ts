import type { Principal } from '../auth/principal.js';
import type { Repositories } from '../repositories/types.js';

import type { PolicyContext } from './policy.js';

/**
 * Whether this reader is involved in this patient's care.
 *
 * ## What this replaces
 *
 * Until now the API asked three questions before handing over a chart: does the
 * caller hold `patient.read`, is the row in their tenant, and - for a list -
 * is the patient's `primaryFacilityId` one of their sites. It never asked the
 * one that matters, so a member of staff who knew or guessed a patient id could
 * open that chart: MRN, birth date, address, contact details. Bounded by the
 * tenant and the role, written to the audit trail, and not prevented. Detection
 * after the fact is a weaker control than it sounds.
 *
 * ## Derived, never materialised
 *
 * The relationship is computed from the rows that create it, on every read,
 * rather than kept in a table maintained by writes. A materialised version is
 * faster and has one failure mode this does not: a write path that forgets to
 * maintain it locks a clinician out of a chart they are treating, silently and
 * at the worst possible moment. Derivation cannot go stale, and the cost is a
 * handful of indexed lookups on a chart open, which is not a hot loop.
 *
 * ## The sources, and why each one
 *
 * They are enumerated in `RELATIONSHIP_SOURCES` below rather than spread across
 * the codebase, because the policy is the list. Changing who may open a chart
 * should be changing one array, in one file, in one pull request.
 */

/** What the check is asked about. */
export interface CareRelationshipQuery {
  readonly principal: Principal;
  readonly policy: PolicyContext;
  readonly patientId: string;
  /** Now, passed in so a test does not have to move the clock. */
  readonly at: Date;
}

/** One reason a reader might be involved in a patient's care. */
interface RelationshipSource {
  readonly name: string;
  holds(repositories: Repositories, query: CareRelationshipQuery): Promise<boolean>;
}

/** A page of one: these ask whether anything matches, never what. */
const ONE = { page: 1, pageSize: 1 } as const;

export const RELATIONSHIP_SOURCES: readonly RelationshipSource[] = [
  {
    /*
     * The patient reading their own record. The one relationship the system can
     * be certain about, and it is checked first because it needs no query at
     * all: a portal principal is bound to exactly one chart by its token.
     */
    name: 'own-record',
    holds: (_repositories, query) =>
      Promise.resolve(query.principal.compartmentPatientId === query.patientId),
  },
  {
    /*
     * Break-glass. A grant the reader made deliberately, with a reason, that
     * has not expired. It is a source like any other so that everything after
     * the declaration works normally and every read inside the window is
     * attributable to the row.
     */
    name: 'break-glass',
    holds: async (repositories, query) =>
      (
        await repositories.breakGlassGrants.list({
          ...ONE,
          sort: 'grantedAt',
          order: 'desc',
          userId: query.principal.subject,
          patientId: query.patientId,
          unexpiredAt: query.at,
        })
      ).total > 0,
  },
  {
    /* On the patient's care team. The most direct statement the practice makes
       about who is responsible for somebody. */
    name: 'care-team',
    holds: async (repositories, query) =>
      (
        await repositories.careTeamParticipants.list({
          ...ONE,
          sort: 'createdAt',
          order: 'desc',
          memberUserId: query.principal.subject,
        })
      ).rows.some((row) => row.patientId === query.patientId),
  },
  {
    /*
     * Saw them. An encounter is the record of care actually given.
     *
     * Subsumed by `facility-activity` for authorisation, and kept anyway. Both
     * lists are facility-scoped, so an encounter this reader is named on is
     * also one they can see, and removing the `providerId` filter changes no
     * answer - a mutation that does exactly that survives, and that is expected
     * rather than a gap.
     *
     * What it is not subsumed for is the audit record. "You saw this patient"
     * and "somebody at your site did" are different justifications for opening
     * a chart, and the trail should say which. That is why the specific sources
     * are ordered before the general one.
     */
    name: 'encounter',
    holds: async (repositories, query) =>
      (
        await repositories.encounters.list({
          ...ONE,
          sort: 'startedAt',
          order: 'desc',
          patientId: query.patientId,
          providerId: query.principal.subject,
        })
      ).total > 0,
  },
  {
    /* Due to see them. Same relationship to `facility-activity` as the
       encounter source above: subsumed for the answer, kept for the reason. */
    name: 'appointment',
    holds: async (repositories, query) =>
      (
        await repositories.appointments.list({
          ...ONE,
          sort: 'start',
          order: 'desc',
          patientId: query.patientId,
          providerId: query.principal.subject,
        })
      ).total > 0,
  },
  {
    /*
     * The patient has been seen, or is booked, somewhere this reader can see.
     *
     * The contentious source, and the one a practice cannot run without. A
     * receptionist checking somebody in, a biller working a claim, a nurse
     * rooming for a colleague: none of them is named on anything, and all of
     * them legitimately open the chart.
     *
     * "Somewhere this reader can see" is not a phrase this function enforces.
     * `encounterSpec` and `appointmentSpec` are both `facilityScoped`, so the
     * repository has already narrowed both lists to the caller's own sites
     * before this sees a row - the same narrowing every other list gets, rather
     * than a second opinion held here. An earlier draft filtered the rows again
     * on `canAccessFacility`; it was redundant, it survived a mutation that
     * removed it, and a filter that looks load-bearing and is not is worse than
     * no filter at all, because the next person to change the rule edits it and
     * nothing happens.
     *
     * It is deliberately not the `primaryFacilityId` narrowing that #139
     * examined and rejected. That is a static attribute of the patient row: a
     * patient registered at a site is readable by everyone there forever,
     * whether or not they have ever been seen. This requires activity. A
     * patient registered at one site and never seen at another is not readable
     * by the other site's staff.
     */
    name: 'facility-activity',
    holds: async (repositories, query) => {
      const encounters = await repositories.encounters.list({
        ...ONE,
        sort: 'startedAt',
        order: 'desc',
        patientId: query.patientId,
      });
      if (encounters.total > 0) return true;

      const appointments = await repositories.appointments.list({
        ...ONE,
        sort: 'start',
        order: 'desc',
        patientId: query.patientId,
      });
      return appointments.total > 0;
    },
  },
];

/** The source that authorised this read, or nothing when none did. */
export async function findCareRelationship(
  repositories: Repositories,
  query: CareRelationshipQuery
): Promise<string | undefined> {
  for (const source of RELATIONSHIP_SOURCES) {
    // Sequential on purpose. Ordered cheapest first, and most reads are
    // authorised by the first source that could authorise them, so running all
    // six concurrently would spend five queries to save none.
    if (await source.holds(repositories, query)) return source.name;
  }
  return undefined;
}
