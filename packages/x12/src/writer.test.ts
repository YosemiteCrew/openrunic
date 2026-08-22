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

/**
 * DELIMITER INJECTION.
 *
 * X12 has no escape mechanism, so a separator inside an element IS a separator.
 * A member id of `A*B` does not produce an element containing an asterisk - it
 * produces two, and every element after it shifts left. On an 837P that moves
 * NM109 into NM108's position and the claim goes out for whatever identifier
 * lands there; a `~` invents a whole segment. The values reaching the mappers
 * are demographics, member ids, claim references and service codes, all of which
 * a low-privileged user can influence.
 *
 * The only two honest answers are refuse or mangle. A claim that cannot be
 * encoded is a work item; a claim encoded for somebody else's member id is a
 * payment.
 */
describe('an element carrying a delimiter', () => {
  const withBody = (body: readonly Segment[]): InterchangeDraft =>
    draft({
      groups: [
        {
          functionalIdentifier: 'HC',
          version: '005010X222A1',
          transactions: [
            { setIdentifier: '837', implementationConvention: '005010X222A1', segments: body },
          ],
        },
      ],
    });

  it('refuses an element separator, which would shift every element after it', () => {
    const error = expectErr(writeInterchange(withBody([segment('NM1', 'IL', '1', 'MEMBER*ID')])));

    expect(error.kind).toBe('invalid_element');
    expect(error.message).toContain('element delimiter');
  });

  it('refuses a segment terminator, which would invent a segment', () => {
    const error = expectErr(writeInterchange(withBody([segment('NM1', 'IL', '1', 'SMITH~REF')])));

    expect(error.kind).toBe('invalid_element');
    expect(error.message).toContain('segment delimiter');
  });

  it('refuses a component separator inside a simple element', () => {
    const error = expectErr(writeInterchange(withBody([segment('REF', 'BB', 'AUTH:FORGED')])));

    expect(error.kind).toBe('invalid_element');
    expect(error.message).toContain('component delimiter');
  });

  it('checks inside a composite as well as beside it', () => {
    const error = expectErr(
      writeInterchange(withBody([segment('HI', ['ABK', 'K92.2~SE*99*0001'])]))
    );

    expect(error.kind).toBe('invalid_element');
    expect(error.kind === 'invalid_element' ? error.at.elementPosition : undefined).toBe(1);
  });

  it('refuses a tag that is not a tag', () => {
    const error = expectErr(writeInterchange(withBody([segment('RE*F', 'ZZ', '1')])));

    expect(error.kind).toBe('invalid_element');
    expect(error.message).toContain('segment tag');
  });

  it('names the location, so the refusal is a work item rather than a mystery', () => {
    const error = expectErr(
      writeInterchange(
        withBody([segment('REF', 'ZZ', 'fine'), segment('NM1', 'IL', '1', 'MEMBER*ID')])
      )
    );

    // Narrowed rather than optional-chained: the union has variants with no
    // location at all, and `?.` would let this pass against one of them.
    expect(error.kind).toBe('invalid_element');
    const at = error.kind === 'invalid_element' ? error.at : undefined;
    expect(at?.segmentTag).toBe('NM1');
    // NM103: the tag is not an element, so the third value after it is 3.
    expect(at?.elementPosition).toBe(3);
  });

  /**
   * The repetition separator is deliberately allowed. This codec never splits on
   * it - a repeating element arrives as one string and is re-emitted as one - so
   * it shifts nothing here, and real payer documents use it: EB03 on a 271
   * carries repeated service type codes exactly that way. Refusing it would
   * reject legal traffic while protecting nothing.
   */
  it('allows the repetition separator, which this codec never splits on', () => {
    const written = expectOk(writeInterchange(withBody([segment('EB', '1', '', 'AL^30^35')])));

    expect(written).toContain('EB*1**AL^30^35~');
  });

  /**
   * ISA is the segment that DECLARES the delimiters: ISA11 is the repetition
   * separator and ISA16 the component separator, both carried as literal data.
   * Checking it would refuse every interchange this package writes.
   */
  it('still writes an ISA whose own elements are delimiters', () => {
    const written = expectOk(writeInterchange(withBody([segment('REF', 'ZZ', '1')])));

    expect(written.startsWith('ISA*00*')).toBe(true);
    expect(written).toContain('*:~');
  });

  it('refuses nothing when the document is clean', () => {
    expect(expectOk(writeInterchange(withBody(body(3))))).toContain('REF*ZZ*1~');
  });
});
