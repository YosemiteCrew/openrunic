import { withTenantSession, type PrismaClient } from '@openrunic/database';
import { demoOrganisationId } from '@openrunic/database/seed';

import type { Principal, PrincipalResolver } from '../auth/principal.js';

/**
 * Demo tokens bound to the tenant that was actually seeded.
 *
 * `DEMO_PRINCIPALS` in auth/static-resolver.ts hardcodes a tenant id, and the
 * seed mints its own from a fixed UUIDv7 clock. The two are different values,
 * so a self-hosted stack wired to the static table authenticates successfully
 * and then shows an empty practice: every query is scoped to a tenant that owns
 * no rows. The stack looks healthy and has nothing in it, which is the most
 * expensive kind of broken.
 *
 * This resolver closes that gap from the deployment side rather than by editing
 * the fixtures. It looks the demo organisation up by its slug and maps each
 * token onto a real seeded user in that tenant. Nothing is invented: if the
 * demo practice was never seeded, every token fails to resolve and the API
 * answers 401, which is the correct behaviour for a deployment that has no
 * identity provider and no demo data.
 */

/** The slug the seed gives the demo practice. */
export const DEMO_ORGANISATION_SLUG = 'runic-demo-practice';

interface DemoTokenSpec {
  readonly token: string;
  readonly email: string;
  readonly roles: readonly string[];
  /** HL7 PurposeOfUse asserted for everything this token does. */
  readonly purposeOfUse: string;
  /**
   * SMART on FHIR scopes, stated per token rather than derived from the roles.
   *
   * Roles decide what the product offers; scopes decide what the API allows,
   * and the two are deliberately not the same list. Writing them out here keeps
   * a demo token from quietly gaining reach because someone added a role name
   * to a mapping table somewhere else.
   */
  readonly scopes: readonly string[];
}

/**
 * The tokens the installer prints.
 *
 * They are not secrets and are not treated as such: they are published here, in
 * the repository, and the API prints a warning naming the deployment as
 * unauthenticated for as long as this resolver is installed.
 */
export const DEMO_TOKENS: readonly DemoTokenSpec[] = [
  {
    token: 'dev-clinician-a',
    email: 'a.okafor@demo.invalid',
    roles: ['clinician'],
    purposeOfUse: 'TREAT',
    scopes: ['user/*.read', 'user/*.write'],
  },
  {
    token: 'dev-frontdesk-a',
    email: 'f.deskly@demo.invalid',
    roles: ['front-desk'],
    purposeOfUse: 'HOPERAT',
    scopes: ['user/*.read', 'user/*.write'],
  },
  {
    token: 'dev-biller-a',
    email: 'r.claimsworth@demo.invalid',
    roles: ['biller'],
    purposeOfUse: 'HPAYMT',
    scopes: ['user/*.read', 'user/*.write'],
  },
];

/**
 * Builds the token table once and caches it.
 *
 * The lookup is deferred to the first request rather than done at construction
 * because the API container can win the race against the seed on a first boot,
 * and a resolver that cached "no demo tenant" at startup would keep answering
 * 401 for the life of the process.
 */
export function createDemoPrincipalResolver(client: PrismaClient): PrincipalResolver {
  let table: Map<string, Principal> | null = null;

  /**
   * THE ONE READ THIS SYSTEM CANNOT MAKE BY QUERYING.
   *
   * Row-level security is on for every table including `Organisation`, and that
   * table's policy keys on `id` - so a connection that has not declared a tenant
   * sees no organisations at all, not even to look one up by slug. This used to
   * do exactly that lookup, and it worked only because the API connected as the
   * superuser initdb creates, which bypasses every policy. Giving the API its
   * own role broke the lookup, and rightly: it was reading across the boundary
   * the policies exist to draw.
   *
   * A deployment with a real identity provider never has this problem - the
   * organisation comes out of the verified token. The demo mode has no token to
   * read one from, so the id arrives another way: `demoOrganisationId()` derives
   * it from the same pure builder the seed writes from, and `seedDemoPractice`
   * refuses to write a practice under any other id.
   *
   * The slug stays in the `where`. It is no longer how the practice is found,
   * but it is how a database seeded by something else is told apart from this
   * one: no row, no principals, 401 - the right answer for a deployment with no
   * identity provider and no demo data.
   */
  const load = async (): Promise<Map<string, Principal>> => {
    const organisation = await withTenantSession(
      client,
      { tenantId: demoOrganisationId() },
      async (tx) =>
        tx.organisation.findFirst({
          where: { slug: DEMO_ORGANISATION_SLUG },
          select: {
            id: true,
            facilities: { select: { id: true } },
            users: {
              where: { email: { in: DEMO_TOKENS.map((spec) => spec.email) } },
              // The User model stores the parts, not a composed label: there is
              // no displayName column, because a person's name is not one
              // string.
              select: {
                id: true,
                email: true,
                givenName: true,
                familyName: true,
                credential: true,
              },
            },
          },
        })
    );

    const resolved = new Map<string, Principal>();
    if (organisation === null) return resolved;

    const facilityIds = organisation.facilities.map((facility) => facility.id);

    for (const spec of DEMO_TOKENS) {
      const user = organisation.users.find((candidate) => candidate.email === spec.email);
      if (user === undefined) continue;

      // The audit trail caches this label so a later rename cannot rewrite
      // history, which is why it is composed here rather than looked up later.
      const credential = user.credential === null ? '' : `, ${user.credential}`;

      resolved.set(spec.token, {
        subject: user.id,
        tenantId: organisation.id,
        actorType: 'user',
        displayName: `${user.givenName} ${user.familyName}${credential}`,
        roles: spec.roles,
        scopes: spec.scopes,
        facilityIds,
        purposeOfUse: spec.purposeOfUse,
      });
    }

    return resolved;
  };

  return {
    async resolve(token: string): Promise<Principal | null> {
      // Only a successful, non-empty load is cached. An empty result means the
      // seed has not finished, and that must stay retryable.
      if (table === null || table.size === 0) {
        table = await load();
      }
      return table.get(token) ?? null;
    },
  };
}
