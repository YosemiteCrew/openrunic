import { AUDIT_GENESIS_HASH, computeAuditHash, verifyAuditChain } from '@openrunic/database';
import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import { createPrismaAuditSink, isAuditWriteScope } from '../audit/prisma-sink.js';
import type { AuditEvent, AuditRequestContext } from '../audit/types.js';

import { DEMO_TENANT_A, FIXED_NOW, testId } from './support.js';

const CONTEXT: AuditRequestContext = {
  tenantId: DEMO_TENANT_A,
  actorType: 'user',
  actorId: testId(900),
  actorDisplay: 'Dr. Okafor',
  purposeOfUse: 'TREAT',
  requestId: 'req-1',
  method: 'GET',
  path: '/bff/v0/patients',
};

describe('AuditCollector', () => {
  it('emits nothing when the request touched nothing', async () => {
    const sink = createMemoryAuditSink();
    await new AuditCollector(sink, CONTEXT).flush();

    expect(sink.events).toHaveLength(0);
  });

  it('batches every read into one event carrying the target list', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    collector.read({ targetType: 'Patient', targetId: testId(1), patientId: testId(1) });
    collector.read({ targetType: 'Patient', targetId: testId(2), patientId: testId(2) });
    await collector.flush();

    expect(sink.reads()).toHaveLength(1);
    const event = sink.reads()[0]?.event;
    expect(event?.action).toBe('phi.read');
    expect(event?.metadata.targetCount).toBe(2);
    expect(event?.metadata.targets).toEqual([
      { type: 'Patient', id: testId(1), patientId: testId(1) },
      { type: 'Patient', id: testId(2), patientId: testId(2) },
    ]);
    // Two charts were read, so no single patient owns the event.
    expect(event?.patientId).toBeUndefined();
    expect(event?.metadata.patientIds).toEqual([testId(1), testId(2)]);
  });

  it('attributes a single-chart request to that patient', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    collector.read({ targetType: 'Patient', targetId: testId(1), patientId: testId(1) });
    collector.read({ targetType: 'Appointment', targetId: testId(9), patientId: testId(1) });
    await collector.flush();

    expect(sink.reads()[0]?.event.patientId).toBe(testId(1));
  });

  it('omits patientId from a target that has none', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    collector.read({ targetType: 'Appointment', targetId: testId(9) });
    await collector.flush();

    expect(sink.reads()[0]?.event.metadata.targets).toEqual([
      { type: 'Appointment', id: testId(9) },
    ]);
  });

  it('caps the target list and counts what it dropped', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    for (let index = 0; index < 520; index += 1) {
      collector.read({ targetType: 'Patient', targetId: testId(index) });
    }
    expect(collector.pendingReadCount).toBe(500);
    await collector.flush();

    const metadata = sink.reads()[0]?.event.metadata;
    expect(metadata?.targetCount).toBe(520);
    expect(metadata?.truncated).toBe(20);
  });

  it('flushes at most once', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    collector.read({ targetType: 'Patient', targetId: testId(1) });
    await collector.flush();
    await collector.flush();

    expect(sink.events).toHaveLength(1);
  });

  it('stamps every event with the request context', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    await collector.write({
      action: 'patient.created',
      targetType: 'Patient',
      targetId: testId(1),
    });

    expect(sink.writes()[0]?.event).toMatchObject({
      actorType: 'user',
      actorId: testId(900),
      actorDisplay: 'Dr. Okafor',
      purposeOfUse: 'TREAT',
      outcome: 'success',
      metadata: { requestId: 'req-1', method: 'GET', path: '/bff/v0/patients' },
    });
  });

  it('records a write as transactional only when a unit of work is supplied', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    await collector.write({ action: 'a', targetType: 'Patient' }, { tx: true });
    await collector.write({ action: 'b', targetType: 'Patient' });

    expect(sink.writes().map((entry) => entry.transactional)).toEqual([true, false]);
  });

  it('marks a denial as a failure', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    await collector.denial({ action: 'authorisation.denied', targetType: 'Route' });

    expect(sink.writes()[0]?.event.outcome).toBe('failure');
  });

  it('omits the optional context fields it was not given', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, {
      tenantId: DEMO_TENANT_A,
      actorType: 'service',
      actorId: 'worker',
      requestId: 'req-2',
      method: 'POST',
      path: '/x',
    });
    await collector.write({ action: 'a', targetType: 'Patient' });

    const event = sink.writes()[0]?.event;
    expect(event).not.toHaveProperty('actorDisplay');
    expect(event).not.toHaveProperty('purposeOfUse');
    expect(event).not.toHaveProperty('breakglass');
  });

  it('carries breakglass and the full target identity when supplied', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, { ...CONTEXT, breakglass: true });
    await collector.write({
      action: 'patient.viewed',
      targetType: 'Patient',
      targetId: testId(1),
      patientId: testId(1),
      encounterId: testId(2),
      facilityId: testId(3),
      metadata: { reason: 'emergency' },
    });

    expect(sink.writes()[0]?.event).toMatchObject({
      breakglass: true,
      encounterId: testId(2),
      facilityId: testId(3),
      metadata: { reason: 'emergency' },
    });
  });
});

