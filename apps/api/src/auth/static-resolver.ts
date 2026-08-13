import type { Principal, PrincipalResolver } from './principal.js';

/**
 * The development and test stand-in for the OIDC token verifier.
 *
 * It maps opaque tokens to principals from an in-memory table. Real
 * authentication is an embedded OIDC provider issuing signed JWTs (plan
 * section 4.3); when it lands it implements the same
 * {@link PrincipalResolver} interface and is passed to `createApp` in place of
 * this one. Nothing else in the API changes, because nothing else in the API
 * knows how a token becomes a principal.
 *
 * Deliberately not hardened: the lookup is a plain map read, with no constant-
 * time comparison and no rate limiting, because the tokens it holds are public
 * fixtures. `createApp` refuses to install it under `NODE_ENV=production`.
 */
export function createStaticPrincipalResolver(
  table: ReadonlyMap<string, Principal>
): PrincipalResolver {
  return {
    resolve(token: string): Principal | null {
      return table.get(token) ?? null;
    },
  };
}

/** Organisation ids for the two demo tenants. Synthetic, fixed, and public. */
export const DEMO_TENANT_A = '01890000-0000-7000-8000-00000000000a';
export const DEMO_TENANT_B = '01890000-0000-7000-8000-00000000000b';

const DEMO_FACILITY_A = '01890000-0000-7000-8000-0000000000fa';
const DEMO_FACILITY_B = '01890000-0000-7000-8000-0000000000fb';

/**
 * Principals for local development and for the test suite. Two tenants exist on
 * purpose: cross-tenant isolation is only provable when there is a second
 * tenant to fail to reach.
 *
 * These tokens are not secrets and grant nothing anywhere: `createApp` refuses
 * to install this resolver when `NODE_ENV` is `production`.
 */
export const DEMO_PRINCIPALS: ReadonlyMap<string, Principal> = new Map<string, Principal>([
  [
    'dev-clinician-a',
    {
      subject: '01890000-0000-7000-8000-000000000101',
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      displayName: 'Dr. Adaeze Okafor',
      roles: ['clinician'],
      facilityIds: [DEMO_FACILITY_A],
      purposeOfUse: 'TREAT',
    },
  ],
  [
    'dev-frontdesk-a',
    {
      subject: '01890000-0000-7000-8000-000000000102',
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      displayName: 'Front Desk',
      roles: ['front-desk'],
      facilityIds: [DEMO_FACILITY_A],
      purposeOfUse: 'HOPERAT',
    },
  ],
  [
    'dev-biller-a',
    {
      subject: '01890000-0000-7000-8000-000000000103',
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      displayName: 'Billing',
      roles: ['biller'],
      facilityIds: [DEMO_FACILITY_A],
      purposeOfUse: 'HPAYMT',
    },
  ],
  [
    'dev-clinician-b',
    {
      subject: '01890000-0000-7000-8000-000000000201',
      tenantId: DEMO_TENANT_B,
      actorType: 'user',
      displayName: 'Dr. Rowan Vale',
      roles: ['clinician'],
      facilityIds: [DEMO_FACILITY_B],
      purposeOfUse: 'TREAT',
    },
  ],
]);

export { DEMO_FACILITY_A, DEMO_FACILITY_B };
