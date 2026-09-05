import { randomUUID } from 'node:crypto';

import type { ISODateTime, Result } from '@openrunic/types';
import { err, ok } from '@openrunic/types';

import type { AdapterErrorKind, Capability, CapabilityDescriptor } from './contracts/core.js';
import { isMajorCompatible, isoDateTimeOf, parseContractVersion } from './contracts/core.js';
import type {
  AnyCapabilityAdapter,
  CapabilityAdapterMap,
  ConfigOf,
  FeatureOf,
} from './contracts/index.js';
import { CONTRACTS } from './contracts/index.js';

/**
 * The registry: the one place an adapter is looked up, and therefore the one
 * place that can guarantee two things nobody remembers to do by hand.
 *
 * The first is version compatibility. Product code is compiled against a
 * specific seam major; an adapter package that implements a different major has
 * changed a shape we call, and the registry refuses it at registration rather
 * than letting it fail on a Tuesday afternoon inside a claim run.
 *
 * The second is the call record. Every resolved adapter is returned wrapped, so
 * recording is not something a caller can forget: the only reference anyone
 * holds is already instrumented. What the record contains is as important as
 * that it exists - see {@link AdapterCallRecord}.
 */

/** Whether a recorded call ended in the success or the failure arm. */
export type CallOutcome = 'success' | 'error';

/**
 * One partner interaction, in the shape the audit layer consumes.
 *
 * Every field here is either a coded identifier, a timestamp or a duration.
 * There is deliberately no room for a request body, a response body, a patient
 * identifier, a card reference or a message: this record is written for every
 * call at every seam, so anything it could carry, it will eventually carry
 * everywhere. `correlationId` is how a support engineer ties a record back to
 * the request that caused it without the record itself holding the details.
 */
export interface AdapterCallRecord {
  readonly capability: Capability;
  readonly vendorId: string;
  readonly contractVersion: string;
  readonly operation: string;
  readonly startedAt: ISODateTime;
  readonly durationMs: number;
  readonly outcome: CallOutcome;
  /** Present only when the call returned the failure arm; the coded kind, never the error body. */
  readonly errorKind?: AdapterErrorKind;
  readonly correlationId: string;
}

/** Everything that can go wrong looking an adapter up. A closed union, so no caller can ignore a case. */
export type RegistryError =
  | { readonly kind: 'not_registered'; readonly capability: Capability }
  | {
      readonly kind: 'already_registered';
      readonly capability: Capability;
      readonly vendorId: string;
    }
  | {
      readonly kind: 'malformed_version';
      readonly capability: Capability;
      /** Which side of the comparison could not be parsed. */
      readonly side: 'required' | 'offered';
      readonly version: string;
    }
  | {
      readonly kind: 'incompatible_version';
      readonly capability: Capability;
      readonly required: string;
      readonly offered: string;
    }
  | {
      readonly kind: 'incomplete_adapter';
      readonly capability: Capability;
      /** Contract methods the candidate does not implement. */
      readonly missing: readonly string[];
    };

/** The discriminator of {@link RegistryError}. */
export type RegistryErrorKind = RegistryError['kind'];

/** How a registry is built. Every option exists so a test can be deterministic. */
export interface RegistryOptions {
  /**
   * Overrides the seam version product code is compiled against. Defaults to
   * each contract's own version, which is the honest answer for code built from
   * this repository; an override exists for a host that ships an older client.
   */
  readonly requiredVersions?: Partial<Record<Capability, string>>;
  readonly clock?: () => Date;
  /** Where call records go. The default discards them, so a registry is safe to construct in a unit test. */
  readonly record?: (record: AdapterCallRecord) => void;
  /** Correlation id source, injectable so a test can assert on stable ids. */
  readonly correlationId?: () => string;
}

/** The methods every adapter has regardless of seam; instrumented alongside the seam's own operations. */
const BASE_METHODS = ['init', 'healthCheck', 'verifyCallback'] as const;

type UnknownMethod = (...args: unknown[]) => unknown;

