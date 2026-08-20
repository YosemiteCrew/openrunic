/**
 * The permission catalogue and the system role bundles.
 *
 * Permissions are atomic capabilities, one per aggregate per direction. They
 * are data rather than code so that the `Permission` table in
 * `packages/database` can carry the same list, tenants can fork the system
 * roles, and plugins can register their own capabilities later without a
 * change here becoming a schema change.
 *
 * The split is by aggregate rather than by screen. A permission that meant
 * "can open the billing screen" would have to be re-decided the first time a
 * charge appeared anywhere else, and the second place is always the one that
 * gets it wrong.
 */

export const PERMISSIONS = [
  'patient.read',
  'patient.write',
  'appointment.read',
  'appointment.write',
  'encounter.read',
  'encounter.write',
  'document.read',
  'document.write',
  'order.read',
  'order.write',
  'result.read',
  'result.write',
  'message.read',
  'message.write',
  'coverage.read',
  'coverage.write',
  'charge.read',
  'charge.write',
  'claim.read',
  'claim.write',
  'payment.read',
  'payment.write',
  'task.read',
  'task.write',
  'form.read',
  'form.write',
  'user.read',
  'user.write',
  'role.read',
  'role.write',
  'facility.read',
  'facility.write',
  'terminology.read',
  'terminology.write',
  /** The catalogue, the lots, the postings and the ledger, all read-only. */
  'inventory.read',
  /**
   * The stockroom's ordinary day: booking in a delivery, dispensing against a
   * prescription, administering a dose, and discarding the remainder of a drawn
   * vial. Its own aggregate rather than a borrowed `order.write`, because a
   * role that had to hold `order.write` to put a box on a shelf would also be
   * able to prescribe.
   */
  'inventory.write',
  /**
   * The privileged half: reconciling a physical count against the ledger. What
   * makes a stock ledger defensible is that the person who dispenses is not the
   * person who reconciles the difference away, so the count is a separate grant
   * rather than more of `inventory.write`.
   *
   * A third permission on one aggregate, which the one-per-direction convention
   * above does not anticipate - for the same reason `audit.read` is its own
   * entry. Wasting a drawn dose deliberately stays under `inventory.write`:
   * it happens several times a day, and putting it here would mean fetching an
   * administrator on the first shift.
   */
  'inventory.adjust',
  /** Reading the audit log is itself privileged, and is itself audited. */
  'audit.read',
  /**
   * Organisation-wide facility access. Without it a principal reaches only the
   * facilities named in its grants, so an empty grant list denies rather than
   * permits.
   */
  'facility.all',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_EVERYTHING: readonly Permission[] = PERMISSIONS.filter(
  (permission): permission is Permission => permission.endsWith('.read')
);

/**
 * The seeded system roles. A tenant may fork these into its own `Role` rows;
 * this map is the default that ships, and the only one the static resolver
 * knows.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  admin: PERMISSIONS,
  /**
   * Everything an administrator can do, at one site.
   *
   * Exists because `admin` holds `facility.all` and therefore never exercises
   * the facility narrowing on reads. A deployment that wants a site manager
   * rather than an organisation administrator wants this role, and the test
   * suite needs it to prove the narrowing works at all.
   */
  'site-admin': PERMISSIONS.filter((permission) => permission !== 'facility.all'),
  clinician: [
    'patient.read',
    'patient.write',
    'appointment.read',
    'appointment.write',
    'encounter.read',
    'encounter.write',
    'document.read',
    'document.write',
    'order.read',
    'order.write',
    'result.read',
    'result.write',
    'message.read',
    'message.write',
    'coverage.read',
    'charge.read',
    'charge.write',
    'task.read',
    'task.write',
    'form.read',
    'form.write',
    'user.read',
    'facility.read',
    'terminology.read',
    // A clinician draws stock and records what left the shelf; reconciling a
    // count against the ledger is somebody else's job by design.
    'inventory.read',
    'inventory.write',
  ],
  'front-desk': [
    'patient.read',
    'patient.write',
    'appointment.read',
    'appointment.write',
    'encounter.read',
    'document.read',
    'document.write',
    'message.read',
    'message.write',
    'coverage.read',
    'coverage.write',
    'task.read',
    'task.write',
    'form.read',
    'payment.read',
    'user.read',
    'facility.read',
    'terminology.read',
    // The front desk answers "have we got any left" and books nothing in.
    'inventory.read',
  ],
  biller: [
    'patient.read',
    'appointment.read',
    'encounter.read',
    'document.read',
    'coverage.read',
    'coverage.write',
    'charge.read',
    'charge.write',
    'claim.read',
    'claim.write',
    'payment.read',
    'payment.write',
    'task.read',
    'task.write',
    'user.read',
    'facility.read',
    'terminology.read',
  ],
  /**
   * The portal. It looks like a thin staff role, and the thing that makes it
   * safe is not this list: it is the launch context on the token, which binds
   * every repository the request touches to one chart.
   */
  'patient-portal': [
    'patient.read',
    'appointment.read',
    'appointment.write',
    'encounter.read',
    'document.read',
    'result.read',
    'message.read',
    'message.write',
    'coverage.read',
    'form.read',
    'form.write',
    'payment.read',
  ],
  /**
   * The person who runs the stockroom, and nothing else.
   *
   * It exists so that the monthly cycle count is not an administrative act.
   * Without this role the only bundle holding `inventory.adjust` is `admin`,
   * which holds everything - so counting the shelf would mean handing the
   * practice's most privileged token to whoever is standing in front of it, and
   * "fork a Role" would be the answer to a job every practice has.
   */
  'stock-keeper': ['inventory.read', 'inventory.write', 'inventory.adjust', 'facility.read'],
  'read-only': READ_EVERYTHING,
};

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
