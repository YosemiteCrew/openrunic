import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The golden-file corpus.
 *
 * Every encoder in this package is tested by byte-exact comparison against a
 * file in this directory, and every decoder is tested by decoding one and
 * asserting what came out. That is a deliberate choice over asserting on
 * in-memory structures: X12 is a wire format, the payer sees bytes, and a test
 * that only checks the object graph will happily pass while emitting a
 * document no clearinghouse will accept.
 *
 * Two provenances live here, and the distinction matters when reading a
 * failure:
 *
 *   * ENCODE goldens (`kind: 'encode'`) were produced by this package's own
 *     encoders from the inputs in `inputs.ts` and then reviewed segment by
 *     segment against the 5010 implementation guides. They are frozen. There
 *     is deliberately no automatic regeneration switch: a golden that can be
 *     rewritten by rerunning the tests stops being evidence, and blindly
 *     regenerating after breaking an encoder is precisely the failure these
 *     files exist to catch. To change one on purpose, encode the fixture by
 *     hand, diff the result, satisfy yourself the diff is correct, and commit
 *     the new bytes with the reasoning.
 *   * DECODE fixtures (`kind: 'decode'`) were authored to model what a payer
 *     actually sends, then wrapped in a valid envelope. They are inputs, so
 *     they are edited by hand when a new payer behaviour needs covering.
 *   * MALFORMED fixtures (`kind: 'malformed'`) are valid documents that were
 *     then broken in one specific way, so a reader test can prove which error
 *     it produces.
 *
 * All content is synthetic. Every identity is invented, and every document
 * carries `T` in ISA15, so a fixture that escaped into a real transport would
 * be rejected as a test file rather than adjudicated.
 */

/** What a fixture is for, which decides how it may be changed. */
export type FixtureKind = 'encode' | 'decode' | 'malformed';

/** One corpus entry and the behaviour it exists to pin down. */
export interface FixtureDescriptor {
  readonly name: string;
  readonly kind: FixtureKind;
  /** The transaction set, or `mixed` for the envelope-level malformed cases. */
  readonly transactionSet: '837' | '835' | '277' | '999' | '270' | '271';
  /** What this fixture exercises that no other fixture does. */
  readonly exercises: string;
}

