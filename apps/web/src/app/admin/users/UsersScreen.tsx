'use client';

import { Badge, Button, Card, Checkbox, Input, Select, Table, Tag, Toast } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  adminBreadcrumb,
  ConfirmDialog,
  DetailList,
  Drawer,
  FilterBar,
  PermissionMatrix,
  permissionKey,
  summariseRole,
} from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import {
  MOCK_FACILITIES,
  STAFF_ROLE_LABELS,
  STAFF_ROLES,
  useAdminClientOption,
  usePermissionMatrix,
  useStaffUsers,
} from '@/lib/api';
import type { AdminClient, PermissionRow, StaffRole, StaffStatus, StaffUser } from '@/lib/api';
import { formatCount, formatDateTime, NOT_RECORDED } from '@/lib/format';

/**
 * AD-01 Users and roles.
 *
 * The legacy failure this screen exists to avoid: the group, section and
 * sensitivity maze of inherited ACL libraries, which admins configured wrongly
 * and were never told. So a
 * role here is a named bundle with a plain-language summary, per-user grants
 * are labelled as exceptions rather than folded in silently, and nobody is ever
 * deleted: deactivation keeps the account resolvable from the audit trail.
 *
 * Writes: the demo client is read-only on purpose, so an invite or a
 * deactivation is held in this screen's own state and layered over the fetched
 * list. Against the live API these become mutations followed by a refetch; the
 * interaction, the confirmation and the toast are what this screen owns either
 * way.
 */

export interface UsersScreenProps {
  /** Injected by tests to force the empty, error and loading states. */
  client?: AdminClient;
}

const ROLE_OPTIONS = [
  { value: '', label: 'All roles' },
  ...STAFF_ROLES.map((role) => ({ value: role, label: STAFF_ROLE_LABELS[role] })),
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

const FACILITY_OPTIONS = [
  { value: '', label: 'All facilities' },
  ...MOCK_FACILITIES.map((facility) => ({ value: facility.id, label: facility.name })),
];

const COLUMNS: TableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'roles', header: 'Roles' },
  { key: 'facilities', header: 'Facilities' },
  { key: 'mfa', header: 'Two-factor' },
  { key: 'lastActive', header: 'Last active' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

const STATUS_TONE: Record<StaffStatus, 'success' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  INVITED: 'neutral',
  DEACTIVATED: 'neutral',
};

const STATUS_LABEL: Record<StaffStatus, string> = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  DEACTIVATED: 'Deactivated',
};

function facilityNames(ids: readonly string[]): string {
  const wanted = new Set(ids);
  const names: string[] = [];
  for (const facility of MOCK_FACILITIES) {
    if (wanted.has(facility.id)) names.push(facility.name);
  }
  return names.length > 0 ? names.join(', ') : NOT_RECORDED;
}

type DrawerView =
  { kind: 'none' } | { kind: 'invite' } | { kind: 'roles' } | { kind: 'user'; id: string };

interface InviteDraft {
  name: string;
  email: string;
  role: StaffRole;
  facilityIds: string[];
}

const EMPTY_INVITE: InviteDraft = {
  name: '',
  email: '',
  role: 'FRONT_DESK',
  facilityIds: [MOCK_FACILITIES[0]?.id ?? ''],
};

/**
 * The invite form.
 *
 * Split out because it is a form with its own draft, not part of the account
 * list around it, and because the role summary underneath has to be read next
 * to the role control that decides it.
 */
