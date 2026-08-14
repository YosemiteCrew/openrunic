import { describe, expect, it } from 'vitest';

import { createInMemoryTerminologyService } from './in-memory.js';
import { describeTerminologyServiceContract } from './test-support/contract.js';
import { FIXTURE_CONCEPTS, FIXTURE_VALUE_SETS, PROBLEM_SYSTEM } from './test-support/fixture.js';

describeTerminologyServiceContract({
  name: 'in-memory',
  create: (options) =>
    createInMemoryTerminologyService(FIXTURE_CONCEPTS, FIXTURE_VALUE_SETS, options),
});

describe('in-memory service construction', () => {
  it('works with no value sets configured at all', async () => {
    const service = createInMemoryTerminologyService(FIXTURE_CONCEPTS);
    const lookup = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-110' });
    const expansion = await service.expandValueSet({
      valueSet: 'http://example.invalid/vs/anything',
    });
    expect(lookup.ok).toBe(true);
    expect(!expansion.ok && expansion.error.kind).toBe('value_set_not_found');
  });

  it('copies the concepts it was given, so a later mutation cannot change an answer', async () => {
    const codes = [...FIXTURE_CONCEPTS];
    const service = createInMemoryTerminologyService(codes);
    codes.length = 0;
    const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-110' });
    expect(result.ok).toBe(true);
  });

  it('resolves the newest release whatever order the rows were loaded in', async () => {
    const service = createInMemoryTerminologyService([...FIXTURE_CONCEPTS].reverse());
    const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-100' });
    expect(result.ok && result.value.version).toBe('2026-01');
  });

  it('answers an empty deployment with system_not_found rather than an empty display', async () => {
    const service = createInMemoryTerminologyService([]);
    const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-110' });
    expect(!result.ok && result.error.kind).toBe('system_not_found');
  });
});
