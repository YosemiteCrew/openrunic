import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import {
  createEmptyDataset,
  createMemoryRepositoryRegistry,
  type MemoryDataset,
} from '../repositories/memory.js';
import { createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import type { RepositoryRegistry, Repositories } from '../repositories/types.js';

import { createFakePort } from './fake-port.js';

import { DEMO_TENANT_A, FIXED_NOW, seed, storageColumns, testId } from './support.js';

/**
 * The two collections behind the record of care given: procedures, and the
 * teams that give it.
 *
 * Neither is writable at the FHIR boundary, which is a decision about that
 * boundary and not about these tables. Registration creates a care team;
 * documenting a visit records a procedure. Both paths go through the
 * repository, so the defaults it applies and the filters it answers are
 * production code, and untested defaults are exactly where a wrong one sits
 * unnoticed until a report counts the wrong rows.
 */

/**
 * The two backends, over one dataset.
 *
 * The memory repository answers a sort from `sortValue` and the Prisma one from
 * `orderBy`, and a spec has to supply both. They can disagree - one reading a
 * column the other does not - and nothing links them, so the ordering
 * assertions below run against each in turn rather than against whichever
 * happens to be convenient.
 */
type Backend = 'memory' | 'prisma';

function harness(backend: Backend = 'memory'): {
  dataset: MemoryDataset;
  repos: () => Repositories;
} {
  const dataset = createEmptyDataset();
  let counter = 600;
  const registry: RepositoryRegistry =
    backend === 'memory'
      ? createMemoryRepositoryRegistry({
          dataset,
          clock: { now: () => FIXED_NOW },
          nextId: () => testId((counter += 1)),
        })
      : createPrismaRepositoryRegistry((tenantId) =>
          createFakePort({
            dataset,
            tenantId,
            now: () => FIXED_NOW,
            nextId: () => testId((counter += 1)),
          })
        );

  return {
    dataset,
    repos: () =>
      registry.forRequest({
        tenantId: DEMO_TENANT_A,
        audit: new AuditCollector(createMemoryAuditSink(), {
          tenantId: DEMO_TENANT_A,
          actorType: 'user',
          actorId: testId(900),
          requestId: 'req-care-record',
          method: 'POST',
          path: '/test',
        }),
      }),
  };
}

const PATIENT = testId(200);
const ENCOUNTER = testId(201);
const PROVIDER = testId(202);
const LATER = new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000);

const PROCEDURE = {
  patientId: PATIENT,
  code: '45378',
  display: 'Diagnostic colonoscopy',
  performedStart: FIXED_NOW,
};