/** The whole corpus, in the order a reader should meet it. */
export const FIXTURES: readonly FixtureDescriptor[] = [
  {
    name: '837p-single-line.edi',
    kind: 'encode',
    transactionSet: '837',
    exercises:
      'The baseline professional claim: a self-insured subscriber, one diagnosis, one service line. Every other 837P fixture is a variation of this one, so a diff against it isolates exactly what a feature changed.',
  },
  {
    name: '837p-multiple-lines.edi',
    kind: 'encode',
    transactionSet: '837',
    exercises:
      'Four service lines with modifiers, a three-unit line, a multi-day RD8 service range, three diagnoses and multi-pointer justification. Pins LX/SV1/DTP repetition and the SV107 pointer composite.',
  },
  {
    name: '837p-dependent-patient.edi',
    kind: 'encode',
    transactionSet: '837',
    exercises:
      "The patient is the subscriber's child, so the 2000C dependent loop exists, PAT carries the relationship, SBR02 goes empty and the subscriber HL child code flips to 1. The one case where the relationship changes the document shape rather than a code.",
  },
  {
    name: '837p-secondary-coverage.edi',
    kind: 'encode',
    transactionSet: '837',
    exercises:
      "Coordination of benefits: SBR*S, the 2320 other-subscriber loop with the primary payer's stacked CAS adjustments, AMT*D and AMT*B6, OI, the 2330B other payer, and 2430 SVD line adjudication. The most structurally complex claim the encoder emits.",
  },
  {
    name: '837p-corrected-claim.edi',
    kind: 'encode',
    transactionSet: '837',
    exercises:
      'A replacement claim: CLM05-3 frequency 7 plus the REF*F8 payer control number of the claim it supersedes. The encoder refuses to emit this without the F8.',
  },
  {
    name: '837p-voided-claim.edi',
    kind: 'encode',
    transactionSet: '837',
    exercises:
      'A void: CLM05-3 frequency 8. Separate from the replacement fixture because payers treat 7 and 8 as different transactions, not two flavours of one.',
  },
  {
    name: '837p-full-provider-loops.edi',
    kind: 'encode',
    transactionSet: '837',
    exercises:
      'Every optional provider loop at once: rendering (2310B), service facility with a two-line address (2310C) and supervising (2310D), in the order 5010 requires.',
  },
  {
    name: '270-coverage-inquiry.edi',
    kind: 'encode',
    transactionSet: '270',
    exercises:
      'A subscriber-level eligibility inquiry: the three-level HL chain, TRN reassociation, DMG disambiguation, a service date and a service-type EQ.',
  },
  {
    name: '270-dependent-inquiry.edi',
    kind: 'encode',
    transactionSet: '270',
    exercises:
      'The same inquiry asked about a dependent: a fourth HL level, the INS relationship, and two service-type EQ segments rather than one.',
  },
  {
    name: '835-full-payment.edi',
    kind: 'decode',
    transactionSet: '835',
    exercises:
      'A clean primary payment over two service lines, each with a contractual write-off and one with patient coinsurance. The happy path every other 835 fixture deviates from.',
  },
  {
    name: '835-partial-payment.edi',
    kind: 'decode',
    transactionSet: '835',
    exercises:
      'The payer pays less than allowed and splits the shortfall across a deductible and coinsurance carried in ONE stacked CAS segment. Reading only the first triplet here loses the coinsurance and under-bills the patient.',
  },
  {
    name: '835-denial.edi',
    kind: 'decode',
    transactionSet: '835',
    exercises:
      'An outright denial: CLP02 status 4, nothing paid, a claim-level CAS as well as a line-level one, and two LQ*HE remark codes explaining the CARC.',
  },
  {
    name: '835-reversal.edi',
    kind: 'decode',
    transactionSet: '835',
    exercises:
      'A reversal of a previously paid claim (CLP02 status 22) with negative charge, paid, responsibility and adjustment amounts, followed by the corrected replacement, plus PLB provider-level recoupment and interest. Proves signed money survives end to end.',
  },
  {
    name: '835-stacked-adjustments.edi',
    kind: 'decode',
    transactionSet: '835',
    exercises:
      'Three claims in one advice, one carrying the maximum six adjustment triplets a single CAS segment can hold, and one claim-level-only denial with no SVC loops at all.',
  },
  {
    name: '835-secondary-payer.edi',
    kind: 'decode',
    transactionSet: '835',
    exercises:
      "The secondary payer's advice after the primary already paid: a check rather than an EFT, CLP02 status 2, and the remaining balance arriving as an OA-23 prior-payer adjustment.",
  },
  {
    name: '277-accepted.edi',
    kind: 'decode',
    transactionSet: '277',
    exercises:
      'The payer accepted the claim into adjudication: the full four-level HL chain, batch-level statuses above the claim, an A2 category at the patient level, and the payer control number in REF*1K.',
  },
  {
    name: '277-rejected.edi',
    kind: 'decode',
    transactionSet: '277',
    exercises:
      'A front-end rejection before the payer saw the claim: an A3 batch status and an A7 claim status with an entity code and free-text explanation. Drives the claim to rejected with something a biller can act on.',
  },
  {
    name: '999-accepted.edi',
    kind: 'decode',
    transactionSet: '999',
    exercises:
      'The whole functional group passed syntax validation: IK5*A and AK9*A, no error detail.',
  },
  {
    name: '999-rejected.edi',
    kind: 'decode',
    transactionSet: '999',
    exercises:
      'Syntax rejection with the detail that makes it fixable: two IK3 segment errors, an IK4 element error inside a composite, IK5*R and a group-level AK9*R.',
  },
  {
    name: '271-active-coverage.edi',
    kind: 'decode',
    transactionSet: '271',
    exercises:
      'Active coverage with a benefit stack: a repeating EB03 service-type list, an annual deductible, its remaining balance, a copay flagged in network and a coinsurance percentage, plus an explanatory MSG.',
  },
  {
    name: '271-inactive-coverage.edi',
    kind: 'decode',
    transactionSet: '271',
    exercises:
      'Terminated coverage: EB01 code 6, a termination date, a free-text reason and an AAA rejection. The case a front desk must not confuse with an unanswerable request.',
  },
  {
    name: 'malformed-truncated-isa.edi',
    kind: 'malformed',
    transactionSet: '837',
    exercises: 'The ISA header stops at 60 characters, so the delimiters cannot be read at all.',
  },
  {
    name: 'malformed-se-count.edi',
    kind: 'malformed',
    transactionSet: '837',
    exercises: 'SE01 declares 99 segments in a transaction set that contains 29.',
  },
  {
    name: 'malformed-control-mismatch.edi',
    kind: 'malformed',
    transactionSet: '837',
    exercises: 'IEA02 does not echo ISA13, the signature of two interchanges spliced by transport.',
  },
];

const directory = fileURLToPath(new URL('.', import.meta.url));

/** Reads one fixture verbatim. No trimming: byte-exact means byte-exact. */
export function readFixture(name: string): string {
  return readFileSync(`${directory}${name}`, 'utf8');
}

/** The corpus filtered to one provenance, for tests that sweep a whole class. */
export function fixturesOfKind(kind: FixtureKind): readonly FixtureDescriptor[] {
  return FIXTURES.filter((fixture) => fixture.kind === kind);
}
