'use client';

import { Checkbox } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { PermissionRow, StaffRole } from '@/lib/api';
import { STAFF_ROLE_LABELS } from '@/lib/api';

/**
 * The role editor's permission matrix.
 *
 * The OpenEMR failure this exists to avoid: phpGACL's group and section maze,
 * which admins configured wrong and never found out. So every capability is a
 * sentence, every cell is a labelled checkbox rather than a coloured dot, and
 * the summary above the grid says in plain language what the selected role can
 * do. Policy is enforced at the data layer regardless of what this grid shows;
 * the grid is the readable statement of it.
 */

export interface PermissionMatrixProps {
  rows: PermissionRow[];
  roles: readonly StaffRole[];
  /** Editing state, keyed `<capabilityId>:<role>`. Absent falls back to the row. */
  overrides: Record<string, boolean>;
  onToggle: (capabilityId: string, role: StaffRole, allowed: boolean) => void;
  /** Read-only rendering for roles the signed-in admin cannot change. */
  disabled?: boolean;
}

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
  const can = rows.filter((row) => isAllowed(row, role, overrides));
  const cannot = rows.filter((row) => !isAllowed(row, role, overrides));
  const list = (items: PermissionRow[]) =>
    items.map((row) => row.capability.toLowerCase()).join(', ');

  if (can.length === 0) return 'This role can do nothing yet. Grant at least one capability.';
  const cannotSentence = cannot.length === 0 ? '' : ` Cannot ${list(cannot)}.`;
  return `Can ${list(can)}.${cannotSentence}`;
}

export function PermissionMatrix({
  rows,
  roles,
  overrides,
  onToggle,
  disabled = false,
}: PermissionMatrixProps): ReactElement {
  return (
    <div className="or-matrix">
      <table className="or-matrix__grid">
        <caption className="or-visually-hidden">
          Capabilities by role. Each cell is a checkbox naming its capability and role.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="or-matrix__capability">
              Capability
            </th>
            {roles.map((role) => (
              <th key={role} scope="col" className="or-matrix__role">
                {STAFF_ROLE_LABELS[role]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="or-matrix__capability">
                <span className="or-body">{row.capability}</span>
                <span className="or-caption or-matrix__description">{row.description}</span>
              </th>
              {roles.map((role) => {
                const allowed = isAllowed(row, role, overrides);
                return (
                  <td key={role} className="or-matrix__cell">
                    <Checkbox
                      checked={allowed}
                      disabled={disabled}
                      onChange={() => onToggle(row.id, role, !allowed)}
                      // The whole sentence, because a row of nine bare
                      // checkboxes is useless read aloud.
                      label={
                        <span className="or-visually-hidden">
                          {row.capability} for {STAFF_ROLE_LABELS[role]}
                        </span>
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