function InviteFields({
  invite,
  permissions,
  onChange,
}: Readonly<{
  invite: InviteDraft;
  permissions: readonly PermissionRow[] | null;
  onChange: (next: InviteDraft) => void;
}>): ReactElement {
  return (
    <div className="or-stack">
      <Input
        label="Full name"
        value={invite.name}
        onChange={(event) => onChange({ ...invite, name: event.target.value })}
        required
      />
      <Input
        label="Work email"
        type="email"
        value={invite.email}
        onChange={(event) => onChange({ ...invite, email: event.target.value })}
        required
      />
      <Select
        label="Role"
        options={STAFF_ROLES.map((entry) => ({
          value: entry,
          label: STAFF_ROLE_LABELS[entry],
        }))}
        value={invite.role}
        onChange={(event) => onChange({ ...invite, role: event.target.value as StaffRole })}
      />
      <fieldset className="or-fieldset">
        <legend className="or-overline">Facilities</legend>
        {MOCK_FACILITIES.map((facility) => (
          <Checkbox
            key={facility.id}
            label={facility.name}
            checked={invite.facilityIds.includes(facility.id)}
            onChange={() =>
              onChange({
                ...invite,
                facilityIds: invite.facilityIds.includes(facility.id)
                  ? invite.facilityIds.filter((id) => id !== facility.id)
                  : [...invite.facilityIds, facility.id],
              })
            }
          />
        ))}
      </fieldset>
      <p className="or-small">
        {permissions
          ? summariseRole([...permissions], invite.role, {})
          : 'The role summary appears once permissions load.'}
      </p>
    </div>
  );
}

function userRow(user: StaffUser, onOpen: (id: string) => void): Record<string, ReactNode> {
  return {
    id: user.id,
    name: (
      <span className="or-cell-stack">
        <span className="or-body">{user.name}</span>
        <span className="or-caption">{user.email}</span>
      </span>
    ),
    roles: (
      <span className="or-cell-chips">
        {user.roles.map((entry) => (
          <Tag key={entry}>{STAFF_ROLE_LABELS[entry]}</Tag>
        ))}
        {user.isProvider ? <Tag>Provider</Tag> : null}
      </span>
    ),
    facilities: <span className="or-small">{facilityNames(user.facilityIds)}</span>,
    mfa: user.mfaEnrolled ? (
      <Badge tone="success">Enrolled</Badge>
    ) : (
      <Badge tone="danger">Not enrolled</Badge>
    ),
    lastActive: (
      <span className="or-small">
        {user.lastActiveAt ? formatDateTime(user.lastActiveAt, 'dense') : 'Never'}
      </span>
    ),
    status: <Badge tone={STATUS_TONE[user.status]}>{STATUS_LABEL[user.status]}</Badge>,
    actions: (
      <Button size="sm" variant="ghost" onClick={() => onOpen(user.id)}>
        Open {user.name}
      </Button>
    ),
  };
}

