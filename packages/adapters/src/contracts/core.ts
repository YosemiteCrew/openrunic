import type { Err, ISODateTime, Result } from '@openrunic/types';
import { z } from 'zod';

/**
 * The shared vocabulary every partner seam is built from.
 *
 * A seam exists so that product code never learns a vendor's name. Billing
 * calls `submitClaim` on the clearinghouse contract; it does not know, and must
 * not be able to discover, which company answers. That is what makes a vendor
 * swap an installation change rather than a refactor, and it is why everything
 * in this file is expressed in generic domain words - a clearinghouse, an eRx
 * network, a card processor - and never in a brand.
 *
 * Three rules hold across every seam and are enforced by the types here:
 *
 *   1. Adapters never touch storage. They return typed results; the owning
 *      service decides what to persist. Nothing in this package may import
 *      `@openrunic/database`, and no contract type may reference a row shape.
 *   2. Expected failure is a value, not an exception. Every operation returns
 *      `Result<T, AdapterError>`, and {@link AdapterError} is a closed union, so
 *      a caller that forgets a failure mode fails to compile rather than
 *      failing in production.
 *   3. Money is integer minor units and identifiers are opaque strings. A
 *      float amount and a structured vendor identifier are both ways of losing
 *      information at a boundary we cannot re-cross.
 */

/** Every partner seam Openrunic defines. Closed on purpose: a ninth seam is a contract change, not a config value. */
export const CAPABILITIES = [
  'erx',
  'clearinghouse',
  'labs',
  'payments',
  'fax',
  'sms',
  'video',
  'address-verify',
] as const;

/** One partner seam. Used as the discriminator everywhere a capability is addressed. */
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Runtime guard for {@link Capability}, for the places a capability name arrives
 * as untrusted text: a plugin manifest, an admin form, a callback route segment.
 */
export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

// --- Health -----------------------------------------------------------------

/**
 * Three states rather than a boolean, because "reachable but refusing work" is
 * the condition an on-call operator most needs to see: it is the difference
 * between a queue that will drain by itself and one that will not.
 */
export type HealthState = 'healthy' | 'degraded' | 'unavailable';

/** The result of a health probe. `detail` is a short stable code, never free text and never a payload. */
export interface HealthStatus {
  readonly state: HealthState;
  readonly checkedAt: ISODateTime;
  readonly detail?: string;
}

// --- Descriptor -------------------------------------------------------------

/**
 * What an installation can actually do, without calling the partner.
 *
 * This is data plus the health probe, so an admin screen or the registry can
 * answer "does this practice have eligibility checking?" by reading descriptors
 * alone. Instantiating a real operation to find out would mean sending a
 * partner a request nobody asked for.
 */
export interface CapabilityDescriptor {
  readonly capability: Capability;
  /** Semver of the seam contract this adapter implements, not the vendor's own version. */
  readonly contractVersion: string;
  /** Stable installation-local id for the vendor package, e.g. `mock-erx`. */
  readonly vendorId: string;
  /** Human label for admin screens. */
  readonly displayName: string;
  /** Optional feature flags from the seam's catalogue that this vendor implements. */
  readonly supports: readonly string[];
  healthCheck(): Promise<HealthStatus>;
}

/**
 * Whether a descriptor claims an optional feature. Callers gate on this rather
 * than on a vendor name, so a second vendor with the same feature needs no code
 * change to light the feature up.
 */
export function supportsFeature(
  descriptor: Pick<CapabilityDescriptor, 'supports'>,
  feature: string
): boolean {
  return descriptor.supports.includes(feature);
}

// --- Errors -----------------------------------------------------------------

/** Where a failure happened. Carried on every {@link AdapterError} so a log line needs no extra context. */
export interface AdapterCallSite {
  readonly capability: Capability;
  readonly operation: string;
}

interface AdapterErrorBase extends AdapterCallSite {
  /**
   * Whether repeating the identical call could plausibly succeed. Set by the
   * seam, not guessed by the caller, because only the seam knows whether the
   * partner already accepted the work.
   */
  readonly retryable: boolean;
}

