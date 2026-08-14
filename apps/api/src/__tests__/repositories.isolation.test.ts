import { describe } from 'vitest';

import { createEmptyDataset, createMemoryRepositoryRegistry } from '../repositories/memory.js';
import { createPrismaRepositoryRegistry } from '../repositories/prisma.js';

import { createFakePort } from './fake-port.js';
import { runIsolationContract, type IsolationSubject } from './repositories.contract.js';
import { FIXED_NOW, testId } from './support.js';

/**
 * Cross-tenant isolation, proved for every repository against both storage
 * implementations.
 *
 * The Prisma half runs over a fake port that evaluates the `where` clause it is
 * handed and applies the tenant narrowing the way `createTenantClient` does.
 * That is what makes it a real test rather than a restatement: if the adapter
 * built a filter that selected the wrong rows, or leaned on a narrowing it does
 * not actually get, the fake would return the other organisation's row and
 * these assertions would fail.
 */

describe('the in-memory repositories', () => {
  runIsolationContract((): IsolationSubject => {
    const dataset = createEmptyDataset();
    let counter = 700;
    return {
      name: 'memory',
      dataset,
      registry: createMemoryRepositoryRegistry({
        dataset,
        clock: { now: () => FIXED_NOW },
        nextId: () => testId((counter += 1)),
      }),
    };
  });
});

describe('the Prisma repositories', () => {
  runIsolationContract((): IsolationSubject => {
    const dataset = createEmptyDataset();
    let counter = 800;
    return {
      name: 'prisma',
      dataset,
      registry: createPrismaRepositoryRegistry((tenantId) =>
        createFakePort({
          dataset,
          tenantId,
          now: () => FIXED_NOW,
          nextId: () => testId((counter += 1)),
        })
      ),
    };
  });
});