/** The exceptions granted on top of this person's role, when there are any. */
function RoleExceptions({ user }: Readonly<{ user: StaffUser }>): ReactElement | null {
  if (user.exceptions.length === 0) return null;
  return (
    <div className="or-stack">
      <p className="or-overline">Exceptions</p>
      <ul className="or-list">
        {user.exceptions.map((exception) => (
          <li key={exception} className="or-small">
            {exception}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface UserDetailProps {
  user: StaffUser;
  roleSummary: string;
}

/**
 * The drawer body: who this person is, and what the system lets them do.
 *
 * The card passes `headingLevel={3}`: the drawer's own title is the h2 above it,
 * and the Card default of 2 would nest an h2 inside an h2.
 */
function UserDetail({ user, roleSummary }: Readonly<UserDetailProps>): ReactElement {
  return (
    <div className="or-stack">
      <DetailList
        items={[
          { label: 'Roles', value: user.roles.map((r) => STAFF_ROLE_LABELS[r]).join(', ') },
          { label: 'Facilities', value: facilityNames(user.facilityIds) },
          { label: 'Provider', value: user.isProvider ? 'Yes' : 'No' },
          { label: 'NPI', value: user.npi ?? NOT_RECORDED, mono: true },
          { label: 'Taxonomy', value: user.taxonomy ?? NOT_RECORDED },
          { label: 'Two-factor', value: user.mfaEnrolled ? 'Enrolled' : 'Not enrolled' },
          {
            label: 'Last active',
            value: user.lastActiveAt ? formatDateTime(user.lastActiveAt, 'prose') : 'Never',
          },
        ]}
      />

      <Card tone="bone" headingLevel={3} title="What this person can do">
        <p className="or-body">{roleSummary}</p>
        <RoleExceptions user={user} />
      </Card>
    </div>
  );
}

/**
 * The role editor: pick a role, read what it can do in a sentence, then change
 * the grid underneath.
 *
 * The sentence is the point. A permission grid alone is what let legacy admins
 * configure access wrongly and never find out, so the plain-language summary
 * sits above the checkboxes and is derived from the same overrides.
 */
function RoleEditor({
  permissions,
  roleFocus,
  grants,
  onRoleFocusChange,
  onToggle,
}: Readonly<{
  permissions: ReturnType<typeof usePermissionMatrix>;
  roleFocus: StaffRole;
  grants: Record<string, boolean>;
  onRoleFocusChange: (role: StaffRole) => void;
  onToggle: (capabilityId: string, role: StaffRole, allowed: boolean) => void;
}>): ReactElement {
  return (
    <AsyncBoundary
      state={permissions}
      subject="role permissions"
      isEmpty={(rows) => rows.length === 0}
      empty={{
        title: 'No capabilities are defined',
        message:
          'Roles have nothing to grant until the capability list is loaded. Reload the screen, and report it if the list stays empty.',
        icon: 'shield',
      }}
    >
      {(rows: PermissionRow[]) => (
        <div className="or-stack">
          <Select
            label="Summarise"
            hint="The sentence below describes the role you pick here."
            options={STAFF_ROLES.map((entry) => ({
              value: entry,
              label: STAFF_ROLE_LABELS[entry],
            }))}
            value={roleFocus}
            onChange={(event) => onRoleFocusChange(event.target.value as StaffRole)}
          />
          <Card tone="bone">
            <p className="or-body" data-testid="role-summary">
              {summariseRole(rows, roleFocus, grants)}
            </p>
          </Card>
          <PermissionMatrix
            rows={rows}
            roles={STAFF_ROLES}
            overrides={grants}
            onToggle={onToggle}
          />
        </div>
      )}
    </AsyncBoundary>
  );
}

/**
 * The account list and the four filters above it.
 *
 * Filters and table together because the filters are only meaningful next to
 * what they narrow, and the empty state has to name the filters as the reason
 * the list is empty rather than claiming the practice has no staff.
 */
function StaffAccounts({
  users,
  allUsers,
  search,
  role,
  status,
  facilityId,
  onSearchChange,
  onRoleChange,
  onStatusChange,
  onFacilityChange,
  onInvite,
  onOpenUser,
}: Readonly<{
  users: ReturnType<typeof useStaffUsers>;
  allUsers: readonly StaffUser[];
  search: string;
  role: StaffRole | '';
  status: StaffStatus | '';
  facilityId: string;
  onSearchChange: (value: string) => void;
  onRoleChange: (value: StaffRole | '') => void;
  onStatusChange: (value: StaffStatus | '') => void;
  onFacilityChange: (value: string) => void;
  onInvite: () => void;
  onOpenUser: (id: string) => void;
}>): ReactElement {
  return (
    <>
      <FilterBar
        label="Filter staff accounts"
        summary={users.data ? formatCount(allUsers.length, 'account') : null}
      >
        <Input
          label="Search"
          iconLeft="search"
          placeholder="Name or email"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(event) => onRoleChange(event.target.value as StaffRole | '')}
        />
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(event) => onStatusChange(event.target.value as StaffStatus | '')}
        />
        <Select
          label="Facility"
          options={FACILITY_OPTIONS}
          value={facilityId}
          onChange={(event) => onFacilityChange(event.target.value)}
        />
      </FilterBar>

      <AsyncBoundary
        state={users}
        subject="staff accounts"
        isEmpty={isEmptyList}
        empty={{
          title: 'No accounts match these filters',
          message:
            'Every account is filtered out by the current search, role, status or facility. Clear the filters, or invite the colleague you are looking for.',
          icon: 'users',
          action: (
            <Button variant="primary" onClick={onInvite}>
              Invite a colleague
            </Button>
          ),
        }}
      >
        {() => (
          <Table
            caption="Staff accounts"
            columns={COLUMNS}
            rows={allUsers.map((user) => userRow(user, onOpenUser))}
          />
        )}
      </AsyncBoundary>
    </>
  );
}

export function UsersScreen({ client }: Readonly<UsersScreenProps>): ReactElement {
  const options = useAdminClientOption(client);

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<StaffRole | ''>('');
  const [status, setStatus] = useState<StaffStatus | ''>('');
  const [facilityId, setFacilityId] = useState('');

  const [drawer, setDrawer] = useState<DrawerView>({ kind: 'none' });
  const [confirmUser, setConfirmUser] = useState<StaffUser | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* Local write overlay. See the file comment: the demo client does not accept
     writes, and a fixture that pretended to would teach the screen to trust
     state the server never saw. */
  const [deactivated, setDeactivated] = useState<string[]>([]);
  const [invited, setInvited] = useState<StaffUser[]>([]);

  const [roleFocus, setRoleFocus] = useState<StaffRole>('MEDICAL_ASSISTANT');
  const [grants, setGrants] = useState<Record<string, boolean>>({});

  const users = useStaffUsers(
    {
      q: search || undefined,
      role: role || undefined,
      status: status || undefined,
      facilityId: facilityId || undefined,
    },
    options
  );
  const permissions = usePermissionMatrix(options);

  const openInvite = useCallback(() => setDrawer({ kind: 'invite' }), []);
  const openRoles = useCallback(() => setDrawer({ kind: 'roles' }), []);
  const closeDrawer = useCallback(() => setDrawer({ kind: 'none' }), []);
  const showUnenrolled = useCallback(() => {
    setSearch('');
    setStatus('ACTIVE');
    setRole('');
    setFacilityId('');
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'admin.users.invite',
        group: 'actions',
        label: 'Invite a colleague',
        keywords: ['new user', 'add staff', 'onboard'],
        icon: 'user-plus',
        perform: openInvite,
      },
      {
        id: 'admin.users.roles',
        group: 'actions',
        label: 'Edit role permissions',
        keywords: ['acl', 'permissions', 'matrix', 'what can this role do'],
        icon: 'shield-check',
        perform: openRoles,
      },
      {
        id: 'admin.users.active',
        group: 'actions',
        label: 'Show active accounts only',
        keywords: ['filter', 'active users'],
        icon: 'filter',
        perform: showUnenrolled,
      },
    ],
    [openInvite, openRoles, showUnenrolled]
  );

  const applyOverlay = (rows: StaffUser[]): StaffUser[] => {
    const deactivatedIds = new Set(deactivated);
    return [...invited, ...rows].map((user) =>
      deactivatedIds.has(user.id)
        ? { ...user, status: 'DEACTIVATED' as StaffStatus, deactivatedAt: null }
        : user
    );
  };

  const confirmDeactivation = () => {
    if (!confirmUser) return;
    setDeactivated((previous) => [...previous, confirmUser.id]);
    setToast(`${confirmUser.name} can no longer sign in. The account is kept for the audit trail.`);
    setConfirmUser(null);
    setDrawer({ kind: 'none' });
  };

  const [invite, setInvite] = useState<InviteDraft>(EMPTY_INVITE);
  const sendInvite = () => {
    const trimmed = invite.name.trim();
    if (!trimmed || !invite.email.trim()) return;
    setInvited((previous) => [
      {
        id: `invited-${previous.length + 1}`,
        name: trimmed,
        displayName: trimmed,
        email: invite.email.trim(),
        roles: [invite.role],
        facilityIds: invite.facilityIds,
        isProvider: invite.role === 'PROVIDER',
        npi: null,
        taxonomy: null,
        mfaEnrolled: false,
        status: 'INVITED',
        lastActiveAt: null,
        invitedAt: null,
        deactivatedAt: null,
        exceptions: [],
      },
      ...previous,
    ]);
    setToast(`Invite sent to ${invite.email.trim()}. It expires in 7 days.`);
    setInvite(EMPTY_INVITE);
    setDrawer({ kind: 'none' });
  };

  const allUsers = users.data ? applyOverlay(users.data.data) : [];
  const selected =
    drawer.kind === 'user' ? (allUsers.find((user) => user.id === drawer.id) ?? null) : null;
  const unenrolled = allUsers.filter(
    (user) => user.status === 'ACTIVE' && !user.mfaEnrolled
  ).length;

  return (
    <AppShell
      title="Users and roles"
      description="Who works here, what they can do, and where they can do it."
      breadcrumb={adminBreadcrumb('Users and roles')}
      actions={
        <>
          <Button variant="secondary" iconLeft="shield-check" onClick={openRoles}>
            Edit role permissions
          </Button>
          <Button variant="primary" iconLeft="user-plus" onClick={openInvite}>
            Invite a colleague
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      {unenrolled > 0 ? (
        <Card className="or-notice" data-tone="serious">
          <p className="or-body">
            <strong>{unenrolled} active accounts have no second factor.</strong> Two-factor
            authentication is required for anyone who opens a chart. Ask them to enrol from their
            own account settings.
          </p>
        </Card>
      ) : null}

      <StaffAccounts
        users={users}
        allUsers={allUsers}
        search={search}
        role={role}
        status={status}
        facilityId={facilityId}
        onSearchChange={setSearch}
        onRoleChange={setRole}
        onStatusChange={setStatus}
        onFacilityChange={setFacilityId}
        onInvite={openInvite}
        onOpenUser={(id) => setDrawer({ kind: 'user', id })}
      />

      {/* ---- One account ---------------------------------------------- */}
      <Drawer
        open={selected !== null}
        title={selected?.name ?? ''}
        description={selected?.email}
        onClose={closeDrawer}
        meta={
          selected ? (
            <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
          ) : null
        }
        footer={
          selected ? (
            <>
              <Button variant="ghost" onClick={closeDrawer}>
                Close
              </Button>
              <Button
                variant="danger"
                disabled={selected.status === 'DEACTIVATED'}
                onClick={() => setConfirmUser(selected)}
              >
                Deactivate account
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <UserDetail
            user={selected}
            roleSummary={
              permissions.data
                ? summariseRole(permissions.data, selected.roles[0] ?? 'READ_ONLY', grants)
                : 'Loading the role summary.'
            }
          />
        ) : null}
      </Drawer>

      {/* ---- Invite ---------------------------------------------------- */}
      <Drawer
        open={drawer.kind === 'invite'}
        title="Invite a colleague"
        description="They set their own password and second factor from the invite link."
        onClose={closeDrawer}
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              Cancel
            </Button>
            <Button variant="primary" onClick={sendInvite}>
              Send invite
            </Button>
          </>
        }
      >
        <InviteFields invite={invite} permissions={permissions.data ?? null} onChange={setInvite} />
      </Drawer>

      {/* ---- Role editor ----------------------------------------------- */}
      <Drawer
        open={drawer.kind === 'roles'}
        title="Role permissions"
        description="Roles are named bundles. Change one here and it changes for everyone who holds it."
        width={720}
        onClose={closeDrawer}
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setToast('Role permissions saved. Everyone holding these roles is affected.');
                setDrawer({ kind: 'none' });
              }}
            >
              Save role permissions
            </Button>
          </>
        }
      >
        <RoleEditor
          permissions={permissions}
          roleFocus={roleFocus}
          grants={grants}
          onRoleFocusChange={setRoleFocus}
          onToggle={(capabilityId, entry, allowed) =>
            setGrants((previous) => ({
              ...previous,
              [permissionKey(capabilityId, entry)]: allowed,
            }))
          }
        />
      </Drawer>

      <ConfirmDialog
        open={confirmUser !== null}
        title={`Deactivate ${confirmUser?.name ?? ''}`}
        consequence="They can no longer sign in. Nothing they wrote is removed, and the account stays resolvable in the audit trail."
        confirmLabel="Deactivate account"
        typedConfirmation={confirmUser?.name}
        onCancel={() => setConfirmUser(null)}
        onConfirm={confirmDeactivation}
      >
        <p className="or-body">
          Open sessions end within a minute. Re-activating later restores the same roles.
        </p>
      </ConfirmDialog>

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="success" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}
