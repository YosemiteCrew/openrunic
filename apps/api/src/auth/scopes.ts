/**
 * SMART on FHIR scope parsing and enforcement.
 *
 * A token's scope string is the only statement the authorization server makes
 * about *what* the bearer may touch, as opposed to *who* they are. This module
 * turns that string into a decision and nothing else: it never reads a request
 * body, never consults the database, and never widens a grant it failed to
 * understand.
 *
 * The interesting rule is the compartment ordering in
 * {@link grantedCompartment}. A token may legitimately carry both
 * `patient/Observation.read` and `user/Observation.read`, and the two say
 * different things: the first is bounded by the launch context, the second is
 * bounded only by the user's own permissions. Resolving such a token to the
 * wider compartment would turn an app launched against one chart into a
 * chart-wide reader, which is exactly the escalation the patient compartment
 * exists to prevent. So the narrowest compartment wins: a launch context that
 * names a patient is a restriction on the session, not a hint about which
 * chart to open first.
 */

/** Scope compartments, ordered narrowest first. The order is load-bearing. */
const SCOPE_COMPARTMENTS = ['patient', 'user', 'system'] as const;

export type ScopeCompartment = (typeof SCOPE_COMPARTMENTS)[number];

export type ScopeAction = 'create' | 'read' | 'update' | 'delete' | 'search';

export interface SmartScope {
  readonly raw: string;
  readonly compartment: ScopeCompartment;
  /** Resource type, or '*' meaning every resource type. */
  readonly resource: string;
  readonly actions: ReadonlySet<ScopeAction>;
}

export interface ScopeRequest {
  readonly resourceType: string;
  readonly action: ScopeAction;
}

const ALL_ACTIONS: readonly ScopeAction[] = ['create', 'read', 'update', 'delete', 'search'];

/** Version 2 permission letters. */
const ACTION_BY_LETTER: Readonly<Record<string, ScopeAction>> = {
  c: 'create',
  r: 'read',
  u: 'update',
  d: 'delete',
  s: 'search',
};

/**
 * Resource types are alphabetic in every FHIR release, so anything else is a
 * scope this process does not understand rather than a resource it has not
 * heard of yet.
 */
const RESOURCE_PATTERN = /^(?:\*|[A-Za-z]+)$/;

const COMPARTMENT_RANK: Readonly<Record<ScopeCompartment, number>> = {
  patient: 0,
  user: 1,
  system: 2,
};

function isCompartment(value: string): value is ScopeCompartment {
  // The widening cast is the point: SCOPE_COMPARTMENTS is typed as the narrow
  // union, and this predicate exists precisely to test a value that is not yet
  // known to be in it.
  return (SCOPE_COMPARTMENTS as readonly string[]).includes(value);
}

/**
 * Maps a permission part to the actions it grants, or null when it is not a
 * permission at all.
 *
 * Version 1 spells permissions as `read`, `write` or `*`; version 2 spells them
 * as letters drawn from `cruds`. The two vocabularies cannot collide, because
 * `read` and `write` both contain letters the version 2 alphabet does not, so
 * accepting both costs nothing in ambiguity. A repeated letter (`rr`) is
 * rejected rather than deduplicated: it is not a scope any conformant server
 * issues, and a scope that cannot be read the way its issuer wrote it must not
 * grant anything.
 */
function parseActions(permission: string): ReadonlySet<ScopeAction> | null {
  if (permission === '*') return new Set(ALL_ACTIONS);
  if (permission === 'read') return new Set<ScopeAction>(['read', 'search']);
  if (permission === 'write') return new Set<ScopeAction>(['create', 'update', 'delete']);

  const actions = new Set<ScopeAction>();
  for (const letter of permission) {
    const action = ACTION_BY_LETTER[letter];
    if (action === undefined || actions.has(action)) return null;
    actions.add(action);
  }
  return actions.size === 0 ? null : actions;
}

/**
 * Parses one scope string; returns null for anything that is not a resource
 * scope.
 *
 * The version 2 search-parameter filter (`patient/Observation.rs?category=lab`)
 * is split off and not interpreted. Filters are not enforced yet, so a filtered
 * scope currently decides exactly as its unfiltered form would: the filter can
 * only ever have narrowed the grant, and ignoring it is therefore a known
 * widening relative to what the issuer wrote. It is kept verbatim in `raw` so
 * an audit record shows the scope as issued, and enforcement belongs with the
 * search layer that owns those parameters rather than here.
 */
export function parseScope(value: string): SmartScope | null {
  const raw = value.trim();
  if (raw === '') return null;

  const filterStart = raw.indexOf('?');
  const grant = filterStart === -1 ? raw : raw.slice(0, filterStart);

  const slash = grant.indexOf('/');
  if (slash === -1) return null;

  const compartment = grant.slice(0, slash);
  if (!isCompartment(compartment)) return null;

  const remainder = grant.slice(slash + 1);
  const dot = remainder.indexOf('.');
  if (dot === -1) return null;

  const resource = remainder.slice(0, dot);
  if (!RESOURCE_PATTERN.test(resource)) return null;

  const actions = parseActions(remainder.slice(dot + 1));
  if (actions === null) return null;

  return { raw, compartment, resource, actions };
}

/** Parses a whitespace-separated scope string or a list of scope strings. */
export function parseScopes(value: string | Iterable<string>): SmartScope[] {
  const entries = typeof value === 'string' ? [value] : value;
  const parsed: SmartScope[] = [];

  for (const entry of entries) {
    for (const candidate of entry.split(/\s+/)) {
      const scope = parseScope(candidate);
      if (scope !== null) parsed.push(scope);
    }
  }

  return parsed;
}

function matches(scope: SmartScope, request: ScopeRequest): boolean {
  const resourceMatches = scope.resource === '*' || scope.resource === request.resourceType;
  return resourceMatches && scope.actions.has(request.action);
}

/** True when at least one scope grants the request. */
export function grantsScope(scopes: readonly SmartScope[], request: ScopeRequest): boolean {
  return scopes.some((scope) => matches(scope, request));
}

/**
 * The narrowest compartment that grants the request, or null when none does.
 * Ordering is patient < user < system, so a token holding both
 * `patient/Observation.read` and `user/Observation.read` resolves to `patient`
 * and is confined to its own compartment.
 */
export function grantedCompartment(
  scopes: readonly SmartScope[],
  request: ScopeRequest
): ScopeCompartment | null {
  let narrowest: ScopeCompartment | null = null;

  for (const scope of scopes) {
    if (!matches(scope, request)) continue;
    if (narrowest === null || COMPARTMENT_RANK[scope.compartment] < COMPARTMENT_RANK[narrowest]) {
      narrowest = scope.compartment;
    }
  }

  return narrowest;
}
