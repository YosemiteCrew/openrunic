# @openrunic/adapters

Versioned partner-adapter contracts, deterministic in-process mocks, and the capability registry
that resolves adapters and records every call.

An EMR only does its job by talking to other people's systems: a clearinghouse, an eRx network, a
laboratory, a card processor, a fax vendor, a carrier, a telehealth service, an address verifier.
This package is the boundary those conversations happen across.

## The seam philosophy

Product code compiles against a contract, never against a vendor.

Billing calls `submitClaim` on the clearinghouse contract. It does not know, and must not be able to
discover, which company answers. Nothing in `packages/adapters` names a real vendor, and nothing that
imports it should either. That is what makes a vendor swap an installation change rather than a
refactor: install a different package implementing the same seam major version, register it, and the
code that submits claims does not change by a character.

Eight seams are defined, each a separate contract file:

| Capability       | What crosses the boundary                                            |
| ---------------- | -------------------------------------------------------------------- |
| `erx`            | A completed prescription, and the network's answer about delivery    |
| `clearinghouse`  | Opaque X12 envelopes out and back; we build and parse them ourselves |
| `labs`           | An order, and structured observations back                           |
| `payments`       | Authorise, capture, refund, store a card by reference, build a plan  |
| `fax`            | A document reference out, an inbound tray back                       |
| `sms`            | A message out, replies and opt-outs back                             |
| `video`          | A room per visit, a token per participant                            |
| `address-verify` | An address in, a verdict and a normalised candidate out              |

Each contract exports its version, its config schema, a zod schema for the input and the output of
every operation, and a typed adapter interface. They are also available as data through `CONTRACTS`,
which is what lets the registry police eight seams with one generic wrapper.

### Version compatibility

A seam version is a compatibility promise between two packages, so it is a bare `major.minor.patch`
and nothing else. Pre-release and build metadata are refused, because `1.0.0-rc.1` promises nothing.

Only the major has to match. A higher minor means the vendor implements operations we do not call
yet; a lower minor means it implements every operation we do call, because within a major a minor may
only add. A different major means a shape we call has changed, and no amount of runtime care makes
that safe. The registry refuses an incompatible adapter at registration, which is the only door in,
so nothing incompatible can ever be resolved.

## Adapters never persist

Adapters do not import `@openrunic/database`, and no contract type references a row shape. An adapter
returns a typed result and the owning service does every write. Billing owns the claim ledger, orders
owns the result inbox, comms owns the message log.

This is not a layering preference. If an adapter could write, then swapping a vendor would swap the
code that decides what a payment means, and two vendors would slowly grow two different definitions
of "posted".

Expected failure is a value, not an exception. Every operation returns `Result<T, AdapterError>`, and
`AdapterError` is a closed union, so a caller that forgets a failure mode fails to compile rather than
failing in production.

```ts
const result = await clearinghouse.submitClaim({ edi837p, meta });
if (!result.ok) {
  switch (result.error.kind) {
    case 'timeout':
      return queueRetry(result.error.retryable);
    case 'partial':
      return postAccepted(result.error.outcomes);
    default:
      return raiseException(describeAdapterError(result.error));
  }
}
await recordSubmission(result.value.submissionRef);
```

Money is always integer minor units, identifiers are always opaque strings, and a decline is an output
status rather than an error, because the call succeeded and the front desk needs the decline code to
decide what to ask for next.

## Config by zod, secrets by reference

Every seam exports a zod schema for its own configuration, extending a shared base of `vendorId`,
`environment`, `credentialRef`, `callbackSecretRef`, `timeoutMs` and `baseUrl`.

`credentialRef` and `callbackSecretRef` are references, not secrets. The value they point at lives in
the environment or a secret store and is resolved through `AdapterDeps.resolveSecret` at `init`, which
means:

- the config object is safe to store in a plugin installation row, render in an admin screen, and
  include in a support bundle;
- an installation with a missing secret fails at start-up, where an operator is watching, rather than
  at the first prescription of the day.

Secrets never go in the database. A config that tried to inline one would fail its own schema, because
the schemas are strict objects and there is no field to put it in.

```ts
const adapter = new MockErxAdapter();
const started = await adapter.init(
  {
    vendorId: 'mock-vendor',
    environment: 'sandbox',
    credentialRef: 'secret://partner-credential',
    callbackSecretRef: 'secret://callback-signing',
    timeoutMs: 15_000,
    networkAccountId: 'net-acct-4471',
    epcs: true,
  },
  deps
);
```

Inbound callbacks are verified before anything reads the body. `verifyCallback` is synchronous and
returns a `Result`, so a route handler can reject an unsigned request without an await and without a
try block. It checks the signature first and parses second, because the parser is the part an
unauthenticated caller would otherwise get to run.

## Mocks: deterministic, stateful, and made to fail

Every seam ships an in-process mock. They are the development default, the demo default and the CI
workhorse.

**Deterministic.** Same seed, same call sequence, byte-identical output. The generator is a mulberry32
written out in `src/mocks/random.ts` rather than depended on, and no mock reads the system clock: the
default clock starts at a fixed epoch and advances one second per read, and an injected clock replaces
it entirely.

**Stateful enough to demo.** A submitted claim appears in the next acknowledgement fetch and then in
the next remittance fetch. A transmitted prescription walks from queued to transmitted to filled, one
step per status poll, and refuses cancellation once dispensed. An authorised payment can be captured
and then refunded, and refuses to be captured twice. A sent fax appears in its own status query.

