import { describe, expect, it } from 'vitest';

import {
  FIXTURE_837P_OPTIONS,
  correctedClaim,
  dependentPatientClaim,
  fullProviderLoopsClaim,
  multipleLinesClaim,
  secondaryCoverageClaim,
  singleLineClaim,
  voidedClaim,
} from './__fixtures__/inputs.js';
import { readFixture } from './__fixtures__/index.js';
import { encode837P } from './claim-837p.js';
import type { ClaimEnvelope } from './claim-837p.js';
import { firstTransactionOfType, readInterchange } from './reader.js';
import { componentAt, simpleAt } from './segments.js';
import type { Segment } from './segments.js';
import { expectErr, expectOk } from './test-support/result.js';

/**
 * 837P encoder tests.
 *
 * Every case asserts twice. First byte-exact equality with a golden file,
 * because the payer sees bytes and an object-graph assertion would pass while
 * emitting an unpayable document. Then targeted assertions on the segments
 * that carry the meaning of that particular fixture, because a byte comparison
 * tells you something changed but not whether the change was correct.
 */

const CASES: readonly (readonly [string, () => ClaimEnvelope])[] = [
  ['837p-single-line.edi', singleLineClaim],
  ['837p-multiple-lines.edi', multipleLinesClaim],
  ['837p-dependent-patient.edi', dependentPatientClaim],
  ['837p-secondary-coverage.edi', secondaryCoverageClaim],
  ['837p-corrected-claim.edi', correctedClaim],
  ['837p-voided-claim.edi', voidedClaim],
  ['837p-full-provider-loops.edi', fullProviderLoopsClaim],
];

function segmentsOf(edi: string): readonly Segment[] {
  const interchange = expectOk(readInterchange(edi));
  return expectOk(firstTransactionOfType(interchange, '837')).segments;
}

function first(edi: string, tag: string): Segment {
  const found = segmentsOf(edi).find((source) => source.tag === tag);
  expect(found, `no ${tag} segment in the encoded claim`).toBeDefined();
  return found ?? { tag, elements: [] };
}

function all(edi: string, tag: string): readonly Segment[] {
  return segmentsOf(edi).filter((source) => source.tag === tag);
}

describe('golden files', () => {
  it.each(CASES)('encodes %s byte for byte', (name, build) => {
    expect(expectOk(encode837P(build(), FIXTURE_837P_OPTIONS))).toBe(readFixture(name));
  });

  it.each(CASES)('emits an envelope its own reader reconciles for %s', (_name, build) => {
    const edi = expectOk(encode837P(build(), FIXTURE_837P_OPTIONS));
    const interchange = expectOk(readInterchange(edi));
    expect(interchange.groups[0]?.functionalIdentifier).toBe('HC');
    expect(interchange.groups[0]?.version).toBe('005010X222A1');
  });
});

