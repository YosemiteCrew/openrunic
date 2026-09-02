import { describe, expect, it } from 'vitest';

import { careTeamResource } from '../fhir/projections.js';
import type { ScopedRow } from '../repositories/rows.js';

import { FIXED_NOW, testId } from './support.js';

/**
 * The care team projection, and the one thing about it that is not the mapper's
 * job: when the resource last changed.
 *
 * A team is assembled from two tables, and the one that moves is the membership.
 * Adding or removing a member does not touch the team row, so the team's own
 * `updatedAt` is not when the resource changed. The happy path is exercised
 * through the served resources in `fhir.resources.test.ts`; what is asserted
 * here is the stamp, because getting it wrong produces no error anywhere: an
 * `$export?_since=` between the two instants simply excludes the team, the
 * export succeeds, and the consumer never learns a clinician left.
 */

const TENANT = testId(1);
const PATIENT = testId(200);
const TEAM = testId(300);
const LATER = new Date(FIXED_NOW.getTime() + 60 * 60 * 1000);

function teamRow(overrides: Partial<ScopedRow<'CareTeam'>> = {}): ScopedRow<'CareTeam'> {
  return {
    id: TEAM,
    tenantId: TENANT,
    patientId: PATIENT,
    status: 'ACTIVE',
    name: 'Primary care',
    periodStart: null,
    periodEnd: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function participantRow(
  overrides: Partial<ScopedRow<'CareTeamParticipant'>> = {}
): ScopedRow<'CareTeamParticipant'> {
  return {
    id: testId(301),
    tenantId: TENANT,
    careTeamId: TEAM,
    memberType: 'USER',
    memberUserId: testId(400),
    memberRelatedPersonId: null,
    roleCode: '207Q00000X',
    roleSystem: 'http://nucc.org/provider-taxonomy',
    roleText: null,
    periodStart: null,
    periodEnd: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('careTeamResource', () => {
  it('names each member at the resource type it is served as', () => {
    const resource = careTeamResource(teamRow(), [
      participantRow(),
      participantRow({
        id: testId(302),
        memberType: 'RELATED_PERSON',
        memberUserId: null,
        memberRelatedPersonId: testId(500),
      }),
      participantRow({
        id: testId(303),
        memberType: 'PATIENT',
        memberUserId: null,
      }),
    ]);

    expect(resource.participant?.map((p) => p.member?.reference)).toEqual([
      `Practitioner/${testId(400)}`,
      `RelatedPerson/${testId(500)}`,
      `Patient/${PATIENT}`,
    ]);
  });

  it('serves a team nobody has joined yet', () => {
    /* Reachable: the team row is created and members are added afterwards. */
    const resource = careTeamResource(teamRow(), []);

    expect(resource.participant).toBeUndefined();
    expect(resource.meta?.lastUpdated).toBeUndefined();
  });

  it('stamps from the newest member when a member moved after the team did', () => {
    const resource = careTeamResource(teamRow(), [
      participantRow(),
      participantRow({ id: testId(302), updatedAt: LATER }),
    ]);

    expect(resource.meta?.lastUpdated).toBe(LATER.toISOString());
  });

  it('takes the newest member wherever it sits in the list', () => {
    /* Ordered by creation, so the most recently edited member is not
       necessarily the last one. A reduce that took the final element would pass
       the test above and be wrong here. */
    const resource = careTeamResource(teamRow(), [
      participantRow({ id: testId(302), updatedAt: LATER }),
      participantRow(),
    ]);

    expect(resource.meta?.lastUpdated).toBe(LATER.toISOString());
  });

  it('leaves the team stamp alone when it is the later of the two', () => {
    /* Renaming the team moves the team row and no member. Overwriting with the
       members' older instant would age the resource backwards. */
    const resource = careTeamResource(teamRow({ updatedAt: LATER }), [participantRow()]);

    expect(resource.meta?.lastUpdated).toBeUndefined();
  });

  it('sets no stamp of its own when the members are no newer than the team', () => {
    /* `stampLastUpdated` puts the team's own instant on afterwards. A stamp
       written here that equalled it would be the same value arrived at twice,
       and the projection would be claiming knowledge it does not have. */
    expect(careTeamResource(teamRow(), [participantRow()]).meta?.lastUpdated).toBeUndefined();
  });
});