**Made to fail.** Failure injection is the reason the mocks exist. A partner's sandbox will not time
out on request, will not half-accept a batch on the third call, and will not hand back a payload with
a field missing, and those are precisely the paths where an EMR loses a result or double-charges a
card.

### Failure-injection catalogue

Rules are declared at construction. Both filters are optional and independent, and the first matching
rule wins.

| Mode                 | Surfaces as           | Meaning                                                              |
| -------------------- | --------------------- | -------------------------------------------------------------------- |
| `timeout`            | `timeout` (retryable) | The partner did not answer inside `timeoutMs`. State is not touched. |
| `rejection`          | `rejected`            | The partner refused, with a reason code. State is not touched.       |
| `partial_success`    | `partial`             | A per-item verdict list: the first item accepted, the rest refused.  |
| `malformed_response` | `malformed_response`  | The payload is corrupted and caught by the contract's output schema. |

```ts
// Reject the third claim submission, and time out the second remittance fetch.
const clearinghouse = new MockClearinghouseAdapter({
  seed: 20260101,
  failures: [
    { mode: 'rejection', operation: 'submitClaim', callIndex: 3, reasonCode: 'payer_unreachable' },
    { mode: 'timeout', operation: 'fetchRemittances', callIndex: 2 },
  ],
});
```

Two further conditions are set rather than injected, because they are states rather than events:
`health: 'unavailable'` turns every operation into the retryable `unavailable` error, and narrowing
`supports` makes the operations behind a missing feature return `unsupported_operation` naming the
feature, so the degraded path can be tested without a second vendor.

The `malformed_response` mode deserves a note. The mock does not fabricate the error: it corrupts the
payload and lets the contract's own output schema catch it. That is the same code path a real vendor
takes when it quietly changes a field shape, which is the point.

## The registry, and the rule about payloads

`AdapterRegistry` is the only place an adapter is looked up, so it is the only place that can
guarantee two things nobody remembers to do by hand: version compatibility, and a call record.

Resolving returns the adapter already wrapped, so recording is not something a caller can forget. The
wrapper is built from the contract's own operation list rather than by reflecting over the object, so
a vendor that adds an undocumented method cannot expose an unrecorded call path.

```ts
const registry = new AdapterRegistry({ record: (entry) => auditQueue.push(entry) });
registry.register('labs', new MockLabsAdapter());

const resolved = registry.resolve('labs');
if (!resolved.ok) {
  return reportMissingSeam(resolved.error);
}
await resolved.value.placeOrder(order);
```

Resolving an unregistered capability is a typed error, not `undefined`, so a caller cannot reach a
partner-shaped hole by forgetting a null check.

### Call records never carry payloads

```ts
interface AdapterCallRecord {
  capability;
  vendorId;
  contractVersion;
  operation;
  startedAt;
  durationMs;
  outcome; // 'success' | 'error'
  errorKind?; // the coded kind, never the error body
  correlationId;
}
```

Every field is a coded identifier, a timestamp or a duration. There is no room for a request body, a
response body, a patient identifier, a card reference or a message text, and that is deliberate. This
record is written for every call at every seam, so anything it could carry, it will eventually carry
everywhere: into log aggregation, into a support bundle, into a screenshot in a ticket. A field that
holds a prescription today holds ten thousand of them by the end of the month.

`correlationId` is how a support engineer ties a record back to the request that caused it without the
record itself holding the details.

The same rule shapes the error types. `AdapterError` has no free-text `message` field. Every variant
carries coded fields only, and `malformed_response` carries zod issue **paths** and a count rather
than issue messages, because zod's messages sometimes quote the offending value and a malformed payload
is exactly the situation where the bytes are most likely to contain something we may not write down.
`zodIssuePaths` is exported so vendor adapters can honour the same rule.

`describeAdapterError` renders a one-line summary from coded fields alone, safe to store next to an
audit event.

This is not a convention; it is a test. `src/registry.test.ts` drives obviously sensitive synthetic
values through three seams and asserts that none of them appear anywhere in the serialised record
stream, and that each record's key set is exactly the vocabulary above. If a field is ever added that
could carry a payload, that test fails.

## Writing a vendor adapter

1. Implement the seam's adapter interface. Extending `MockAdapterBase` is not required and not
   expected; it exists for authors writing another mock.
2. Set `descriptor.contractVersion` to the seam version implemented, and list the optional features
   actually supported in `descriptor.supports`. Callers gate on feature flags, never on a vendor id.
3. Validate every partner response against the contract's output schema and return
   `malformedResponseError(site, zodIssuePaths(error))` when it fails. The output schema is the
   promise the seam makes to everything above it.
4. Return errors, do not throw. A thrown rejection is still recorded by the registry and re-raised
   untouched, but it is a broken adapter.
5. Never import a database client, never persist, never log a payload.

## Layout

```text
src/contracts/   core.ts plus one file per seam: schemas, config, version, adapter interface
src/mocks/       harness.ts (determinism, injection, validation), random.ts, one mock per seam
src/registry.ts  resolution, version compatibility, call recording
```

## Development

```bash
pnpm --filter @openrunic/adapters lint
pnpm --filter @openrunic/adapters type-check
pnpm --filter @openrunic/adapters test
pnpm --filter @openrunic/adapters build
```