describe('what each fixture actually exercises', () => {
  it('writes the CLM05 composite as place of service, qualifier B, frequency', () => {
    expect(componentAt(first(readFixture('837p-single-line.edi'), 'CLM'), 5, 1)).toBe('11');
    expect(componentAt(first(readFixture('837p-single-line.edi'), 'CLM'), 5, 2)).toBe('B');
    expect(componentAt(first(readFixture('837p-single-line.edi'), 'CLM'), 5, 3)).toBe('1');
  });

  it('assigns the principal diagnosis qualifier ABK and the rest ABF', () => {
    const hi = first(readFixture('837p-multiple-lines.edi'), 'HI');
    expect(componentAt(hi, 1, 1)).toBe('ABK');
    expect(componentAt(hi, 1, 2)).toBe('M25511');
    expect(componentAt(hi, 2, 1)).toBe('ABF');
    expect(componentAt(hi, 3, 1)).toBe('ABF');
  });

  it('writes one LX and one SV1 per service line, in order', () => {
    const edi = readFixture('837p-multiple-lines.edi');
    expect(all(edi, 'LX').map((source) => simpleAt(source, 1))).toEqual(['1', '2', '3', '4']);
    expect(all(edi, 'SV1').map((source) => componentAt(source, 1, 2))).toEqual([
      '99214',
      '20610',
      '36415',
      '96372',
    ]);
  });

  it('stacks modifiers into the SV101 composite after the procedure code', () => {
    const [, second] = all(readFixture('837p-multiple-lines.edi'), 'SV1');
    expect(second).toBeDefined();
    expect(componentAt(second ?? { tag: 'SV1', elements: [] }, 1, 3)).toBe('RT');
    expect(componentAt(second ?? { tag: 'SV1', elements: [] }, 1, 4)).toBe('59');
  });

  it('writes diagnosis pointers as an SV107 composite', () => {
    const [firstLine] = all(readFixture('837p-multiple-lines.edi'), 'SV1');
    const source = firstLine ?? { tag: 'SV1', elements: [] };
    expect(componentAt(source, 7, 1)).toBe('1');
    expect(componentAt(source, 7, 2)).toBe('2');
    expect(componentAt(source, 7, 3)).toBe('3');
  });

  it('switches DTP*472 to an RD8 range only when the service spans days', () => {
    const dates = all(readFixture('837p-multiple-lines.edi'), 'DTP').filter(
      (source) => simpleAt(source, 1) === '472'
    );
    expect(dates.map((source) => simpleAt(source, 2))).toEqual(['D8', 'D8', 'D8', 'RD8']);
    expect(simpleAt(dates[3] ?? { tag: 'DTP', elements: [] }, 3)).toBe('20260312-20260314');
  });

  it('adds the dependent loop and empties SBR02 when the patient is not the subscriber', () => {
    const edi = readFixture('837p-dependent-patient.edi');
    const levels = all(edi, 'HL').map((source) => simpleAt(source, 3));
    expect(levels).toEqual(['20', '22', '23']);
    expect(simpleAt(all(edi, 'HL')[1] ?? { tag: 'HL', elements: [] }, 4)).toBe('1');
    expect(simpleAt(first(edi, 'SBR'), 2)).toBe('');
    expect(simpleAt(first(edi, 'PAT'), 1)).toBe('19');
    expect(simpleAt(first(edi, 'NM1'), 1)).toBe('41');
  });

  it('keeps the subscriber HL child code at zero when the subscriber is the patient', () => {
    const edi = readFixture('837p-single-line.edi');
    expect(simpleAt(all(edi, 'HL')[1] ?? { tag: 'HL', elements: [] }, 4)).toBe('0');
    expect(simpleAt(first(edi, 'SBR'), 2)).toBe('18');
  });

  it('writes the coordination-of-benefits loops for a secondary claim', () => {
    const edi = readFixture('837p-secondary-coverage.edi');
    const [primary, other] = all(edi, 'SBR');
    expect(simpleAt(primary ?? { tag: 'SBR', elements: [] }, 1)).toBe('S');
    expect(simpleAt(other ?? { tag: 'SBR', elements: [] }, 1)).toBe('P');

    const amounts = all(edi, 'AMT');
    expect(amounts.map((source) => [simpleAt(source, 1), simpleAt(source, 2)])).toEqual([
      ['D', '92.4'],
      ['B6', '115.5'],
    ]);

    const oi = first(edi, 'OI');
    expect(simpleAt(oi, 3)).toBe('Y');
    expect(simpleAt(oi, 6)).toBe('Y');

    const svd = first(edi, 'SVD');
    expect(simpleAt(svd, 1)).toBe('NWMH1');
    expect(simpleAt(svd, 2)).toBe('92.4');
    expect(componentAt(svd, 3, 2)).toBe('99213');
  });

  it('writes claim-level and line-level CAS for the prior payer', () => {
    const cas = all(readFixture('837p-secondary-coverage.edi'), 'CAS');
    expect(cas).toHaveLength(4);
    expect(cas.map((source) => `${simpleAt(source, 1)}-${simpleAt(source, 2)}`)).toEqual([
      'CO-45',
      'PR-2',
      'CO-45',
      'PR-2',
    ]);
  });

  it('writes frequency 7 with the payer control number it replaces', () => {
    const edi = readFixture('837p-corrected-claim.edi');
    expect(componentAt(first(edi, 'CLM'), 5, 3)).toBe('7');
    const f8 = all(edi, 'REF').find((source) => simpleAt(source, 1) === 'F8');
    expect(simpleAt(f8 ?? { tag: 'REF', elements: [] }, 2)).toBe('NWMH20260318004417');
  });

  it('writes frequency 8 for a void', () => {
    expect(componentAt(first(readFixture('837p-voided-claim.edi'), 'CLM'), 5, 3)).toBe('8');
  });

  it('writes the provider loops in the order 5010 requires', () => {
    const entities = all(readFixture('837p-full-provider-loops.edi'), 'NM1').map((source) =>
      simpleAt(source, 1)
    );
    expect(entities).toEqual(['41', '40', '85', 'IL', 'PR', '82', '77', 'DQ']);
  });

  it('omits the facility identifier elements when a facility has no NPI', () => {
    const claim = fullProviderLoopsClaim();
    const edi = expectOk(
      encode837P(
        {
          ...claim,
          serviceFacility: {
            name: 'CEDAR HOLLOW CLINIC NORTH',
            address: {
              line1: '77 MILLPOND ROAD',
              city: 'GRANITE FALLS',
              state: 'VT',
              postalCode: '056010440',
            },
          },
        },
        FIXTURE_837P_OPTIONS
      )
    );
    expect(edi).toContain('NM1*77*2*CEDAR HOLLOW CLINIC NORTH~');
  });

  it('writes the submitter email contact only when one is supplied', () => {
    const claim = singleLineClaim();
    const withEmail = expectOk(
      encode837P(
        { ...claim, submitter: { ...claim.submitter, contactEmail: 'billing@example.invalid' } },
        FIXTURE_837P_OPTIONS
      )
    );
    expect(withEmail).toContain(
      'PER*IC*ROSALIND FENWORTH*TE*5085550137*EM*billing@example.invalid~'
    );
  });

  it('writes an optional second address line and country code', () => {
    const claim = singleLineClaim();
    const edi = expectOk(
      encode837P(
        {
          ...claim,
          billingProvider: {
            ...claim.billingProvider,
            taxonomyCode: undefined,
            address: {
              line1: '412 LANTERN WAY',
              line2: 'FLOOR 2',
              city: 'WESTFORD MILLS',
              state: 'VT',
              postalCode: '054520114',
              countryCode: 'US',
            },
          },
        },
        FIXTURE_837P_OPTIONS
      )
    );
    expect(edi).toContain('N3*412 LANTERN WAY*FLOOR 2~');
    expect(edi).toContain('N4*WESTFORD MILLS*VT*054520114*US~');
    expect(edi).not.toContain('PRV*BI*');
  });

  it('omits the rendering provider taxonomy when none is known', () => {
    const claim = singleLineClaim();
    const edi = expectOk(
      encode837P(
        {
          ...claim,
          renderingProvider: { name: { family: 'QUINTERO', given: 'MARISOL' }, npi: '1801234561' },
        },
        FIXTURE_837P_OPTIONS
      )
    );
    expect(edi).not.toContain('PRV*PE*');
  });

  it('writes an adjustment quantity when the prior payer supplied one', () => {
    const claim = secondaryCoverageClaim();
    const [coverage] = claim.otherCoverage ?? [];
    expect(coverage).toBeDefined();
    if (coverage === undefined) return;
    const edi = expectOk(
      encode837P(
        {
          ...claim,
          otherCoverage: [
            {
              ...coverage,
              allowedCents: undefined,
              adjudicationDate: undefined,
              adjustments: [
                {
                  groupCode: 'CO',
                  details: [{ reasonCode: '45', amountCents: 3_250, quantity: 2 }],
                },
              ],
            },
          ],
        },
        FIXTURE_837P_OPTIONS
      )
    );
    expect(edi).toContain('CAS*CO*45*32.5*2~');
    expect(edi).not.toContain('AMT*B6*');
  });
});

