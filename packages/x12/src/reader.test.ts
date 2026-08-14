import { describe, expect, it } from 'vitest';

import { FIXTURES, readFixture } from './__fixtures__/index.js';
import { firstTransactionOfType, readInterchange } from './reader.js';
import { DEFAULT_DELIMITERS } from './delimiters.js';
import { readSegments, writeSegment } from './segments.js';
import { expectErr, expectOk } from './test-support/result.js';
import { writeInterchange } from './writer.js';

/**
 * Reader tests.
 *
 * The reader's job is not to be permissive. Its job is to refuse anything it
 * cannot vouch for, so that no mapper ever runs against a document whose own
 * self-checks disagree with its contents. Most of what follows is therefore
 * about what the reader rejects.
 */

const WELL_FORMED = FIXTURES.filter((fixture) => fixture.kind !== 'malformed');

describe('reading a well formed interchange', () => {
  it.each(WELL_FORMED.map((fixture) => [fixture.name, fixture.transactionSet] as const))(
    'reconciles the envelope of %s',
    (name, transactionSet) => {
      const interchange = expectOk(readInterchange(readFixture(name)));
      expect(interchange.usageIndicator).toBe('T');
      expect(interchange.groups).toHaveLength(1);
      const transaction = expectOk(firstTransactionOfType(interchange, transactionSet));
      expect(transaction.setIdentifier).toBe(transactionSet);
      expect(transaction.segments.length).toBeGreaterThan(0);
    }
  );

  it('exposes the group header fields a partner keys on', () => {
    const interchange = expectOk(readInterchange(readFixture('837p-single-line.edi')));
    const [group] = interchange.groups;
    expect(group).toMatchObject({
      functionalIdentifier: 'HC',
      applicationSender: 'CEDARHOLLOW',
      applicationReceiver: 'ROUTINGSVC',
      date: '20260316',
      time: '1405',
      controlNumber: '1',
      version: '005010X222A1',
    });
  });

  it('hands the mapper only the body, never the ST or the SE', () => {
    const interchange = expectOk(readInterchange(readFixture('999-accepted.edi')));
    const transaction = expectOk(firstTransactionOfType(interchange, '999'));
    expect(transaction.segments.map((source) => source.tag)).toEqual(['AK1', 'AK2', 'IK5', 'AK9']);
  });

  it('reports a transaction set the interchange does not carry', () => {
    const interchange = expectOk(readInterchange(readFixture('999-accepted.edi')));
    const error = expectErr(firstTransactionOfType(interchange, '835'));
    expect(error).toMatchObject({
      kind: 'unsupported_transaction',
      transactionSet: '999',
      supported: ['835'],
    });
  });

  it('reports an interchange that carries no transaction sets at all', () => {
    const empty = expectOk(readInterchange(readFixture('999-accepted.edi')));
    const error = expectErr(firstTransactionOfType({ ...empty, groups: [] }, '835'));
    expect(error).toMatchObject({ kind: 'unsupported_transaction', transactionSet: '' });
  });
});