describe('the procedure repository', () => {
  it('records one with the schema defaults, which are CPT and completed', () => {
    /* A practice codes a procedure in CPT and the charge beside it carries the
       same code. A row that defaulted to SNOMED would not match its charge. */
    return harness()
      .repos()
      .procedures.create(PROCEDURE)
      .then((row) => {
        expect(row.codeSystem).toBe('http://www.ama-assn.org/go/cpt');
        expect(row.status).toBe('COMPLETED');
        expect(row.performedEnd).toBeNull();
        expect(row.encounterId).toBeNull();
      });
  });

  it('carries every optional field through', async () => {
    const row = await harness()
      .repos()
      .procedures.create({
        ...PROCEDURE,
        encounterId: ENCOUNTER,
        codeSystem: 'http://snomed.info/sct',
        snomedCode: '73761001',
        status: 'NOT_DONE',
        performedEnd: LATER,
        bodySiteCode: '71854001',
        outcomeCode: '385669000',
        notDoneReason: 'Declined by the patient',
        note: 'Rescheduled.',
        performedById: PROVIDER,
        recordedById: PROVIDER,
      });

    expect(row).toMatchObject({
      encounterId: ENCOUNTER,
      snomedCode: '73761001',
      status: 'NOT_DONE',
      performedEnd: LATER,
      bodySiteCode: '71854001',
      outcomeCode: '385669000',
      notDoneReason: 'Declined by the patient',
      note: 'Rescheduled.',
      performedById: PROVIDER,
    });
  });

  it('filters by patient, encounter, status and code', async () => {
    const repos = harness().repos();
    await repos.procedures.create(PROCEDURE);
    await repos.procedures.create({
      ...PROCEDURE,
      patientId: testId(210),
      encounterId: ENCOUNTER,
      code: '99213',
      status: 'NOT_DONE',
    });

    const query = { page: 1, pageSize: 25, sort: 'performedStart', order: 'asc' } as const;
    await expect(repos.procedures.list({ ...query, patientId: PATIENT })).resolves.toMatchObject({
      total: 1,
    });
    await expect(
      repos.procedures.list({ ...query, encounterId: ENCOUNTER })
    ).resolves.toMatchObject({ total: 1 });
    await expect(repos.procedures.list({ ...query, status: 'NOT_DONE' })).resolves.toMatchObject({
      total: 1,
    });
    await expect(repos.procedures.list({ ...query, code: '45378' })).resolves.toMatchObject({
      total: 1,
    });
  });

  it.each(['memory', 'prisma'] as const)(
    'narrows to a half-open window on when it was performed (%s)',
    async (backend) => {
      /*
       * `Procedure?date=` used to spread a window onto the query that nothing
       * below read, so the filter was advertised, accepted and ignored: a
       * client asking for last month's procedures received the patient's whole
       * history and had no way to tell. Object spread is not
       * excess-property-checked, so the compiler said nothing either.
       *
       * Both backends, because the window is applied in two places that nothing
       * ties together.
       */
      const repos = harness(backend).repos();
      const early = await repos.procedures.create(PROCEDURE);
      await repos.procedures.create({ ...PROCEDURE, performedStart: LATER });

      const query = { page: 1, pageSize: 25, sort: 'performedStart', order: 'asc' } as const;
      await expect(
        repos.procedures
          .list({ ...query, from: FIXED_NOW, to: LATER })
          .then((page) => page.rows.map((row) => row.id))
      ).resolves.toEqual([early.id]);

      /* Half-open at both ends: `to` is exclusive, so a procedure performed at
         exactly `to` belongs to the next window and not this one. */
      await expect(repos.procedures.list({ ...query, from: LATER })).resolves.toMatchObject({
        total: 1,
      });
      await expect(repos.procedures.list({ ...query, to: FIXED_NOW })).resolves.toMatchObject({
        total: 0,
      });
    }
  );

  it.each(['memory', 'prisma'] as const)(
    'sorts by when it was performed or when it was recorded (%s)',
    async (backend) => {
      /*
       * Two different questions. The colonoscopy done last week and entered
       * today is first by one and last by the other, and a list that answered
       * with the wrong one would put a backdated entry at the top of today's
       * chart.
       *
       * Both backends, because the memory one reads `sortValue` and the Prisma
       * one reads `orderBy`. They are separate functions on the spec with
       * nothing tying them together, so a sort key added to one and forgotten
       * in the other passes every test that only ever asks one of them.
       */
      const repos = harness(backend).repos();
      const first = await repos.procedures.create({ ...PROCEDURE, performedStart: LATER });
      const second = await repos.procedures.create(PROCEDURE);

      const query = { page: 1, pageSize: 25, order: 'asc' } as const;
      await expect(
        repos.procedures
          .list({ ...query, sort: 'performedStart' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([second.id, first.id]);
      await expect(
        repos.procedures.list({ ...query, sort: 'createdAt' }).then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([first.id, second.id]);
    }
  );

  it('patches only the fields it was given', async () => {
    const repos = harness().repos();
    const row = await repos.procedures.create(PROCEDURE);

    const patched = await repos.procedures.update(row.id, { status: 'ENTERED_IN_ERROR' });

    expect(patched?.status).toBe('ENTERED_IN_ERROR');
    expect(patched?.display).toBe('Diagnostic colonoscopy');
  });
});

describe('the care plan repository', () => {
  const PLAN = {
    patientId: PATIENT,
    narrative: 'Continue metformin. Recheck HbA1c in three months.',
  };

  it('creates a plan that is active and a plan, not an order', () => {
    /* The intent default is not decoration. A receiving system treats ORDER as
       work somebody is obliged to carry out, so a visit note defaulting to it
       would put obligations on people who agreed to none. */
    return harness()
      .repos()
      .carePlans.create(PLAN)
      .then((row) => {
        expect(row.status).toBe('ACTIVE');
        expect(row.intent).toBe('PLAN');
        expect(row.title).toBeNull();
        expect(row.encounterId).toBeNull();
        expect(row.authorId).toBeNull();
      });
  });

  it('carries every optional field through', async () => {
    const row = await harness()
      .repos()
      .carePlans.create({
        ...PLAN,
        encounterId: ENCOUNTER,
        status: 'ON_HOLD',
        intent: 'ORDER',
        title: 'Diabetes management',
        periodStart: FIXED_NOW,
        periodEnd: LATER,
        authorId: PROVIDER,
      });

    expect(row).toMatchObject({
      encounterId: ENCOUNTER,
      status: 'ON_HOLD',
      intent: 'ORDER',
      title: 'Diabetes management',
      periodStart: FIXED_NOW,
      periodEnd: LATER,
      authorId: PROVIDER,
    });
  });

  it('filters by patient, encounter and status', async () => {
    const repos = harness().repos();
    await repos.carePlans.create(PLAN);
    await repos.carePlans.create({
      ...PLAN,
      patientId: testId(210),
      encounterId: ENCOUNTER,
      status: 'COMPLETED',
    });

    const query = { page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' } as const;
    await expect(repos.carePlans.list({ ...query, patientId: PATIENT })).resolves.toMatchObject({
      total: 1,
    });
    await expect(repos.carePlans.list({ ...query, encounterId: ENCOUNTER })).resolves.toMatchObject(
      {
        total: 1,
      }
    );
    await expect(repos.carePlans.list({ ...query, status: 'COMPLETED' })).resolves.toMatchObject({
      total: 1,
    });
  });

  it.each(['memory', 'prisma'] as const)(
    'answers an empty id set with nothing, which is how a category search says no (%s)',
    async (backend) => {
      /*
       * The FHIR boundary reaches this: `CarePlan?category=` naming a category
       * this server does not serve is a legitimate search with no results. An
       * empty `in` list has to mean nothing rather than everything.
       *
       * Both backends, and this one earned it. With only the memory backend
       * asked, deleting the `ids` clause from the Prisma `where` passed every
       * test: the filter would have been advertised, honoured in tests, and
       * ignored in production.
       */
      const repos = harness(backend).repos();
      const row = await repos.carePlans.create(PLAN);

      const query = { page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' } as const;
      await expect(repos.carePlans.list({ ...query, ids: [] })).resolves.toMatchObject({
        total: 0,
      });
      await expect(repos.carePlans.list({ ...query, ids: [row.id] })).resolves.toMatchObject({
        total: 1,
      });
    }
  );

  it.each(['memory', 'prisma'] as const)(
    'sorts by creation in both directions (%s)',
    async (backend) => {
      const { dataset, repos } = harness(backend);
      for (const [id, createdAt] of [
        [testId(330), FIXED_NOW],
        [testId(331), LATER],
      ] as const) {
        seed(dataset, 'CarePlan', {
          ...storageColumns(id),
          createdAt,
          updatedAt: createdAt,
          patientId: PATIENT,
          encounterId: null,
          status: 'ACTIVE',
          intent: 'PLAN',
          title: null,
          narrative: 'Reassess at the next visit.',
          periodStart: null,
          periodEnd: null,
          authorId: null,
        });
      }

      const query = { page: 1, pageSize: 25, sort: 'createdAt' } as const;
      await expect(
        repos()
          .carePlans.list({ ...query, order: 'desc' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(331), testId(330)]);
      await expect(
        repos()
          .carePlans.list({ ...query, order: 'asc' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(330), testId(331)]);
    }
  );

  it('patches the status without rewriting the narrative', async () => {
    const repos = harness().repos();
    const row = await repos.carePlans.create(PLAN);

    const patched = await repos.carePlans.update(row.id, { status: 'COMPLETED' });

    expect(patched?.status).toBe('COMPLETED');
    expect(patched?.narrative).toBe(PLAN.narrative);
  });
});

describe('the goal repository', () => {
  const GOAL = { patientId: PATIENT, description: 'HbA1c below 7%' };

  it('creates a goal that is active and unassessed', () => {
    /* `achievementStatus` stays null rather than defaulting to IN_PROGRESS.
       "Nobody has looked yet" and "no progress" are different clinical facts,
       and a default would report the second when the first is true. */
    return harness()
      .repos()
      .goals.create(GOAL)
      .then((row) => {
        expect(row.lifecycleStatus).toBe('ACTIVE');
        expect(row.achievementStatus).toBeNull();
        expect(row.priority).toBeNull();
        expect(row.carePlanId).toBeNull();
        expect(row.targetValue).toBeNull();
      });
  });

  it('carries a single-value target through, leaving the range columns null', async () => {
    const row = await harness()
      .repos()
      .goals.create({
        ...GOAL,
        targetMeasureCode: '4548-4',
        targetMeasureSystem: 'http://loinc.org',
        targetValue: 7,
        targetUnit: '%',
        dueDate: LATER,
      });

    expect(row.targetValue).toBe(7);
    expect(row.targetLow).toBeNull();
    expect(row.targetHigh).toBeNull();
    expect(row.targetUnit).toBe('%');
  });

  it('carries a range target through, leaving the value column null', async () => {
    const row = await harness()
      .repos()
      .goals.create({
        ...GOAL,
        description: 'Systolic between 110 and 130',
        targetLow: 110,
        targetHigh: 130,
        targetUnit: 'mm[Hg]',
      });

    expect(row.targetValue).toBeNull();
    expect(row.targetLow).toBe(110);
    expect(row.targetHigh).toBe(130);
  });

  it('carries every remaining optional field through', async () => {
    const row = await harness()
      .repos()
      .goals.create({
        ...GOAL,
        carePlanId: testId(220),
        lifecycleStatus: 'ON_HOLD',
        achievementStatus: 'WORSENING',
        priority: 'HIGH',
        descriptionCode: '443631005',
        descriptionSystem: 'http://snomed.info/sct',
        startDate: FIXED_NOW,
        statusReason: 'Deferred until after surgery',
        expressedByUserId: PROVIDER,
      });

    expect(row).toMatchObject({
      carePlanId: testId(220),
      lifecycleStatus: 'ON_HOLD',
      achievementStatus: 'WORSENING',
      priority: 'HIGH',
      descriptionCode: '443631005',
      startDate: FIXED_NOW,
      statusReason: 'Deferred until after surgery',
      expressedByUserId: PROVIDER,
    });
  });

  it('filters by patient, care plan and lifecycle status', async () => {
    const repos = harness().repos();
    await repos.goals.create(GOAL);
    await repos.goals.create({
      ...GOAL,
      patientId: testId(210),
      carePlanId: testId(220),
      lifecycleStatus: 'COMPLETED',
    });

    const query = { page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' } as const;
    await expect(repos.goals.list({ ...query, patientId: PATIENT })).resolves.toMatchObject({
      total: 1,
    });
    await expect(repos.goals.list({ ...query, carePlanId: testId(220) })).resolves.toMatchObject({
      total: 1,
    });
    await expect(
      repos.goals.list({ ...query, lifecycleStatus: 'COMPLETED' })
    ).resolves.toMatchObject({ total: 1 });
  });

  it.each(['memory', 'prisma'] as const)(
    'sorts by due date and by creation (%s)',
    async (backend) => {
      /*
       * Two different questions, and both backends, because the memory one
       * answers from `sortValue` and the Prisma one from `orderBy`.
       */
      const { dataset, repos } = harness(backend);
      for (const [id, createdAt, dueDate] of [
        [testId(340), FIXED_NOW, LATER],
        [testId(341), LATER, FIXED_NOW],
      ] as const) {
        seed(dataset, 'Goal', {
          ...storageColumns(id),
          createdAt,
          updatedAt: createdAt,
          patientId: PATIENT,
          carePlanId: null,
          lifecycleStatus: 'ACTIVE',
          achievementStatus: null,
          priority: null,
          description: 'Something',
          descriptionCode: null,
          descriptionSystem: null,
          targetMeasureCode: null,
          targetMeasureSystem: null,
          targetValue: null,
          targetLow: null,
          targetHigh: null,
          targetUnit: null,
          startDate: null,
          dueDate,
          statusReason: null,
          expressedByUserId: null,
        });
      }

      const query = { page: 1, pageSize: 25, order: 'asc' } as const;
      await expect(
        repos()
          .goals.list({ ...query, sort: 'dueDate' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(341), testId(340)]);
      await expect(
        repos()
          .goals.list({ ...query, sort: 'createdAt' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(340), testId(341)]);
    }
  );

  it('patches the achievement without disturbing the lifecycle', async () => {
    /* The pair that must stay independent: a goal going badly is still active,
       and a worklist of active goals that shed it would drop the patients who
       most need to be on it. */
    const repos = harness().repos();
    const row = await repos.goals.create(GOAL);

    const patched = await repos.goals.update(row.id, { achievementStatus: 'WORSENING' });

    expect(patched?.achievementStatus).toBe('WORSENING');
    expect(patched?.lifecycleStatus).toBe('ACTIVE');
  });
});

describe('the care team repository', () => {
  it('creates a team that is active and unnamed, which is the ordinary one', () => {
    /* Most practices run one standing team per patient with no name and no
       start anybody recorded. Defaulting to PROPOSED would make every such team
       look like a plan rather than the people currently responsible. */
    return harness()
      .repos()
      .careTeams.create({ patientId: PATIENT })
      .then((row) => {
        expect(row.status).toBe('ACTIVE');
        expect(row.name).toBeNull();
        expect(row.periodStart).toBeNull();
        expect(row.periodEnd).toBeNull();
      });
  });

  it('carries a name and a period through', async () => {
    const row = await harness().repos().careTeams.create({
      patientId: PATIENT,
      status: 'SUSPENDED',
      name: 'Diabetes care',
      periodStart: FIXED_NOW,
      periodEnd: LATER,
    });

    expect(row).toMatchObject({
      status: 'SUSPENDED',
      name: 'Diabetes care',
      periodStart: FIXED_NOW,
      periodEnd: LATER,
    });
  });

  it('filters by patient and by status', async () => {
    const repos = harness().repos();
    await repos.careTeams.create({ patientId: PATIENT });
    await repos.careTeams.create({ patientId: testId(210), status: 'INACTIVE' });

    const query = { page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' } as const;
    await expect(repos.careTeams.list({ ...query, patientId: PATIENT })).resolves.toMatchObject({
      total: 1,
    });
    await expect(repos.careTeams.list({ ...query, status: 'INACTIVE' })).resolves.toMatchObject({
      total: 1,
    });
  });

  it.each(['memory', 'prisma'] as const)(
    'sorts by creation in both directions (%s)',
    async (backend) => {
      /*
       * Seeded rather than created, because the harness clock is fixed and two
       * rows made through it share a `createdAt`. The tie-break on id is
       * ascending in both directions by design, so equal timestamps would give
       * the same order twice and this assertion would hold whatever `orderBy`
       * did with the direction.
       */
      const { dataset, repos } = harness(backend);
      seed(dataset, 'CareTeam', {
        ...storageColumns(testId(310)),
        patientId: PATIENT,
        status: 'ACTIVE',
        name: null,
        periodStart: null,
        periodEnd: null,
      });
      seed(dataset, 'CareTeam', {
        ...storageColumns(testId(311)),
        createdAt: LATER,
        updatedAt: LATER,
        patientId: PATIENT,
        status: 'ACTIVE',
        name: null,
        periodStart: null,
        periodEnd: null,
      });

      const query = { page: 1, pageSize: 25, sort: 'createdAt' } as const;
      await expect(
        repos()
          .careTeams.list({ ...query, order: 'desc' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(311), testId(310)]);
      await expect(
        repos()
          .careTeams.list({ ...query, order: 'asc' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(310), testId(311)]);
    }
  );

  it('patches the status without clearing the name', async () => {
    const repos = harness().repos();
    const row = await repos.careTeams.create({ patientId: PATIENT, name: 'Diabetes care' });

    const patched = await repos.careTeams.update(row.id, { status: 'INACTIVE' });

    expect(patched?.status).toBe('INACTIVE');
    expect(patched?.name).toBe('Diabetes care');
  });
});

describe('the care team participant repository', () => {
  const CLINICIAN = {
    careTeamId: testId(300),
    patientId: PATIENT,
    memberType: 'USER',
    memberUserId: PROVIDER,
    roleCode: '207Q00000X',
    roleSystem: 'http://nucc.org/provider-taxonomy',
  } as const;

  it('creates a clinician member with the other member column left null', async () => {
    const row = await harness().repos().careTeamParticipants.create(CLINICIAN);

    expect(row.memberUserId).toBe(PROVIDER);
    expect(row.memberRelatedPersonId).toBeNull();
    expect(row.roleText).toBeNull();
  });

  it('creates a patient member carrying neither id', async () => {
    /* The team already names its subject. A second id could only agree with it
       or be wrong, and the database refuses the row that carries one. */
    const row = await harness()
      .repos()
      .careTeamParticipants.create({
        careTeamId: testId(300),
        patientId: PATIENT,
        memberType: 'PATIENT',
        roleCode: '116154003',
        roleSystem: 'http://snomed.info/sct',
      });

    expect(row.memberUserId).toBeNull();
    expect(row.memberRelatedPersonId).toBeNull();
  });

  it('carries a role text and a member period through', async () => {
    const row = await harness()
      .repos()
      .careTeamParticipants.create({
        ...CLINICIAN,
        roleText: 'Family medicine',
        periodStart: FIXED_NOW,
        periodEnd: LATER,
      });

    expect(row).toMatchObject({
      roleText: 'Family medicine',
      periodStart: FIXED_NOW,
      periodEnd: LATER,
    });
  });

  it('narrows to one team, to several teams, and to a member', async () => {
    /* The several-teams filter is what the FHIR projection uses: it loads the
       members for a whole page of teams in one query rather than one per team. */
    const repos = harness().repos();
    await repos.careTeamParticipants.create(CLINICIAN);
    await repos.careTeamParticipants.create({
      ...CLINICIAN,
      careTeamId: testId(301),
      memberUserId: testId(203),
    });

    const query = { page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' } as const;
    await expect(
      repos.careTeamParticipants.list({ ...query, careTeamId: testId(300) })
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      repos.careTeamParticipants.list({ ...query, careTeamIds: [testId(300), testId(301)] })
    ).resolves.toMatchObject({ total: 2 });
    await expect(
      repos.careTeamParticipants.list({ ...query, memberUserId: PROVIDER })
    ).resolves.toMatchObject({ total: 1 });
  });

  it('intersects the two team filters rather than letting one win', async () => {
    /*
     * Both name the same column, and a reader expects two filters to narrow.
     * Letting either win silently would answer a query for "this team, among
     * those teams" with rows from a team the caller excluded.
     */
    const repos = harness().repos();
    await repos.careTeamParticipants.create(CLINICIAN);
    await repos.careTeamParticipants.create({ ...CLINICIAN, careTeamId: testId(301) });

    const query = { page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' } as const;
    await expect(
      repos.careTeamParticipants.list({
        ...query,
        careTeamId: testId(300),
        careTeamIds: [testId(300), testId(301)],
      })
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      repos.careTeamParticipants.list({
        ...query,
        careTeamId: testId(300),
        careTeamIds: [testId(301)],
      })
    ).resolves.toMatchObject({ total: 0 });
  });

  it.each(['memory', 'prisma'] as const)(
    'sorts by creation in both directions (%s)',
    async (backend) => {
      /* Seeded for the same reason the team sort test is: a fixed clock gives two
       created rows the same instant, and the ascending id tie-break then hides
       the direction entirely, so the assertion would hold whatever `orderBy`
       did with it. */
      const { dataset, repos } = harness(backend);
      for (const [id, createdAt] of [
        [testId(320), FIXED_NOW],
        [testId(321), LATER],
      ] as const) {
        seed(dataset, 'CareTeamParticipant', {
          ...storageColumns(id),
          createdAt,
          updatedAt: createdAt,
          careTeamId: testId(300),
          patientId: PATIENT,
          memberType: 'USER',
          memberUserId: PROVIDER,
          memberRelatedPersonId: null,
          roleCode: '207Q00000X',
          roleSystem: 'http://nucc.org/provider-taxonomy',
          roleText: null,
          periodStart: null,
          periodEnd: null,
        });
      }

      const query = { page: 1, pageSize: 25, sort: 'createdAt' } as const;
      await expect(
        repos()
          .careTeamParticipants.list({ ...query, order: 'desc' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(321), testId(320)]);
      await expect(
        repos()
          .careTeamParticipants.list({ ...query, order: 'asc' })
          .then((p) => p.rows.map((r) => r.id))
      ).resolves.toEqual([testId(320), testId(321)]);
    }
  );

  it('patches the role, and cannot patch who the member is', async () => {
    /*
     * `memberType` and both member columns are one fact spread over three, held
     * consistent by a check constraint. A patch that could move any of them
     * independently could put the row in a state the database refuses: a 500
     * naming a constraint, where the caller wanted to replace a team member.
     * The patch type excludes all three, so the line below does not compile if
     * that changes, and removing the old member and adding the new one stays
     * the only way to do it.
     */
    const repos = harness().repos();
    const row = await repos.careTeamParticipants.create(CLINICIAN);

    // @ts-expect-error the member columns are not patchable, and must not become so
    await repos.careTeamParticipants.update(row.id, { memberUserId: testId(999) });

    const patched = await repos.careTeamParticipants.update(row.id, {
      roleText: 'Internal medicine',
    });

    expect(patched?.roleText).toBe('Internal medicine');
    expect(patched?.memberUserId).toBe(PROVIDER);
  });
});
