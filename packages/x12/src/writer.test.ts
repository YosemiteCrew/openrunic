import { describe, expect, it } from 'vitest';

import { readInterchange } from './reader.js';
import { segment, simpleAt } from './segments.js';
import type { Segment } from './segments.js';
import { expectErr, expectOk } from './test-support/result.js';
import { writeInterchange } from './writer.js';
import type { InterchangeDraft } from './writer.js';

/**
 * Writer tests.
 *
 * The point of the writer is that the three self-check counts, SE01, GE01 and
 * IEA01, are computed rather than supplied, so no mapper can get them wrong.
 * These tests exist to prove that claim, including in the awkward shapes:
 * several transaction sets in a group, several groups in an interchange.
 */

const CREATED = new Date('2026-03-16T14:05:00.000Z');

function body(count: number): readonly Segment[] {
  return Array.from({ length: count }, (_, index) => segment('REF', 'ZZ', String(index + 1)));
}

function draft(overrides: Partial<InterchangeDraft> = {}): InterchangeDraft {
  return {
    sender: { qualifier: 'ZZ', id: 'SENDERID', applicationId: 'SENDERAPP' },
    receiver: { qualifier: 'ZZ', id: 'RECEIVERID', applicationId: 'RECEIVERAPP' },
    created: CREATED,
    usageIndicator: 'T',
    controlNumbers: { interchange: 5, group: 9, transactionStart: 3 },
    groups: [
      {
        functionalIdentifier: 'HC',
        version: '005010X222A1',
        transactions: [
          { setIdentifier: '837', implementationConvention: '005010X222A1', segments: body(4) },
        ],
      },
    ],
    ...overrides,
  };
}

describe('envelope assembly', () => {
  it('writes a fixed-width ISA of exactly 106 characters', () => {
    const written = expectOk(writeInterchange(draft()));
    const isa = written.split('~')[0] ?? '';
    expect(isa).toHaveLength(105);
    expect(isa.slice(35, 50)).toBe('SENDERID       ');
    expect(isa.slice(54, 69)).toBe('RECEIVERID     ');
    expect(isa.slice(70, 81)).toBe('260316*1405');
    expect(isa.slice(90, 99)).toBe('000000005');
  });

  it('computes SE01 as the body length plus its own ST and SE', () => {
    const written = expectOk(writeInterchange(draft()));
    expect(written).toContain('SE*6*0003~');
  });

  it('numbers transaction sets consecutively from the supplied start', () => {
    const written = expectOk(
      writeInterchange(
        draft({
          groups: [
            {
              functionalIdentifier: 'HC',
              version: '005010X222A1',
              transactions: [
                { setIdentifier: '837', implementationConvention: 'X', segments: body(2) },
                { setIdentifier: '837', implementationConvention: 'X', segments: body(5) },
              ],
            },
          ],
        })
      )
    );
    expect(written).toContain('ST*837*0003*X~');
    expect(written).toContain('SE*4*0003~');
    expect(written).toContain('ST*837*0004*X~');
    expect(written).toContain('SE*7*0004~');
    expect(written).toContain('GE*2*9~');
  });

  it('increments the group control number across groups and counts them in IEA01', () => {
    const group = {
      functionalIdentifier: 'HC',
      version: '005010X222A1',
      transactions: [{ setIdentifier: '837', implementationConvention: 'X', segments: body(1) }],
    };
    const written = expectOk(writeInterchange(draft({ groups: [group, group] })));
    expect(written).toContain('GS*HC*SENDERAPP*RECEIVERAPP*20260316*1405*9*X*005010X222A1~');
    expect(written).toContain('GE*1*9~');
    expect(written).toContain('GE*1*10~');
    expect(written).toContain('IEA*2*000000005~');
  });

  it('produces something its own reader accepts, counts and all', () => {
    const written = expectOk(writeInterchange(draft()));
    const interchange = expectOk(readInterchange(written));
    expect(interchange.groups[0]?.transactions[0]?.segments).toHaveLength(4);
  });

  it('honours partner-specific delimiters end to end', () => {
    const written = expectOk(
      writeInterchange(
        draft({ delimiters: { element: '|', component: '+', repetition: '!', segment: "'" } })
      )
    );
    expect(written.startsWith('ISA|00|')).toBe(true);
    expect(written.endsWith("IEA|1|000000005'")).toBe(true);
    const interchange = expectOk(readInterchange(written));
    expect(simpleAt(interchange.isa, 16)).toBe('+');
  });
});

describe('refusing to write a document a partner would reject', () => {
  it('rejects colliding delimiters', () => {
    const error = expectErr(
      writeInterchange(
        draft({ delimiters: { element: '*', component: '*', repetition: '^', segment: '~' } })
      )
    );
    expect(error.kind).toBe('malformed_envelope');
  });

  it('rejects an interchange with no functional groups', () => {
    const error = expectErr(writeInterchange(draft({ groups: [] })));
    expect(error).toMatchObject({ kind: 'encode_precondition', path: ['groups'] });
  });

  it('rejects a functional group with no transaction sets', () => {
    const error = expectErr(
      writeInterchange(
        draft({
          groups: [{ functionalIdentifier: 'HC', version: 'X', transactions: [] }],
        })
      )
    );
    expect(error).toMatchObject({
      kind: 'encode_precondition',
      path: ['groups', '0', 'transactions'],
    });
  });

  it('rejects an interchange id that will not fit ISA06 or ISA08', () => {
    expect(
      expectErr(
        writeInterchange(draft({ sender: { qualifier: 'ZZ', id: '', applicationId: 'A' } }))
      )
    ).toMatchObject({ path: ['sender', 'id'] });
    expect(
      expectErr(
        writeInterchange(
          draft({ receiver: { qualifier: 'ZZ', id: 'X'.repeat(16), applicationId: 'A' } })
        )
      )
    ).toMatchObject({ path: ['receiver', 'id'] });
  });

  it('rejects an interchange qualifier that is not two characters', () => {
    expect(
      expectErr(
        writeInterchange(draft({ sender: { qualifier: 'Z', id: 'A', applicationId: 'A' } }))
      )
    ).toMatchObject({ path: ['sender', 'qualifier'] });
  });
});
