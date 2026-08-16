# `@openrunic/x12`

The claim codec. A pure, IO-free ASC X12 5010 encoder and decoder for the transactions a practice actually exchanges
with a payer.

| Transaction | Direction | Entry point                     |
| ----------- | --------- | ------------------------------- |
| 837P        | encode    | `encode837P(envelope, options)` |
| 835         | decode    | `decode835(raw)`                |
| 277         | decode    | `decode277(raw)`                |
| 999         | decode    | `decode999(raw)`                |
| 270         | encode    | `encode270(request, options)`   |
| 271         | decode    | `decode271(raw)`                |
| 278         | encode    | `encode278(request, options)`   |
| 278         | decode    | `decode278(segments)`           |

It reads and writes strings. It opens no sockets, touches no database and reads no clock, so every
behaviour in it is reproducible from a golden file. Transport belongs to the clearinghouse adapter;
persistence belongs to the billing service.

## Why the package is split in two

The riskiest thing about an EDI codec is not the mapping, it is that envelope bugs and mapping bugs
look identical from the outside. A claim that bounces at the clearinghouse gives you one error
string and no way to tell whether the problem was a wrong diagnosis pointer or a segment count that
was off by one. So the package is deliberately two layers with a hard boundary:

- **The envelope layer** (`delimiters`, `segments`, `reader`, `writer`, `control`) owns ISA/GS/ST
  framing, delimiter detection, control numbers and the three self-check counts. It knows nothing
  about claims.
- **The transaction mappers** (`claim-837p`, `remittance-835`, `status-277`, `ack-999`,
  `eligibility-270`, `eligibility-271`) own meaning. They are only ever handed the segments strictly
  between an ST and its SE, with counts and control numbers already reconciled, and they never write
  an envelope.

The consequence is the point: a mapping bug can produce a wrong claim, but it cannot produce a
malformed envelope, and an envelope bug cannot corrupt mapping logic.

## Control numbers and counts

SE01, GE01 and IEA01 are the standard's own checksums, and they are handled in exactly one place
each.

- **On encode**, the writer computes all three from what was actually emitted. No mapper counts
  anything, so no mapper can miscount. Control numbers are supplied by the caller rather than
  generated here, because encoding must stay a pure function and because the billing service owns
  the durable sequence.
- **On decode**, `readInterchange` reconciles all three plus the three control-number echoes
  (IEA02/ISA13, GE02/GS06, SE02/ST02) before any mapper runs. A document whose self-checks disagree
  with its contents has been truncated, concatenated or re-wrapped somewhere in transport, and it is
  refused rather than partially mapped. Half a posted remittance is worse than none.

## Errors are a typed union, not strings

Every fallible entry point returns `Result<T, X12Error>` from `@openrunic/types`. `X12Error` is a
discriminated union over ten kinds, each carrying the values that were compared, so a caller can
branch on the failure and a human can read it. `formatX12Error` renders one line, used identically
by logs, by a claim's `statusReason` and by the screen.

The kinds are `empty_input`, `malformed_envelope`, `unexpected_segment`, `missing_segment`,
`missing_element`, `invalid_element`, `control_mismatch`, `count_mismatch`,
`unsupported_transaction` and `encode_precondition`.

## The encoder refuses unpayable claims

`encode837P` will not emit a document it can tell a payer would reject. Each check corresponds to a
real payer edit, so failing here turns a three-week feedback loop into an actionable error on the
fee sheet:

- at least one service line, and at least one but no more than twelve diagnosis codes;
- service line sequences one-based and contiguous;
- every diagnosis pointer references a diagnosis that exists, at most four per line;
- at most four modifiers per line, and a positive unit count;
- NPIs are ten digits;
- a replacement or void claim names the payer control number of the claim it acts on;
- a self-insured patient is not also sent as a dependent, and a non-self subscriber has one;
- **the claim total equals the sum of its lines.**

## Money and dates

Money is integer cents everywhere in this system, because floating-point dollars in a ledger is a
defect waiting for an audit. The conversion to and from X12's decimal dollars happens in
`format.ts`, once, in both directions. Amounts keep their sign: 835 reversals and PLB recoupments are
genuinely negative, and stripping the sign there would reverse the direction of money. Reading an
amount rounds half away from zero rather than truncating, because truncation loses half a cent per
line, forever.

Dates are formatted and parsed in UTC and surfaced as `YYYY-MM-DD` strings rather than `Date`
objects. A service date is a calendar date, not an instant; formatting it in the server's local zone
is how a claim for a Monday appointment reaches the payer dated Sunday.

## The golden-file corpus

`src/__fixtures__/` holds 24 documents. Every encoder is tested by byte-exact comparison against
one, and every decoder by decoding one and asserting what came out. That is deliberate over
asserting on in-memory structures: X12 is a wire format, the payer sees bytes, and an object-graph
assertion will happily pass while emitting a document no clearinghouse will accept. Every fixture is
also read back through `readInterchange` and re-emitted through `writeInterchange`, and must match
byte for byte.

`src/__fixtures__/index.ts` documents each fixture and what it exercises that no other one does. The
awkward cases are the point of the corpus: multiple service lines, a dependent patient, secondary
coverage with prior-payer adjudication, corrections and voids, a stacked CAS carrying all six
triplets, a denial, a partial payment split across deductible and coinsurance, a reversal with
negative money and provider-level recoupment, and a claim-level-only remittance with no service
lines at all.

There is deliberately **no automatic regeneration switch**. A golden that can be rewritten by
rerunning the tests stops being evidence, and blindly regenerating after breaking an encoder is
precisely the failure these files exist to catch. To change one on purpose: encode the fixture,
diff the bytes, satisfy yourself the diff is correct, and commit the new bytes with the reasoning.

All fixture content is synthetic, every identity is invented, and every document carries `T` in
ISA15 so a fixture that escaped into a transport would be rejected as a test file rather than
adjudicated.

## Projections into the database's shapes

Two decoders ship a lossy projection alongside the full structure, and the seam is explicit:

- `toRemittanceLines(remittance)` flattens an 835 into `RemittanceLine`-shaped rows. That row is
  deliberately flat, with a single headline adjustment group and reason, because that shape is what
  keeps the accounts-receivable queue a single indexed scan. It is not the system of record for
  adjudication detail: the full decoded structure is what belongs in `Remittance.parsed`. The
  headline adjustment is the one with the largest absolute amount, ties broken by document order,
  because that is what a biller wants to see first when triaging.
- `toClaimStatusOutcomes` and `toAckOutcomes` reduce a 277 and a 999 to the accept-or-reject
  decision the claim lifecycle acts on, with the reason attached when the answer is no.

`toCoverageSummary` does the same for a 271, reducing a benefit stack to the four facts a check-in
screen shows. It keeps an AAA rejection separate from an inactive-coverage answer: "we cannot find
this member" and "this member is not covered" look similar on a screen and are completely different
facts.

## What this package does not do

- No code-list validation. CARC, RARC, CPT, ICD-10 and taxonomy codes are passed through as
  strings. Those lists are licensed content and belong to the deployer's terminology service.
- No transport, retry or scheduling.
- No persistence, and no dependency on `@openrunic/database`.
- No batching. One claim per interchange, because batching makes a single malformed claim reject
  the whole batch at the clearinghouse and the tracing cost outweighs the transport saving.

## Development

```bash
pnpm --filter @openrunic/x12 lint
pnpm --filter @openrunic/x12 type-check
pnpm --filter @openrunic/x12 test
pnpm --filter @openrunic/x12 build
```
