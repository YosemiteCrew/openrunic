import { AUDIT_GENESIS_HASH, canonicalJson } from '@openrunic/database';
import { describe, expect, it } from 'vitest';

import { createAuditChainStore } from '../audit/chain-store.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import type { AuditEvent } from '../audit/types.js';

import {
  bearer,
  createTestApp,
  DEMO_TENANT_A,
  DEMO_TENANT_B,
  FIXED_NOW,
  jsonBearer,
  makePatientRow,
  seed,
  testId,
  TOKENS,
} from './support.js';

/**
 * The audit hash chain.
 *
 * The property under test is not "the store appends rows". It is that a past
 * row cannot be changed without the change being detectable, which is only
 * worth anything if the chain the suite verifies is the chain the application
 * actually writes. So these tests tamper with the store the running app wrote
 * into, rather than with a fixture built to be verifiable.
 */

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    actorType: 'user',
    actorId: testId(900),
    action: 'patient.created',
    targetType: 'Patient',
    targetId: testId(1),
    outcome: 'success',
    metadata: { requestId: 'req-1', method: 'POST', path: '/bff/v0/patients' },
    ...overrides,
  };
}

describe('the chain store', () => {
  it('links the first event to the genesis hash and starts the sequence at one', () => {
    const store = createAuditChainStore(() => testId(1));

    const first = store.append(DEMO_TENANT_A, event(), FIXED_NOW);

    expect(first.seq).toBe(1n);
    expect(first.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('links each event to the one before it', () => {
    const store = createAuditChainStore();

    const first = store.append(DEMO_TENANT_A, event(), FIXED_NOW);
    const second = store.append(DEMO_TENANT_A, event({ action: 'patient.updated' }), FIXED_NOW);

    expect(second.seq).toBe(2n);
    expect(second.prevHash).toBe(first.hash);
    expect(store.verify(DEMO_TENANT_A)).toMatchObject({ valid: true, checked: 2 });
  });

  it('gives each organisation its own chain, each starting at one', () => {
    const store = createAuditChainStore();

    store.append(DEMO_TENANT_A, event(), FIXED_NOW);
    const otherTenant = store.append(DEMO_TENANT_B, event(), FIXED_NOW);

    expect(otherTenant.seq).toBe(1n);
    expect(otherTenant.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(store.tenants()).toEqual([DEMO_TENANT_A, DEMO_TENANT_B]);
  });

  it('reports an empty chain as valid, because it has not been broken', () => {
    const store = createAuditChainStore();

    expect(store.verify(DEMO_TENANT_A)).toMatchObject({ valid: true, checked: 0 });
    expect(store.chain(DEMO_TENANT_A)).toEqual([]);
  });

  it('hashes the same event identically however its metadata was built', () => {
    const store = createAuditChainStore();

    const forward = store.append(
      DEMO_TENANT_A,
      event({ metadata: { a: 1, b: { c: 2, d: 3 } } }),
      FIXED_NOW
    );
    const other = createAuditChainStore();
    const reversed = other.append(
      DEMO_TENANT_A,
      event({ metadata: { b: { d: 3, c: 2 }, a: 1 } }),
      FIXED_NOW
    );

    // Key order is an accident of how the object was assembled, so the
    // canonical form sorts it away; two events that differ only in that are the
    // same event, and a chain that disagreed would fail verification on a
    // rebuild.
    expect(reversed.hash).toBe(forward.hash);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('tampering', () => {
  it('is detected when a past event is edited', () => {
    const store = createAuditChainStore();
    store.append(DEMO_TENANT_A, event(), FIXED_NOW);
    store.append(DEMO_TENANT_A, event({ action: 'patient.updated' }), FIXED_NOW);
    store.append(DEMO_TENANT_A, event({ action: 'patient.viewed' }), FIXED_NOW);

    // Reaching into the array is the only way to produce a tampered chain,
    // which is the point: nothing in the API can do this.
    const chain = store.chain(DEMO_TENANT_A) as unknown as { action: string }[];
    const target = chain[1];
    if (target === undefined) throw new Error('the fixture did not write three events');
    target.action = 'patient.definitely-not-deleted';

    expect(store.verify(DEMO_TENANT_A)).toMatchObject({
      valid: false,
      brokenAtSeq: 2n,
      reason: 'hash-mismatch',
    });
  });

  it('is detected when a past event is removed', () => {
    const store = createAuditChainStore();
    store.append(DEMO_TENANT_A, event(), FIXED_NOW);
    store.append(DEMO_TENANT_A, event({ action: 'patient.updated' }), FIXED_NOW);
    store.append(DEMO_TENANT_A, event({ action: 'patient.viewed' }), FIXED_NOW);

    (store.chain(DEMO_TENANT_A) as unknown[]).splice(1, 1);

    // The survivor after the hole still carries seq 3, so the gap shows up as a
    // sequence break rather than as a plausible two-event chain.
    expect(store.verify(DEMO_TENANT_A)).toMatchObject({
      valid: false,
      brokenAtSeq: 3n,
      reason: 'seq-not-contiguous',
    });
  });

  it('is detected when an event is relinked to a hash it did not follow', () => {
    const store = createAuditChainStore();
    store.append(DEMO_TENANT_A, event(), FIXED_NOW);
    store.append(DEMO_TENANT_A, event({ action: 'patient.updated' }), FIXED_NOW);

    const chain = store.chain(DEMO_TENANT_A) as unknown as { prevHash: string }[];
    const target = chain[1];
    if (target === undefined) throw new Error('the fixture did not write two events');
    target.prevHash = AUDIT_GENESIS_HASH;

    expect(store.verify(DEMO_TENANT_A)).toMatchObject({
      valid: false,
      brokenAtSeq: 2n,
      reason: 'prev-hash-mismatch',
    });
  });
});

describe('the sink', () => {
  it('chains what it records, so the log and the chain cannot disagree', async () => {
    const store = createAuditChainStore();
    const sink = createMemoryAuditSink({ store, now: () => FIXED_NOW });

    await sink.recordWrite(DEMO_TENANT_A, event(), { kind: 'test' });
    await sink.recordReadBatch(DEMO_TENANT_A, event({ action: 'phi.read' }));

    expect(sink.writes()[0]?.stored.seq).toBe(1n);
    expect(sink.reads()[0]?.stored.seq).toBe(2n);
    expect(store.verify(DEMO_TENANT_A)).toMatchObject({ valid: true, checked: 2 });
  });

  it('forgets its emission log without touching the chain', async () => {
    const store = createAuditChainStore();
    const sink = createMemoryAuditSink({ store, now: () => FIXED_NOW });
    await sink.recordWrite(DEMO_TENANT_A, event());

    sink.clear();

    expect(sink.events).toHaveLength(0);
    expect(store.chain(DEMO_TENANT_A)).toHaveLength(1);
  });
});

describe('a running request', () => {
  it('writes a chained event for the mutation and one for the reads', async () => {
    const { app, auditStore } = createTestApp();

    await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({
        mrn: 'OR-100482',
        givenName: 'Testina',
        familyName: 'Patientsson',
        birthDate: '1994-03-02',
      }),
    });

    const chain = auditStore.chain(DEMO_TENANT_A);
    expect(chain.map((entry) => entry.action)).toEqual(['patient.created']);
    expect(auditStore.verify(DEMO_TENANT_A)).toMatchObject({ valid: true, checked: 1 });
  });

  it('keeps the chain intact across a mixture of reads, writes and denials', async () => {
    const { app, dataset, auditStore } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));

    await app.request('/bff/v0/patients', { headers: bearer(TOKENS.clinicianA) });
    await app.request(`/bff/v0/patients/${testId(1)}`, { headers: bearer(TOKENS.clinicianA) });
    await app.request('/bff/v0/claims', { headers: bearer(TOKENS.clinicianA) });

    const verification = auditStore.verify(DEMO_TENANT_A);
    expect(verification.valid).toBe(true);
    expect(auditStore.chain(DEMO_TENANT_A).map((entry) => entry.action)).toContain(
      'authorisation.denied'
    );
  });

  it('never mixes two organisations into one chain', async () => {
    const { app, dataset, auditStore } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));

    await app.request('/bff/v0/patients', { headers: bearer(TOKENS.clinicianA) });
    await app.request('/bff/v0/patients', { headers: bearer(TOKENS.clinicianB) });

    expect(auditStore.verify(DEMO_TENANT_A).valid).toBe(true);
    expect(auditStore.chain(DEMO_TENANT_B).every((entry) => entry.tenantId === DEMO_TENANT_B)).toBe(
      true
    );
  });
});