describe('refusing to encode an unpayable claim', () => {
  const base = singleLineClaim();

  function reject(overrides: Partial<ClaimEnvelope>): ReturnType<typeof expectErr> {
    return expectErr(encode837P({ ...base, ...overrides }, FIXTURE_837P_OPTIONS));
  }

  it('rejects a claim with no service lines', () => {
    expect(reject({ lines: [] })).toMatchObject({ kind: 'encode_precondition', path: ['lines'] });
  });

  it('rejects a claim with no diagnosis', () => {
    expect(reject({ claim: { ...base.claim, diagnosisCodes: [] } })).toMatchObject({
      path: ['claim', 'diagnosisCodes'],
    });
  });

  it('rejects more than the twelve diagnoses an 837P can carry', () => {
    expect(
      reject({
        claim: { ...base.claim, diagnosisCodes: Array.from({ length: 13 }, (_, i) => `Z${i}`) },
      })
    ).toMatchObject({ path: ['claim', 'diagnosisCodes'] });
  });

  it('rejects a replacement or void that does not name the claim it acts on', () => {
    expect(reject({ claim: { ...base.claim, frequency: 'REPLACEMENT' } })).toMatchObject({
      path: ['claim', 'priorPayerClaimControlNumber'],
    });
    expect(reject({ claim: { ...base.claim, frequency: 'VOID' } })).toMatchObject({
      path: ['claim', 'priorPayerClaimControlNumber'],
    });
  });

  it('rejects a self-insured patient that also arrives as a dependent', () => {
    expect(
      reject({
        patient: { name: { family: 'A', given: 'B' }, birthDate: '2016-07-02', gender: 'M' },
      })
    ).toMatchObject({ path: ['patient'] });
  });

  it('rejects a non-self subscriber with no dependent loop to put the patient in', () => {
    expect(reject({ subscriber: { ...base.subscriber, relationship: 'child' } })).toMatchObject({
      path: ['patient'],
    });
  });

  it('rejects a self-insured subscriber missing the demographics the payer needs', () => {
    expect(reject({ subscriber: { ...base.subscriber, birthDate: undefined } })).toMatchObject({
      path: ['subscriber', 'birthDate'],
    });
    expect(reject({ subscriber: { ...base.subscriber, gender: undefined } })).toMatchObject({
      path: ['subscriber', 'birthDate'],
    });
  });

  it('rejects an NPI that is not ten digits', () => {
    expect(reject({ billingProvider: { ...base.billingProvider, npi: '19028746' } })).toMatchObject(
      {
        path: ['billingProvider', 'npi'],
      }
    );
    expect(
      reject({
        renderingProvider: { name: { family: 'Q', given: 'M' }, npi: 'ABCDEFGHIJ' },
      })
    ).toMatchObject({ path: ['renderingProvider', 'npi'] });
  });

  it('rejects service lines that are not numbered one-based and contiguous', () => {
    const [line] = base.lines;
    expect(line).toBeDefined();
    if (line === undefined) return;
    expect(reject({ lines: [{ ...line, sequence: 2 }] })).toMatchObject({
      path: ['lines', '0', 'sequence'],
    });
  });

  it('rejects more than four modifiers on a line', () => {
    const [line] = base.lines;
    if (line === undefined) return;
    expect(
      reject({ lines: [{ ...line, modifiers: ['25', '59', 'RT', 'LT', 'GA'] }] })
    ).toMatchObject({ path: ['lines', '0', 'modifiers'] });
  });

  it('rejects a line with no diagnosis pointers, or more than four', () => {
    const [line] = base.lines;
    if (line === undefined) return;
    expect(reject({ lines: [{ ...line, diagnosisPointers: [] }] })).toMatchObject({
      path: ['lines', '0', 'diagnosisPointers'],
    });
    expect(
      reject({
        claim: { ...base.claim, diagnosisCodes: ['A', 'B', 'C', 'D', 'E'] },
        lines: [{ ...line, diagnosisPointers: [1, 2, 3, 4, 5] }],
      })
    ).toMatchObject({ path: ['lines', '0', 'diagnosisPointers'] });
  });

  it('rejects a diagnosis pointer that points at nothing', () => {
    const [line] = base.lines;
    if (line === undefined) return;
    expect(reject({ lines: [{ ...line, diagnosisPointers: [4] }] })).toMatchObject({
      path: ['lines', '0', 'diagnosisPointers'],
    });
    expect(reject({ lines: [{ ...line, diagnosisPointers: [0] }] })).toMatchObject({
      path: ['lines', '0', 'diagnosisPointers'],
    });
  });

  it('rejects a line with no units', () => {
    const [line] = base.lines;
    if (line === undefined) return;
    expect(reject({ lines: [{ ...line, units: 0 }] })).toMatchObject({
      path: ['lines', '0', 'units'],
    });
  });

  it('rejects a claim total that does not equal the sum of its lines', () => {
    const error = reject({ claim: { ...base.claim, totalChargeCents: 19_900 } });
    expect(error).toMatchObject({ path: ['claim', 'totalChargeCents'] });
    expect(error.message).toContain('19900');
    expect(error.message).toContain('14800');
  });

  it('surfaces an envelope precondition from the writer unchanged', () => {
    expect(
      expectErr(
        encode837P(base, {
          ...FIXTURE_837P_OPTIONS,
          sender: { qualifier: 'ZZ', id: 'THIS-ID-IS-FAR-TOO-LONG', applicationId: 'X' },
        })
      )
    ).toMatchObject({ path: ['sender', 'id'] });
  });
});