/** The partner did not answer inside the configured budget. Retryable, but only behind idempotency keys. */
export interface TimeoutAdapterError extends AdapterErrorBase {
  readonly kind: 'timeout';
  readonly elapsedMs: number;
}

/** The partner answered and refused, with its own reason code. Not retryable: the same request gets the same refusal. */
export interface RejectedAdapterError extends AdapterErrorBase {
  readonly kind: 'rejected';
  /** The partner's code, normalised to lowercase snake case by the adapter. */
  readonly reasonCode: string;
}

/** One item's verdict inside a {@link PartialAdapterError}. `itemRef` is the opaque reference the caller supplied. */
export interface ItemOutcome {
  readonly itemRef: string;
  readonly accepted: boolean;
  readonly reasonCode?: string;
}

/**
 * The partner returned a per-item verdict list instead of a verdict on the
 * call. This is its own variant rather than a `rejected` with a note because
 * the caller has real work to do: post the accepted items, queue the rest.
 * Collapsing it would silently drop the accepted half.
 */
export interface PartialAdapterError extends AdapterErrorBase {
  readonly kind: 'partial';
  readonly outcomes: readonly ItemOutcome[];
  readonly acceptedCount: number;
  readonly rejectedCount: number;
}

/**
 * The partner's payload failed the contract's output schema. Carries issue
 * paths and a count, never the offending values: a malformed payload is exactly
 * the situation where the bytes are most likely to contain something we may not
 * write down.
 */
export interface MalformedResponseAdapterError extends AdapterErrorBase {
  readonly kind: 'malformed_response';
  readonly issuePaths: readonly string[];
  readonly issueCount: number;
}

/** Why credentials failed. Coded so an alert can route without a human reading a sentence. */
export type UnauthorizedReason = 'bad_signature' | 'credentials_rejected' | 'scope_missing';

/** The partner refused the credentials, or an inbound callback failed signature verification. */
export interface UnauthorizedAdapterError extends AdapterErrorBase {
  readonly kind: 'unauthorized';
  readonly reason: UnauthorizedReason;
}

/** This vendor does not implement an optional feature of the seam. Names the feature flag, so the caller can degrade. */
export interface UnsupportedOperationAdapterError extends AdapterErrorBase {
  readonly kind: 'unsupported_operation';
  readonly feature: string;
}

/** The partner is down. Retryable, and carries the backoff hint when the partner offered one. */
export interface UnavailableAdapterError extends AdapterErrorBase {
  readonly kind: 'unavailable';
  readonly retryAfterMs?: number;
}

/** Why an adapter cannot run at all. Every value here is an installation fault, never a partner fault. */
export type MisconfiguredReason = 'schema' | 'not_initialized' | 'secret_unresolved';

/**
 * The adapter was asked to work before it could. Kept separate from
 * `unauthorized` so a paging rule can tell "our deployment is wrong" from "the
 * partner rejected us", which are different humans at different hours.
 */
export interface MisconfiguredAdapterError extends AdapterErrorBase {
  readonly kind: 'misconfigured';
  readonly reason: MisconfiguredReason;
  readonly issuePaths: readonly string[];
}

/**
 * Every way a seam is allowed to fail. Closed so that adding a failure mode is
 * a compile error at every call site rather than a surprise in a log.
 *
 * Note what is absent: a free-text `message`. Nothing here can carry a patient
 * name, a card reference or a message body, so an error may be logged whole
 * without a redaction pass standing between the developer and the truth.
 */
export type AdapterError =
  | TimeoutAdapterError
  | RejectedAdapterError
  | PartialAdapterError
  | MalformedResponseAdapterError
  | UnauthorizedAdapterError
  | UnsupportedOperationAdapterError
  | UnavailableAdapterError
  | MisconfiguredAdapterError;

/** The discriminator of {@link AdapterError}, useful as a metric label. */
export type AdapterErrorKind = AdapterError['kind'];

