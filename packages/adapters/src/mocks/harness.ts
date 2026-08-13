import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ISODateTime, Result } from '@openrunic/types';
import { err, ok } from '@openrunic/types';

import type {
  Adapter,
  AdapterCallSite,
  AdapterConfigBase,
  AdapterDeps,
  AdapterErr,
  AdapterResult,
  CallbackRequest,
  CapabilityContract,
  CapabilityDescriptor,
  HealthState,
  HealthStatus,
  ItemOutcome,
  VerifiedCallback,
} from '../contracts/core.js';
import {
  CALLBACK_SIGNATURE_HEADER,
  callbackEnvelope,
  isoDateTimeOf,
  malformedResponseError,
  misconfiguredError,
  partialError,
  rejectedError,
  timeoutError,
  unauthorizedError,
  unavailableError,
  unsupportedOperationError,
  zodIssuePaths,
} from '../contracts/core.js';
import { mulberry32, randomHex, randomPick } from './random.js';

/**
 * The machinery every in-process mock shares: a seeded clock, a seeded
 * generator, failure injection and output validation.
 *
 * Mocks exist because the alternative is a test suite that can only prove the
 * happy path. A partner's sandbox will not time out on request, will not
 * half-accept a batch on the third call, and will not hand back a payload with
 * a field missing - and those are precisely the paths where an EMR loses a
 * result or double-charges a card. Making every one of them a one-line
 * declaration is the point of this file.
 */

/**
 * The ways a mock can be told to fail.
 *
 * Each maps onto exactly one documented {@link AdapterError} variant, so a test
 * that injects `rejection` is testing the same code path a real refusal takes.
 */
export type FailureMode = 'timeout' | 'rejection' | 'partial_success' | 'malformed_response';

/** Every {@link FailureMode}, for table-driven tests over the whole catalogue. */
export const FAILURE_MODES = [
  'timeout',
  'rejection',
  'partial_success',
  'malformed_response',
] as const;

/**
 * One declarative failure rule. Both filters are optional and independent, so
 * "reject the third claim submission" is `{ mode: 'rejection', operation:
 * 'submitClaim', callIndex: 3 }` and "time out everything" is `{ mode:
 * 'timeout' }`. The first matching rule wins.
 */
export interface FailureInjection {
  readonly mode: FailureMode;
  /** Restrict to one operation. Omitted matches every operation on the seam. */
  readonly operation?: string;
  /** One-based index among calls to the matched operation. Omitted matches every call. */
  readonly callIndex?: number;
  /** Partner reason code reported for `rejection` and for refused items under `partial_success`. */
  readonly reasonCode?: string;
}

/** How a mock is built. Everything here has a deterministic default, so `new MockErxAdapter()` is reproducible. */
export interface MockAdapterOptions {
  /** Seed for every generated reference. The same seed and call sequence give byte-identical output. */
  readonly seed?: number;
  readonly vendorId?: string;
  readonly displayName?: string;
  /** Clock override. The default advances one second per read and never touches the system clock. */
  readonly clock?: () => Date;
  readonly failures?: readonly FailureInjection[];
  /** Narrows the declared feature set, so a test can prove the degraded path when a vendor lacks a feature. */
  readonly supports?: readonly string[];
  /** Fixed health answer. `unavailable` makes every operation return the retryable unavailable error. */
  readonly health?: HealthState;
}

/** Where the default mock clock starts. A fixed, obviously synthetic instant. */
export const MOCK_EPOCH = '2026-01-01T00:00:00.000Z';

/** The default seed. Any number works; this one is written down so fixtures can name it. */
export const DEFAULT_MOCK_SEED = 20_260_101;

/** How far the default clock advances per read. */
const MOCK_CLOCK_STEP_MS = 1_000;

/** Reason codes a mock reaches for when a test did not name one. Obviously synthetic, deliberately coded. */
const MOCK_REASON_CODES: readonly [string, ...string[]] = [
  'partner_rejected',
  'duplicate_submission',
  'invalid_identifier',
  'quota_exceeded',
];

/**
 * What a mock returns in place of a valid payload under `malformed_response`
 * injection. It is not a mangled copy of the real payload on purpose: a
 * corrupted copy of a real response is still a real response, and this value
 * has to be safe to hold in a test fixture forever.
 */
const CORRUPT_PAYLOAD: unknown = { corrupted: true };

/**
 * Signs a callback body the way every mock in this package verifies it.
 *
 * Exported because the owning service's own tests need to forge a correctly
 * signed callback; without it every such test would either reimplement this or,
 * worse, skip verification and never exercise the rejection path.
 */
