'use client';

import { Checkbox } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { PermissionRow, StaffRole } from '@/lib/api';
import { STAFF_ROLE_LABELS } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

import { isAllowed } from './permissions';

/**
 * The role editor's permission matrix.
 *
 * The legacy failure this exists to avoid: the group and section maze of
 * inherited ACL libraries, which admins configured wrong and never found out. So every capability is a
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

export function PermissionMatrix({
  rows,
  roles,
  overrides,
  onToggle,
  disabled = false,
}: Readonly<PermissionMatrixProps>): ReactElement {
  const t = useTranslator();

  return (
    <div className="or-matrix">
      <table className="or-matrix__grid">
        <caption className="or-visually-hidden">{t('admin.permissions.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" className="or-matrix__capability">
              {t('admin.permissions.capabilityColumn')}
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
                      // checkboxes is useless read aloud. The capability and
                      // the role name are values rather than words this screen
                      // owns, so they go into the message as placeholders.
                      label={
                        <span className="or-visually-hidden">
                          {t('admin.permissions.cellLabel', {
                            capability: row.capability,
                            role: STAFF_ROLE_LABELS[role],
                          })}
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
