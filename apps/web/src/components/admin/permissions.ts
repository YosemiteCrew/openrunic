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

/**
 * "Can view charts, edit charts and sign notes. Cannot work claims."
 *
 * Takes the translator because the sentence is read by a person and this is
 * not a component, so there is no hook to reach for. Two whole sentences
 * rather than one assembled from clauses: "Can" and "Cannot" are not
 * interchangeable prefixes in every language, and a sentence built from
 * fragments cannot be translated correctly by whoever is handed the catalogue.
 *
 * The capability names inside them are not translated. They arrive from the
 * API already named, and putting a second name on a capability that already
 * has one is how a grid and a policy engine end up disagreeing in words.
 */
export function summariseRole(
  translate: (key: string, values?: Readonly<Record<string, string>>) => string,
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

  if (can.length === 0) return translate('admin.permissions.none');
  const cannotSentence =
    cannot.length === 0
      ? ''
      : ` ${translate('admin.permissions.cannot', { capabilities: list(cannot) })}`;
  return `${translate('admin.permissions.can', { capabilities: list(can) })}${cannotSentence}`;
}