/** Every {@link AdapterErrorKind}, for exhaustiveness tests and metric cardinality budgets. */
export const ADAPTER_ERROR_KINDS = [
  'timeout',
  'rejected',
  'partial',
  'malformed_response',
  'unauthorized',
  'unsupported_operation',
  'unavailable',
  'misconfigured',
] as const;

/** Shorthand for the return type of every seam operation. */
export type AdapterResult<T> = Result<T, AdapterError>;

/** The partner did not answer in time. `elapsedMs` is the budget that expired, not a measured duration. */
export function timeoutError(site: AdapterCallSite, elapsedMs: number): TimeoutAdapterError {
  return { ...site, kind: 'timeout', retryable: true, elapsedMs };
}

/** The partner refused the call outright. */
export function rejectedError(site: AdapterCallSite, reasonCode: string): RejectedAdapterError {
  return { ...site, kind: 'rejected', retryable: false, reasonCode };
}

/**
 * Builds the per-item verdict error and derives the counts, so no call site can
 * report an accepted count that disagrees with its own outcome list.
 */
export function partialError(
  site: AdapterCallSite,
  outcomes: readonly ItemOutcome[]
): PartialAdapterError {
  const acceptedCount = outcomes.filter((outcome) => outcome.accepted).length;
  return {
    ...site,
    kind: 'partial',
    retryable: false,
    outcomes,
    acceptedCount,
    rejectedCount: outcomes.length - acceptedCount,
  };
}

/** The partner's payload did not match the contract. Takes paths only; see {@link zodIssuePaths}. */
export function malformedResponseError(
  site: AdapterCallSite,
  issuePaths: readonly string[]
): MalformedResponseAdapterError {
  return {
    ...site,
    kind: 'malformed_response',
    retryable: false,
    issuePaths,
    issueCount: issuePaths.length,
  };
}

/** Credentials or an inbound signature failed. */
export function unauthorizedError(
  site: AdapterCallSite,
  reason: UnauthorizedReason
): UnauthorizedAdapterError {
  return { ...site, kind: 'unauthorized', retryable: false, reason };
}

/** This vendor does not implement `feature`. */
export function unsupportedOperationError(
  site: AdapterCallSite,
  feature: string
): UnsupportedOperationAdapterError {
  return { ...site, kind: 'unsupported_operation', retryable: false, feature };
}

