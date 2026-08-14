import type { PermissionRow, StaffRole } from '@/lib/api';

/**
 * What a role may do, as data.
 *
 * Kept apart from the grid that renders it because the same answers are needed
 * by the screen (to summarise a role in a sentence) and by the cells, and
 * because policy that can only be evaluated by mounting a component cannot be
 * tested the way policy should be.
 */

export function permissionKey(capabilityId: string, role: StaffRole): string {
  return `${capabilityId}:${role}`;
}

export function isAllowed(
  row: PermissionRow,
  role: StaffRole,
  overrides: Record<string, boolean>
): boolean {
  return overrides[permissionKey(row.id, role)] ?? row.roles[role] === 'ALLOW';
}

/** "Can view charts, edit charts and sign notes. Cannot work claims." */
export function summariseRole(
  rows: PermissionRow[],
  role: StaffRole,
  overrides: Record<string, boolean>
): string {
  const can: PermissionRow[] = [];
  const cannot: PermissionRow[] = [];
  for (const row of rows) {
    if (isAllowed(row, role, overrides)) can.push(row);
    else cannot.push(row);
  }
  const list = (items: PermissionRow[]) =>
    items.map((row) => row.capability.toLowerCase()).join(', ');

  if (can.length === 0) return 'This role can do nothing yet. Grant at least one capability.';
  const cannotSentence = cannot.length === 0 ? '' : ` Cannot ${list(cannot)}.`;
  return `Can ${list(can)}.${cannotSentence}`;
}
