/**
 * Who is making the request.
 *
 * The `Principal` is the only thing downstream middleware trusts. Nothing in
 * it is ever read from the request body, the query string or a client-supplied
 * header: it comes out of a {@link PrincipalResolver}, which is the seam that
 * the real OIDC/SMART verifier drops into later without any other file
 * changing.
 */

/** Kinds of principal the audit vocabulary distinguishes. */
export const ACTOR_TYPES = ['user', 'patient', 'service'] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

export interface Principal {
  /** Stable subject identifier: a User id for staff, a Patient id for portal. */
  subject: string;
  /**
   * The organisation this principal belongs to. Authoritative: the tenant-scope
   * middleware derives the query scope from this field and from nothing else.
   */
  tenantId: string;
  actorType: ActorType;
  /** Cached display label, so an audit trail survives a later rename. */
  displayName?: string;
  /** Role keys held, resolved to permissions by the policy layer. */
  roles: readonly string[];
  /** Facility grants. Empty means "no facility-scoped access" - it is not a wildcard. */
  facilityIds: readonly string[];
  /**
   * Raw SMART on FHIR scope strings, exactly as the token carried them.
   * Parsing and enforcement belong to `auth/scopes.ts`; storing the raw
   * strings means an audit record shows what was granted, not what this
   * process understood of it.
   */
  scopes: readonly string[];
  /**
   * Set when the token is patient-scoped. It is the *only* chart the principal
   * may ever reach: the tenant-scope middleware passes it to the repository
   * registry, so the compartment is a binding on the data access rather than a
   * check a handler performs.
   */
  compartmentPatientId?: string;
  /** HL7 PurposeOfUse asserted for the request, e.g. `TREAT`. */
  purposeOfUse: string;
  /** Emergency access outside normal policy; always paired with a reason. */
  breakglass?: boolean;
}

/**
 * Turns a bearer token into a principal.
 *
 * Implementations must be total and side-effect free from the caller's point of
 * view: return `null` for a token that does not resolve rather than throwing,
 * so the authn middleware owns the 401 and its audit record. The production
 * implementation will verify a signed JWT against the embedded OIDC provider's
 * JWKS; the middleware does not care which one it is holding.
 */
export interface PrincipalResolver {
  resolve(token: string): Promise<Principal | null> | Principal | null;
}

/** Reads a bearer token out of an `Authorization` header value. */
export function parseBearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer[ \t]+(?<token>[^\s]+)$/i.exec(header);
  return match?.groups?.token ?? null;
}
