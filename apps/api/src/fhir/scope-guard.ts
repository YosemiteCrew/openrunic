import { createMiddleware } from 'hono/factory';

import {
  grantedCompartment,
  grantsScope,
  parseScopes,
  type ScopeAction,
  type ScopeCompartment,
} from '../auth/scopes.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';

/**
 * SMART scope enforcement at the FHIR boundary.
 *
 * Two questions are asked, in this order, and they are genuinely different.
 * The first is whether the token was granted the resource type and the verb at
 * all; the answer is a 403, because the caller could have asked for that scope
 * and did not. The second is which compartment the grant came from, and that
 * one does not produce an error at all: a patient compartment becomes a
 * narrowing on the data the request can reach, applied by binding the
 * repositories to the launch context in the audit middleware.
 *
 * Making the narrowing structural rather than a check here is the whole design.
 * A guard that filtered results would have to be remembered by every future
 * handler and would be wrong the first time one forgot; a repository that
 * cannot name another chart is wrong nowhere.
 *
 * The role permission is still required on top of the scope. A scope says what
 * the *application* was authorised to ask for; a permission says what the
 * *principal* may do. An app holding `user/Patient.write` on behalf of a
 * read-only clerk must still be refused, and only the permission layer knows
 * that.
 */

/** The narrowing a granted scope implies for the request. */
export interface ScopeDecision {
  readonly compartment: ScopeCompartment;
  /** The chart the request is confined to, when the grant was patient-scoped. */
  readonly compartmentPatientId?: string;
}

export function decideScope(
  scopes: readonly string[],
  compartmentPatientId: string | undefined,
  resourceType: string,
  action: ScopeAction
): ScopeDecision {
  const parsed = parseScopes(scopes);

  if (!grantsScope(parsed, { resourceType, action })) {
    throw ApiError.forbidden(`This token holds no scope permitting ${action} on ${resourceType}.`, {
      fhirIssueCode: 'forbidden',
    });
  }

  const compartment = grantedCompartment(parsed, { resourceType, action }) ?? 'user';
  if (compartment === 'patient' && compartmentPatientId === undefined) {
    // A patient scope with no launch context names a compartment nobody can
    // identify. Serving it as if it were a user scope would silently widen the
    // grant to the whole organisation, which is the one outcome the patient
    // prefix exists to prevent.
    throw ApiError.forbidden(
      'This token is patient-scoped but carries no launch context, so there is no compartment to confine it to.',
      { fhirIssueCode: 'forbidden' }
    );
  }

  return {
    compartment,
    ...(compartmentPatientId === undefined ? {} : { compartmentPatientId }),
  };
}

/** Route guard: the token must hold a scope for `resourceType` and `action`. */
export function requireScope(resourceType: string, action: ScopeAction) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.get('principal');
    if (principal === undefined) {
      throw ApiError.unauthenticated('A bearer token is required.');
    }

    const decision = decideScope(
      principal.scopes,
      principal.compartmentPatientId,
      resourceType,
      action
    );

    // Recorded on the request so a denial, and the audit event that follows it,
    // can say which compartment the grant resolved to rather than only that one
    // existed.
    c.set('scopeCompartment', decision.compartment);
    await next();
  });
}