interface CallContext {
  readonly descriptor: CapabilityDescriptor;
  readonly operation: string;
  readonly startedAt: Date;
  readonly correlationId: string;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads the coded error kind out of a returned value, without knowing what the
 * value is. Anything that is not the failure arm of a `Result` carrying an
 * `AdapterError` counts as success, which is what makes `healthCheck` and the
 * seam operations recordable through one path.
 */
function adapterErrorKindOf(value: unknown): AdapterErrorKind | undefined {
  if (!isRecordObject(value) || value.ok !== false) {
    return undefined;
  }
  const error = value.error;
  if (!isRecordObject(error) || typeof error.kind !== 'string') {
    return undefined;
  }
  return error.kind as AdapterErrorKind;
}

/**
 * Collects the named methods from a candidate adapter, reporting the ones it
 * does not implement. Done up front so a plugin that half-implements a seam is
 * refused at installation rather than at the first call.
 */
function collectMethods(
  candidate: object,
  names: readonly string[]
): Result<ReadonlyMap<string, UnknownMethod>, readonly string[]> {
  const source = candidate as Record<string, unknown>;
  const found = new Map<string, UnknownMethod>();
  const missing: string[] = [];
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'function') {
      found.set(name, value as UnknownMethod);
    } else {
      missing.push(name);
    }
  }
  return missing.length === 0 ? ok(found) : err(missing);
}

function noRecording(): undefined {
  return undefined;
}

/** Resolves adapters, polices seam versions, and records every call it hands out. */
export class AdapterRegistry {
  private readonly adapters = new Map<Capability, AnyCapabilityAdapter>();
  /**
   * The configuration this installation registered a capability with.
   *
   * Held here and never handed out. An `ErxConfig` carries `credentialRef` and
   * `networkAccountId`, so the object a route resolves stays `{ descriptor,
   * ...operations }` and questions about the installation are answered by
   * {@link AdapterRegistry.entitledTo} rather than by reading the config.
   *
   * A capability registered without one has no entry, which is not the same as
   * an entry saying `false` only in how it arose - both answer "not entitled".
   * That is deliberate: see {@link AdapterRegistry.entitledTo}.
   */
  private readonly installations = new Map<Capability, Record<string, unknown>>();
  private readonly requiredVersions: Partial<Record<Capability, string>>;
  private readonly clock: () => Date;
  private readonly sink: (record: AdapterCallRecord) => void;
  private readonly newCorrelationId: () => string;

  constructor(options: RegistryOptions = {}) {
    this.requiredVersions = options.requiredVersions ?? {};
    this.clock = options.clock ?? (() => new Date());
    this.sink = options.record ?? noRecording;
    this.newCorrelationId = options.correlationId ?? randomUUID;
  }

  /** The seam version product code is compiled against for this capability. */
  requiredVersion(capability: Capability): string {
    return this.requiredVersions[capability] ?? CONTRACTS[capability].contractVersion;
  }

  /**
   * Registers an adapter under a capability, after checking that it implements
   * a compatible major of the seam and implements every method the contract
   * names. Returns the descriptor on success so an installer can report what it
   * just enabled without a second lookup.
   */
  register<C extends Capability>(
    capability: C,
    adapter: CapabilityAdapterMap[C],
    installation?: { readonly config: ConfigOf<C> }
  ): Result<CapabilityDescriptor, RegistryError> {
    const existing = this.adapters.get(capability);
    if (existing !== undefined) {
      return err({
        kind: 'already_registered',
        capability,
        vendorId: existing.descriptor.vendorId,
      });
    }

    const requiredText = this.requiredVersion(capability);
    const required = parseContractVersion(requiredText);
    if (required === undefined) {
      return err({
        kind: 'malformed_version',
        capability,
        side: 'required',
        version: requiredText,
      });
    }
    const offeredText = adapter.descriptor.contractVersion;
    const offered = parseContractVersion(offeredText);
    if (offered === undefined) {
      return err({ kind: 'malformed_version', capability, side: 'offered', version: offeredText });
    }
    if (!isMajorCompatible(required, offered)) {
      return err({
        kind: 'incompatible_version',
        capability,
        required: requiredText,
        offered: offeredText,
      });
    }

    const operationNames = Object.keys(CONTRACTS[capability].operations);
    const methods = collectMethods(adapter, [...operationNames, ...BASE_METHODS]);
    if (!methods.ok) {
      return err({ kind: 'incomplete_adapter', capability, missing: methods.error });
    }

    this.adapters.set(capability, this.instrument(adapter, methods.value));
    if (installation !== undefined) {
      // Recorded only on success, so a refused registration cannot leave an
      // entitlement behind for a capability that has no adapter.
      this.installations.set(capability, installation.config as Record<string, unknown>);
    }
    return ok(adapter.descriptor);
  }