describe('refusing a document that cannot be vouched for', () => {
  const base = readFixture('837p-single-line.edi');

  it('rejects an empty document', () => {
    expect(expectErr(readInterchange('')).kind).toBe('empty_input');
  });

  it('rejects an ISA whose declared separators collide', () => {
    const collided = `${base.slice(0, 105)}:${base.slice(106)}`;
    const error = expectErr(readInterchange(collided));
    expect(error.kind).toBe('malformed_envelope');
    expect(error.message).toContain('four distinct characters');
  });

  it('rejects a document whose first segment is not ISA', () => {
    const doctored = `${base.slice(0, 106)}${base.slice(106)}`.replace('ISA*', 'ISX*');
    expect(expectErr(readInterchange(doctored)).kind).toBe('malformed_envelope');
  });

  it('rejects a segment count that disagrees with the transaction set', () => {
    const error = expectErr(readInterchange(readFixture('malformed-se-count.edi')));
    expect(error).toMatchObject({
      kind: 'count_mismatch',
      counter: 'SE01',
      level: 'transaction',
      declared: 99,
      actual: 29,
    });
  });

  it('rejects an IEA02 that does not echo ISA13', () => {
    const error = expectErr(readInterchange(readFixture('malformed-control-mismatch.edi')));
    expect(error).toMatchObject({
      kind: 'control_mismatch',
      level: 'interchange',
      header: '000100001',
      trailer: '000100009',
    });
  });

  it('rejects a GE02 that does not echo GS06', () => {
    const error = expectErr(readInterchange(base.replace('GE*1*1~', 'GE*1*9~')));
    expect(error).toMatchObject({ kind: 'control_mismatch', level: 'group' });
  });

  it('rejects an SE02 that does not echo ST02', () => {
    const error = expectErr(readInterchange(base.replace('SE*29*0001~', 'SE*29*0009~')));
    expect(error).toMatchObject({ kind: 'control_mismatch', level: 'transaction' });
  });

  it('rejects a group count that disagrees with the groups present', () => {
    const error = expectErr(readInterchange(base.replace('IEA*1*', 'IEA*2*')));
    expect(error).toMatchObject({
      kind: 'count_mismatch',
      counter: 'IEA01',
      declared: 2,
      actual: 1,
    });
  });

  it('rejects a transaction count that disagrees with the sets present', () => {
    const error = expectErr(readInterchange(base.replace('GE*1*1~', 'GE*3*1~')));
    expect(error).toMatchObject({
      kind: 'count_mismatch',
      counter: 'GE01',
      declared: 3,
      actual: 1,
    });
  });

  it('reports a non-numeric count rather than reading it as zero', () => {
    const error = expectErr(readInterchange(base.replace('SE*29*', 'SE*many*')));
    expect(error).toMatchObject({ kind: 'count_mismatch', counter: 'SE01' });
    expect(Number.isNaN((error as { declared: number }).declared)).toBe(true);
  });

  it('rejects a stray segment at the interchange level', () => {
    const error = expectErr(readInterchange(base.replace('GS*HC*', 'ZZZ*1~GS*HC*')));
    expect(error).toMatchObject({
      kind: 'unexpected_segment',
      actual: 'ZZZ',
      expected: ['GS', 'IEA'],
    });
  });

  it('rejects a stray segment between GS and its first ST', () => {
    const error = expectErr(readInterchange(base.replace('ST*837*', 'ZZZ*1~ST*837*')));
    expect(error).toMatchObject({
      kind: 'unexpected_segment',
      actual: 'ZZZ',
      expected: ['ST', 'GE'],
    });
  });

  it('rejects a transaction set that never reaches its SE', () => {
    const error = expectErr(readInterchange(base.replace('SE*29*0001~', '')));
    expect(error).toMatchObject({ kind: 'unexpected_segment', actual: 'GE', expected: ['SE'] });
  });

  it('rejects an interchange whose last transaction set is unterminated', () => {
    const error = expectErr(
      readInterchange(base.replace('SE*29*0001~GE*1*1~IEA*1*000100001~', ''))
    );
    expect(error).toMatchObject({ kind: 'malformed_envelope' });
    expect(error.message).toContain('SE trailer');
  });

  it('rejects a functional group that never reaches its GE', () => {
    const error = expectErr(readInterchange(base.replace('GE*1*1~IEA*1*000100001~', '')));
    expect(error.message).toContain('GE trailer');
  });

  it('rejects an interchange that never reaches its IEA', () => {
    const error = expectErr(readInterchange(base.replace('IEA*1*000100001~', '')));
    expect(error.message).toContain('IEA trailer');
  });
});

describe('reader and writer round trip', () => {
  it.each(WELL_FORMED.map((fixture) => fixture.name))(
    're-emits %s byte for byte from its parsed tree',
    (name) => {
      const raw = readFixture(name);
      const interchange = expectOk(readInterchange(raw));
      const [group] = interchange.groups;
      expect(group).toBeDefined();
      if (group === undefined) return;

      const rebuilt = expectOk(
        writeInterchange({
          sender: {
            qualifier: raw.slice(32, 34),
            id: raw.slice(35, 50).trimEnd(),
            applicationId: group.applicationSender,
          },
          receiver: {
            qualifier: raw.slice(51, 53),
            id: raw.slice(54, 69).trimEnd(),
            applicationId: group.applicationReceiver,
          },
          created: new Date(
            `20${raw.slice(70, 72)}-${raw.slice(72, 74)}-${raw.slice(74, 76)}T${raw.slice(
              77,
              79
            )}:${raw.slice(79, 81)}:00.000Z`
          ),
          usageIndicator: 'T',
          controlNumbers: {
            interchange: Number(interchange.controlNumber),
            group: Number(group.controlNumber),
            transactionStart: Number(group.transactions[0]?.controlNumber ?? '1'),
          },
          delimiters: interchange.delimiters,
          groups: [
            {
              functionalIdentifier: group.functionalIdentifier,
              version: group.version,
              transactions: group.transactions.map((transaction) => ({
                setIdentifier: transaction.setIdentifier,
                implementationConvention: transaction.implementationConvention,
                segments: transaction.segments,
              })),
            },
          ],
        })
      );

      expect(rebuilt).toBe(raw);
    }
  );

  it('re-emits every individual segment exactly as it was read', () => {
    const raw = readFixture('835-stacked-adjustments.edi');
    const rebuilt = readSegments(raw, DEFAULT_DELIMITERS)
      .map((source) => writeSegment(source, DEFAULT_DELIMITERS))
      .join('');
    expect(rebuilt).toBe(raw);
  });
});
