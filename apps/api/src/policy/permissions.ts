/**
 * The permission catalogue and the system role bundles.
 *
 * Permissions are atomic capabilities, one per aggregate per direction. They
 * are data rather than code so that the `Permission` table in
 * `packages/database` can carry the same list, tenants can fork the system
 * roles, and plugins can register their own capabilities later without a
 * change here becoming a schema change.
 */

export const PERMISSIONS = [
  'patient.read',
  'patient.write',
  'appointment.read',
  'appointment.write',
  'encounter.read',
  'encounter.write',
  'order.read',
  'order.write',
  'result.read',
  'result.write',
  'claim.read',
  'claim.write',
  'payment.read',
  'payment.write',
  'task.read',
  'task.write',
  'form.read',
  'form.write',
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
 * this map is the default that ships, and the only one the stub resolver knows.
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
    'order.read',
    'order.write',
    'result.read',
    'result.write',
    'task.read',
    'task.write',
    'form.read',
    'form.write',
  ],
  'front-desk': [
    'patient.read',
    'patient.write',
    'appointment.read',
    'appointment.write',
    'encounter.read',
    'task.read',
    'task.write',
    'form.read',
    'payment.read',
  ],
  biller: [
    'patient.read',
    'appointment.read',
    'encounter.read',
    'claim.read',
    'claim.write',
    'payment.read',
    'payment.write',
    'task.read',
    'task.write',
  ],
  'read-only': READ_EVERYTHING,
};

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