describe('the in-memory sink', () => {
  it('separates the two channels and can be cleared', async () => {
    const sink = createMemoryAuditSink();
    const collector = new AuditCollector(sink, CONTEXT);
    collector.read({ targetType: 'Patient', targetId: testId(1) });
    await collector.write({ action: 'a', targetType: 'Patient' });
    await collector.flush();

    expect(sink.reads()).toHaveLength(1);
    expect(sink.writes()).toHaveLength(1);

    sink.clear();
    expect(sink.events).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- prisma sink */

interface StoredAuditRow {
  seq: bigint;
  hash: string;
  prevHash: string;
  [key: string]: unknown;
}

/** A fake `auditEvent` delegate that keeps the chain the real column would. */
function fakeAuditScope() {
  const rows: StoredAuditRow[] = [];
  return {
    rows,
    auditEvent: {
      create(args: { data: unknown }): Promise<{ id: string }> {
        const data = args.data as StoredAuditRow;
        rows.push(data);
        return Promise.resolve({ id: String(data.id) });
      },
      findFirst(): Promise<{ seq: bigint; hash: string } | null> {
        const last = rows.at(-1);
        return Promise.resolve(last ? { seq: last.seq, hash: last.hash } : null);
      },
    },
  };
}

const EVENT: AuditEvent = {
  actorType: 'user',
  actorId: testId(900),
  action: 'patient.created',
  targetType: 'Patient',
  targetId: testId(1),
  outcome: 'success',
  metadata: { requestId: 'req-1' },
};

describe('createPrismaAuditSink', () => {
  it('links each event onto the tenant chain', async () => {
    const standalone = fakeAuditScope();
    const sink = createPrismaAuditSink({ standalone, now: () => FIXED_NOW });

    await sink.recordWrite(DEMO_TENANT_A, EVENT);
    await sink.recordWrite(DEMO_TENANT_A, { ...EVENT, action: 'patient.updated' });

    expect(standalone.rows.map((row) => row.seq)).toEqual([1n, 2n]);
    expect(standalone.rows[0]?.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(standalone.rows[1]?.prevHash).toBe(standalone.rows[0]?.hash);
  });

  it('produces a chain the database package can verify', async () => {
    const standalone = fakeAuditScope();
    const sink = createPrismaAuditSink({ standalone, now: () => FIXED_NOW });
    await sink.recordWrite(DEMO_TENANT_A, EVENT);
    await sink.recordReadBatch(DEMO_TENANT_A, { ...EVENT, action: 'phi.read' });

    const verification = verifyAuditChain(
      standalone.rows.map((row) => ({
        tenantId: DEMO_TENANT_A,
        seq: row.seq,
        occurredAt: FIXED_NOW,
        actorType: String(row.actorType),
        actorId: String(row.actorId),
        action: String(row.action),
        targetType: String(row.targetType),
        targetId: String(row.targetId),
        outcome: String(row.outcome),
        metadata: row.metadata as Record<string, unknown>,
        prevHash: row.prevHash,
        hash: row.hash,
      }))
    );

    expect(verification.valid).toBe(true);
  });

  it('writes a mutation event through the caller transaction, not the root client', async () => {
    const standalone = fakeAuditScope();
    const transaction = fakeAuditScope();
    const sink = createPrismaAuditSink({ standalone, now: () => FIXED_NOW });

    await sink.recordWrite(DEMO_TENANT_A, EVENT, transaction);

    expect(transaction.rows).toHaveLength(1);
    expect(standalone.rows).toHaveLength(0);
  });

  it('refuses a unit of work it does not recognise rather than writing outside it', async () => {
    const sink = createPrismaAuditSink({ standalone: fakeAuditScope(), now: () => FIXED_NOW });

    await expect(sink.recordWrite(DEMO_TENANT_A, EVENT, { notATransaction: true })).rejects.toThrow(
      /unrecognised unit of work/
    );
  });

  it('recognises a scope by the delegate it carries', () => {
    expect(isAuditWriteScope(undefined)).toBe(false);
    expect(isAuditWriteScope({})).toBe(false);
    expect(isAuditWriteScope({ auditEvent: {} })).toBe(false);
    expect(isAuditWriteScope({ auditEvent: { create: () => undefined } })).toBe(false);
    expect(
      isAuditWriteScope({ auditEvent: { create: () => undefined, findFirst: () => undefined } })
    ).toBe(true);
  });

  it('defaults its clock to the wall clock', async () => {
    const standalone = fakeAuditScope();
    const before = Date.now();
    await createPrismaAuditSink({ standalone }).recordWrite(DEMO_TENANT_A, EVENT);

    const occurredAt = standalone.rows[0]?.occurredAt;
    expect(occurredAt).toBeInstanceOf(Date);
    expect((occurredAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('hashes what the database package would hash', async () => {
    const standalone = fakeAuditScope();
    await createPrismaAuditSink({ standalone, now: () => FIXED_NOW }).recordWrite(
      DEMO_TENANT_A,
      EVENT
    );

    expect(standalone.rows[0]?.hash).toBe(
      computeAuditHash(AUDIT_GENESIS_HASH, {
        ...EVENT,
        tenantId: DEMO_TENANT_A,
        seq: 1n,
        occurredAt: FIXED_NOW,
      })
    );
  });
});