export function signCallbackBody(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function signaturesMatch(expected: string, offered: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const offeredBytes = Buffer.from(offered, 'utf8');
  if (expectedBytes.length !== offeredBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, offeredBytes);
}

/**
 * The base class for the eight in-process mocks.
 *
 * Subclasses model state and produce payloads; everything about determinism,
 * failure injection, lifecycle and output validation lives here so that the
 * eight seams cannot drift apart in how they fail. A vendor adapter has no
 * reason to extend this, but an author writing a second mock should.
 */
export abstract class MockAdapterBase<
  TConfig extends AdapterConfigBase,
> implements Adapter<TConfig> {
  readonly descriptor: CapabilityDescriptor;

  /** The seeded generator. Subclasses mint references and pick fixtures from it, never from `Math.random`. */
  protected readonly nextRandom: () => number;

  private readonly contract: CapabilityContract;
  private readonly failures: readonly FailureInjection[];
  private readonly callCounts = new Map<string, number>();
  private readonly clock: () => Date;
  private readonly healthState: HealthState;
  private tick = 0;
  private deps: AdapterDeps | undefined;
  private initialized = false;
  private callbackSecret = '';
  private timeoutMs = 0;

  protected constructor(contract: CapabilityContract, options: MockAdapterOptions = {}) {
    this.contract = contract;
    this.failures = options.failures ?? [];
    this.healthState = options.health ?? 'healthy';
    this.nextRandom = mulberry32(options.seed ?? DEFAULT_MOCK_SEED);
    const epoch = Date.parse(MOCK_EPOCH);
    this.clock = options.clock ?? (() => new Date(epoch + this.tick++ * MOCK_CLOCK_STEP_MS));
    this.descriptor = {
      capability: contract.capability,
      contractVersion: contract.contractVersion,
      vendorId: options.vendorId ?? `mock-${contract.capability}`,
      displayName: options.displayName ?? `In-process ${contract.capability} mock`,
      supports: options.supports ?? contract.features,
      healthCheck: () => this.healthCheck(),
    };
  }

  /**
   * Validates the config, resolves the secrets it points at, and only then
   * declares the adapter usable. Resolution happens here rather than per call
   * so an installation with a missing secret fails at start-up, where an
   * operator is watching, instead of at the first prescription.
   */
  async init(config: TConfig, deps: AdapterDeps): Promise<AdapterResult<void>> {
    const site = this.site('init');
    const parsed = this.contract.config.safeParse(config);
    if (!parsed.success) {
      return err(misconfiguredError(site, 'schema', zodIssuePaths(parsed.error)));
    }
    const credential = await deps.resolveSecret(config.credentialRef);
    if (credential === undefined || credential.length === 0) {
      return err(misconfiguredError(site, 'secret_unresolved', ['credentialRef']));
    }
    if (config.callbackSecretRef !== undefined) {
      const callbackSecret = await deps.resolveSecret(config.callbackSecretRef);
      if (callbackSecret === undefined || callbackSecret.length === 0) {
        return err(misconfiguredError(site, 'secret_unresolved', ['callbackSecretRef']));
      }
      this.callbackSecret = callbackSecret;
    }
    this.timeoutMs = config.timeoutMs;
    this.deps = deps;
    this.initialized = true;
    deps.log({
      level: 'info',
      code: 'adapter.initialized',
      capability: this.descriptor.capability,
    });
    return ok(undefined);
  }

  /** Answers from the configured state. Reports `not_initialized` as detail so a health page can say why. */
  healthCheck(): Promise<HealthStatus> {
    const base = { state: this.healthState, checkedAt: this.nowIso() };
    return Promise.resolve(this.initialized ? base : { ...base, detail: 'not_initialized' });
  }

  /**
   * Verifies the signature first and parses second, in that order, because the
   * parser is the part an unauthenticated caller would otherwise get to run.
   */
  verifyCallback(request: CallbackRequest): AdapterResult<VerifiedCallback> {
    const site = this.site('verifyCallback');
    if (!this.initialized) {
      return err(misconfiguredError(site, 'not_initialized'));
    }
    if (this.callbackSecret.length === 0) {
      return err(misconfiguredError(site, 'secret_unresolved', ['callbackSecretRef']));
    }
    const offered = request.headers[CALLBACK_SIGNATURE_HEADER];
    if (offered === undefined) {
      return err(unauthorizedError(site, 'bad_signature'));
    }
    if (!signaturesMatch(signCallbackBody(this.callbackSecret, request.rawBody), offered)) {
      return err(unauthorizedError(site, 'bad_signature'));
    }
    const decoded = decodeJson(request.rawBody);
    if (!decoded.ok) {
      return err(malformedResponseError(site, ['$']));
    }
    const parsed = callbackEnvelope.safeParse(decoded.value);
    if (!parsed.success) {
      return err(malformedResponseError(site, zodIssuePaths(parsed.error)));
    }
    return ok({
      capability: this.descriptor.capability,
      vendorId: this.descriptor.vendorId,
      eventId: parsed.data.eventId,
      eventType: parsed.data.eventType,
      occurredAt: parsed.data.occurredAt as ISODateTime,
      payload: parsed.data.data,
    });
  }

  /** The current instant from the injected or default clock. No mock may read the system clock. */
  protected now(): Date {
    return this.clock();
  }

  /** The current instant, branded. */
  protected nowIso(): ISODateTime {
    return isoDateTimeOf(this.now());
  }

  /** Where an error happened, for the error constructors. */
  protected site(operation: string): AdapterCallSite {
    return { capability: this.descriptor.capability, operation };
  }

  /** Mints an opaque partner reference, deterministic for the seed. */
  protected mintRef(prefix: string): string {
    return `${prefix}_${randomHex(this.nextRandom, 12)}`;
  }

  /** Shorthand for the failure arm every state precondition returns. */
  protected reject(operation: string, reasonCode: string): AdapterErr {
    return err(rejectedError(this.site(operation), reasonCode));
  }

  /**
   * Refuses an operation this vendor does not declare support for. Returning
   * `undefined` when the feature is present keeps the guard to one line at each
   * call site, which is the only way it actually gets written everywhere.
   */
  protected featureGate(operation: string, feature: string): AdapterErr | undefined {
    if (this.descriptor.supports.includes(feature)) {
      return undefined;
    }
    return err(unsupportedOperationError(this.site(operation), feature));
  }

  /**
   * Runs one operation through the whole seam: lifecycle checks, health,
   * failure injection, then validation of the produced payload against the
   * contract's own output schema.
   *
   * The validation is not ceremony. A mock that could emit a payload its own
   * contract rejects would let a schema drift out from under eight consumers
   * without a single test going red, and the `malformed_response` path exists
   * precisely because that is what a real vendor eventually does.
   *
   * `itemRefs` are the opaque things this call acts on. They are named up front
   * so `partial_success` injection can report a per-item verdict for a call
   * that never reached the partner.
   */
  protected async runOperation<T>(
    operation: string,
    itemRefs: readonly string[],
    produce: () => AdapterResult<T>
  ): Promise<AdapterResult<T>> {
    const site = this.site(operation);
    const deps = this.deps;
    if (!this.initialized || deps === undefined) {
      return err(misconfiguredError(site, 'not_initialized'));
    }
    const schema = this.contract.operations[operation];
    if (schema === undefined) {
      return err(unsupportedOperationError(site, operation));
    }
    if (this.healthState === 'unavailable') {
      return err(unavailableError(site, 30_000));
    }

    const callIndex = (this.callCounts.get(operation) ?? 0) + 1;
    this.callCounts.set(operation, callIndex);
    const injected = this.matchFailure(operation, callIndex);

    if (injected?.mode === 'timeout') {
      return err(timeoutError(site, this.timeoutMs));
    }
    if (injected?.mode === 'rejection') {
      return err(rejectedError(site, injected.reasonCode ?? this.pickReasonCode()));
    }
    if (injected?.mode === 'partial_success') {
      return err(partialError(site, this.itemVerdicts(itemRefs, injected.reasonCode)));
    }

    const produced = produce();
    if (!produced.ok) {
      return produced;
    }
    const candidate: unknown =
      injected?.mode === 'malformed_response' ? CORRUPT_PAYLOAD : produced.value;
    const validated = schema.output.safeParse(candidate);
    if (!validated.success) {
      return err(malformedResponseError(site, zodIssuePaths(validated.error)));
    }
    deps.emit({
      type: `${this.descriptor.capability}.${operation}.succeeded`,
      occurredAt: this.nowIso(),
    });
    return produced;
  }

  /**
   * The partner accepted the first item and refused the rest. A single-item
   * call therefore reports that one item refused: the verdict list is reported
   * faithfully rather than collapsed into `rejected`, so a caller has one code
   * path for per-item outcomes whatever the batch size.
   */
  private itemVerdicts(itemRefs: readonly string[], reasonCode?: string): readonly ItemOutcome[] {
    return itemRefs.map((itemRef, index) => {
      const accepted = index === 0 && itemRefs.length > 1;
      return accepted
        ? { itemRef, accepted }
        : { itemRef, accepted, reasonCode: reasonCode ?? 'item_rejected' };
    });
  }

  private matchFailure(operation: string, callIndex: number): FailureInjection | undefined {
    return this.failures.find(
      (failure) =>
        (failure.operation === undefined || failure.operation === operation) &&
        (failure.callIndex === undefined || failure.callIndex === callIndex)
    );
  }

  private pickReasonCode(): string {
    return randomPick(this.nextRandom, MOCK_REASON_CODES);
  }
}

function decodeJson(raw: string): Result<unknown, 'invalid_json'> {
  try {
    return ok(JSON.parse(raw) as unknown);
  } catch {
    return err('invalid_json');
  }
}
