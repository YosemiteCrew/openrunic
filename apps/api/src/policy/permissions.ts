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
  'read-only': READ_EVERYTHING,
};

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