/** The partner is unreachable or is shedding load. */
export function unavailableError(
  site: AdapterCallSite,
  retryAfterMs?: number
): UnavailableAdapterError {
  return {
    ...site,
    kind: 'unavailable',
    retryable: true,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/** The installation, not the partner, is at fault. */
export function misconfiguredError(
  site: AdapterCallSite,
  reason: MisconfiguredReason,
  issuePaths: readonly string[] = []
): MisconfiguredAdapterError {
  return { ...site, kind: 'misconfigured', retryable: false, reason, issuePaths };
}

/**
 * A one-line, payload-free rendering of an error, for a log line or an admin
 * screen. Built only from coded fields, so its output is safe to store next to
 * an audit event.
 */
export function describeAdapterError(error: AdapterError): string {
  const prefix = `${error.capability}.${error.operation}`;
  switch (error.kind) {
    case 'timeout':
      return `${prefix}: timeout after ${String(error.elapsedMs)}ms`;
    case 'rejected':
      return `${prefix}: rejected (${error.reasonCode})`;
    case 'partial':
      return `${prefix}: partial (${String(error.acceptedCount)} accepted, ${String(error.rejectedCount)} rejected)`;
    case 'malformed_response':
      return `${prefix}: malformed_response (${String(error.issueCount)} issues)`;
    case 'unauthorized':
      return `${prefix}: unauthorized (${error.reason})`;
    case 'unsupported_operation':
      return `${prefix}: unsupported_operation (${error.feature})`;
    case 'unavailable':
      return `${prefix}: unavailable`;
    case 'misconfigured':
      return `${prefix}: misconfigured (${error.reason})`;
  }
}

/** The part of a zod error {@link zodIssuePaths} reads. Structural, so any zod version satisfies it. */
export interface SchemaIssues {
  readonly issues: readonly { readonly path: ReadonlyArray<PropertyKey> }[];
}

/**
 * Turns a schema failure into dotted paths and nothing else.
 *
 * This is the single function standing between a validation failure and a log,
 * and it exists because zod's own messages sometimes quote the offending value.
 * At a seam that carries prescriptions and card references, a quoted value in a
 * message is a disclosure, so only the paths survive. A top-level issue, such
 * as an unrecognised key, reports as `$`.
 */
export function zodIssuePaths(error: SchemaIssues): readonly string[] {
  return error.issues.map((issue) =>
    issue.path.length === 0 ? '$' : issue.path.map((segment) => String(segment)).join('.')
  );
}

// --- Callbacks --------------------------------------------------------------

/** The header a mock or a real adapter reads its callback signature from. */
export const CALLBACK_SIGNATURE_HEADER = 'x-openrunic-signature';

/**
 * An inbound partner callback, exactly as it arrived. `rawBody` is the
 * undecoded string because signatures are computed over bytes, and a framework
 * that parsed the JSON first has already destroyed the evidence.
 */
export interface CallbackRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly receivedAt: ISODateTime;
}

/** A callback whose signature verified. Nothing may act on a callback that did not produce one of these. */
export interface VerifiedCallback {
  readonly capability: Capability;
  readonly vendorId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: ISODateTime;
  /** The partner's event body, handed to the owning service unread by the adapter. */
  readonly payload: unknown;
}

/**
 * The envelope every seam requires around a callback body. Uniform across
 * vendors so that replay protection and ordering live in one place: `eventId`
 * is the idempotency key the owning service dedupes on.
 */
export const callbackEnvelope = z.strictObject({
  eventId: z.string().min(1).max(128),
  eventType: z.string().min(1).max(128),
  occurredAt: z.iso.datetime({ offset: true }),
  data: z.unknown().optional(),
});

/** Inferred shape of {@link callbackEnvelope}. */
export type CallbackEnvelope = z.infer<typeof callbackEnvelope>;

// --- Dependencies and configuration -----------------------------------------

/** A domain event an adapter raises. Carries opaque partner references only, never patient identifiers. */
export interface AdapterEvent {
  readonly type: string;
  readonly occurredAt: ISODateTime;
  /** An opaque partner reference such as a transmission id, when the event is about one. */
  readonly subjectRef?: string;
  readonly correlationId?: string;
}

/**
 * A log line from inside an adapter. There is no message field: `code` is a
 * stable identifier a dashboard can group on, and anything a developer would
 * have written in prose would be the payload we promised not to write down.
 */
export interface AdapterLogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly code: string;
  readonly capability: Capability;
  readonly operation?: string;
}

/**
 * Everything an adapter is allowed to reach for. Injected rather than imported
 * so that a test can run a whole seam with a frozen clock and a fake secret
 * store, and so that no adapter can quietly acquire a database handle.
 */
export interface AdapterDeps {
  /** The clock. Injectable because a deterministic mock may never call `Date.now`. */
  readonly now: () => Date;
  /** Resolves a secret reference to its value. Returning `undefined` means the installation is misconfigured. */
  readonly resolveSecret: (reference: string) => Promise<string | undefined>;
  readonly emit: (event: AdapterEvent) => void;
  readonly log: (entry: AdapterLogEntry) => void;
}

/**
 * The configuration fields every seam shares.
 *
 * `credentialRef` and `callbackSecretRef` are references, not secrets: the
 * value they point at lives in the environment or a secret store, and the
 * config object itself is safe to keep in a plugin installation row, render in
 * an admin screen and include in a support bundle.
 */
export const adapterConfigBase = z.strictObject({
  vendorId: z.string().min(1).max(64),
  environment: z.enum(['sandbox', 'production']),
  /** Lookup key for the partner credential. Never the credential. */
  credentialRef: z.string().min(1).max(256),
  /** Lookup key for the inbound callback signing secret. */
  callbackSecretRef: z.string().min(1).max(256).optional(),
  /** Budget after which the seam reports {@link TimeoutAdapterError}. */
  timeoutMs: z.int().positive().max(600_000),
  baseUrl: z.url().optional(),
});