  /**
   * Returns the instrumented adapter for a capability. An unregistered
   * capability is a typed error rather than `undefined`, so a caller cannot
   * reach a partner-shaped hole by forgetting a null check; and because
   * registration is the only door in, nothing incompatible can be resolved.
   */
  resolve<C extends Capability>(capability: C): Result<CapabilityAdapterMap[C], RegistryError> {
    const adapter = this.adapters.get(capability);
    if (adapter === undefined) {
      return err({ kind: 'not_registered', capability });
    }
    // Safe by construction: `register` binds the capability key and the adapter
    // type together, and nothing else writes to this map.
    return ok(adapter as CapabilityAdapterMap[C]);
  }

  /** Removes an adapter, for a plugin being disabled. Reports whether there was one. */
  unregister(capability: Capability): boolean {
    // The installation goes with it. A configuration outliving its adapter would
    // answer `entitledTo` for a capability nothing can perform.
    this.installations.delete(capability);
    return this.adapters.delete(capability);
  }

  /**
   * Whether this installation is recorded as entitled to a feature.
   *
   * A feature is what a VENDOR may offer - `supportsFeature(descriptor, …)`
   * answers that, off the descriptor, and it is a different question. Some
   * features are also an entitlement the practice holds separately: the eRx
   * contract states it in as many words for `epcs`, because "a network may
   * support controlled substances while a given installation is not enrolled,
   * and the practice must be able to say so". Both have to be true, and a caller
   * gating a regulated operation must ask both.
   *
   * ## It fails closed, and that is the point
   *
   * `false` is returned when no configuration was recorded, when the feature is
   * not a key of it, and when the value is anything other than `true`. So the
   * state a future caller reaches by FORGETTING to pass a config - which every
   * caller written before this parameter existed does - is "not entitled", which
   * is a refusal somebody reports rather than a transmission nobody sees.
   *
   * Never widen this to treat a missing configuration as permission.
   */
  entitledTo<C extends Capability>(capability: C, feature: FeatureOf<C>): boolean {
    return this.installations.get(capability)?.[feature] === true;
  }

  /** What this installation can do, for an admin screen, without calling any partner. */
  descriptors(): readonly CapabilityDescriptor[] {
    return [...this.adapters.values()].map((adapter) => adapter.descriptor);
  }

  /**
   * Wraps an adapter so every method call is recorded.
   *
   * The wrapper is built from the contract's own operation list rather than by
   * reflecting over the object, so a vendor that adds an undocumented method
   * cannot expose an unrecorded call path. Arguments are passed straight
   * through and never inspected: the instrumentation cannot leak a payload
   * because it never holds one.
   */
  private instrument<C extends Capability>(
    adapter: CapabilityAdapterMap[C],
    methods: ReadonlyMap<string, UnknownMethod>
  ): CapabilityAdapterMap[C] {
    const descriptor = adapter.descriptor;
    const wrapped: Record<string, unknown> = { descriptor };
    for (const [operation, method] of methods) {
      wrapped[operation] = (...args: unknown[]): unknown =>
        this.invoke(descriptor, operation, () => method.apply(adapter, args));
    }
    // Safe by construction: `collectMethods` proved every method the interface
    // declares is present, and `descriptor` is copied verbatim.
    return wrapped as unknown as CapabilityAdapterMap[C];
  }

  private invoke(
    descriptor: CapabilityDescriptor,
    operation: string,
    call: () => unknown
  ): unknown {
    const context: CallContext = {
      descriptor,
      operation,
      startedAt: this.clock(),
      correlationId: this.newCorrelationId(),
    };
    const returned = call();
    if (returned instanceof Promise) {
      return returned.then(
        (value: unknown) => {
          this.complete(context, value);
          return value;
        },
        (reason: unknown) => {
          // An adapter that throws instead of returning the failure arm is a
          // broken adapter, but the call still happened and still belongs in
          // the record. The rejection is re-raised untouched.
          this.push(context, 'error', undefined);
          throw reason;
        }
      );
    }
    this.complete(context, returned);
    return returned;
  }

  private complete(context: CallContext, value: unknown): void {
    const errorKind = adapterErrorKindOf(value);
    this.push(context, errorKind === undefined ? 'success' : 'error', errorKind);
  }

  private push(
    context: CallContext,
    outcome: CallOutcome,
    errorKind: AdapterErrorKind | undefined
  ): void {
    this.sink({
      capability: context.descriptor.capability,
      vendorId: context.descriptor.vendorId,
      contractVersion: context.descriptor.contractVersion,
      operation: context.operation,
      startedAt: isoDateTimeOf(context.startedAt),
      durationMs: this.clock().getTime() - context.startedAt.getTime(),
      outcome,
      ...(errorKind === undefined ? {} : { errorKind }),
      correlationId: context.correlationId,
    });
  }
}