/** Inferred shape of {@link adapterConfigBase}; every seam config extends it. */
export type AdapterConfigBase = z.infer<typeof adapterConfigBase>;

/** An opaque partner or product reference. Bounded so a partner cannot make us store an essay. */
export const opaqueRef = z.string().min(1).max(128);

/**
 * Money, always in integer minor units. Floats are rejected at the schema so a
 * rounding error cannot enter the ledger through a partner's JSON.
 */
export const moneyMinorUnits = z.int().nonnegative();

/** An instant with an explicit offset, matching `ISODateTime` in `@openrunic/types`. */
export const isoDateTime = z.iso.datetime({ offset: true });

/**
 * Brands a `Date` as an {@link ISODateTime}. `toISOString` is defined to emit
 * the exact shape the brand promises, so this is a cast rather than a guard,
 * and callers get the branded type without a runtime check on a hot path.
 */
export function isoDateTimeOf(date: Date): ISODateTime {
  return date.toISOString() as ISODateTime;
}

// --- Contract registration --------------------------------------------------

/**
 * The input and output schema of one operation.
 *
 * The output schema is the load-bearing half: it is what
 * {@link MalformedResponseAdapterError} is decided against, so a vendor that
 * quietly changes a field shape fails at the seam instead of three layers
 * inward. The input schema exists for boundaries where the caller is untrusted,
 * such as a plugin host or a fixture loader; in-process callers get the same
 * guarantee from the compiler.
 */
export interface OperationSchema {
  readonly input: z.ZodType;
  readonly output: z.ZodType;
}

/** Operation name to schema pair, keyed by the method name on the seam's adapter interface. */
export type OperationSchemaMap = Readonly<Record<string, OperationSchema>>;

/**
 * One versioned seam, as data. Bundling the version, the config schema and the
 * operation schemas into one value is what lets the registry police version
 * compatibility and validate outputs without knowing which seam it holds.
 */
export interface CapabilityContract {
  readonly capability: Capability;
  readonly contractVersion: string;
  readonly config: z.ZodType;
  readonly operations: OperationSchemaMap;
  /** The catalogue of optional feature flags this seam defines; `supports` is a subset. */
  readonly features: readonly string[];
}

/**
 * The base every seam's adapter interface extends. Deliberately tiny: lifecycle
 * and inbound verification are the only things every partner has in common, and
 * everything else belongs to exactly one seam.
 */
export interface Adapter<TConfig> {
  readonly descriptor: CapabilityDescriptor;
  init(config: TConfig, deps: AdapterDeps): Promise<AdapterResult<void>>;
  healthCheck(): Promise<HealthStatus>;
  /**
   * Verifies an inbound callback's signature before anything reads its body.
   * Synchronous and returning a `Result`, because a route handler must be able
   * to reject an unsigned request without an await and without a try block.
   */
  verifyCallback(request: CallbackRequest): AdapterResult<VerifiedCallback>;
}

/** A parsed semver triple. Only `major` participates in compatibility, see {@link isMajorCompatible}. */
export interface ContractVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parses a contract version, returning `undefined` rather than throwing for
 * anything that is not a bare `major.minor.patch`. Pre-release and build
 * metadata are refused: a seam version is a compatibility promise between two
 * packages, and `1.0.0-rc.1` promises nothing.
 */
export function parseContractVersion(version: string): ContractVersion | undefined {
  const match = SEMVER_PATTERN.exec(version);
  if (match === null) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Whether an adapter built against `offered` may serve product code compiled
 * against `required`.
 *
 * Only the major has to match. A higher minor means the vendor implements
 * operations we do not call yet, and a lower minor means it implements every
 * operation we do call, because within a major a minor bump may only add. A
 * different major means a shape we call has changed, and no amount of runtime
 * care makes that safe.
 */
export function isMajorCompatible(required: ContractVersion, offered: ContractVersion): boolean {
  return required.major === offered.major;
}

/** Convenience alias for the failure arm a seam returns, used by adapter implementations. */
export type AdapterErr = Err<AdapterError>;
