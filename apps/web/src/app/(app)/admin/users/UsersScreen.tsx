'use client';

import { Badge, Button, Card, Checkbox, Input, Select, Table, Tag, Toast } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  Demonstration,
  DetailList,
  Drawer,
  FilterBar,
  PermissionMatrix,
  STAFF_ROLE_KEYS,
  adminArea,
  adminBreadcrumb,
  permissionKey,
  pluralKey,
  summariseRole,
  translateColumns,
} from '@/components/admin';
import type { Translator } from '@openrunic/i18n';
import type { AdminColumn } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import {
  MOCK_FACILITIES,
  STAFF_ROLES,
  useAdminClientOption,
  usePermissionMatrix,
  useStaffUsers,
} from '@/lib/api';
import type { AdminClient, PermissionRow, StaffRole, StaffStatus, StaffUser } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

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
 * Writes: there are none. The admin client is read-only, and so is the API
 * behind it - there is no endpoint for deactivating an account or for changing
 * what a role may do. Both controls used to hold the change in this screen's
 * own state and report it as done, which meant an administrator withdrawing
 * somebody's access was told it had been withdrawn by a screen that had not
 * asked anyone. They are disabled now and say so; see #178.
 *
 * An invite is still held locally and layered over the fetched list. That one
 * wastes somebody's time rather than creating risk, and it is on the same list
 * to be dealt with.
 */

export interface UsersScreenProps {
  /** Injected by tests to force the empty, error and loading states. */
  client?: AdminClient;
}

const COLUMNS: readonly AdminColumn[] = [
  { key: 'name', headerKey: 'admin.users.column.name' },
  { key: 'roles', headerKey: 'admin.users.column.roles' },
  { key: 'facilities', headerKey: 'admin.users.column.facilities' },
  { key: 'mfa', headerKey: 'admin.users.column.mfa' },
  { key: 'lastActive', headerKey: 'admin.users.column.lastActive' },
  { key: 'status', headerKey: 'admin.users.column.status' },
  { key: 'actions', headerKey: 'admin.users.column.actions', align: 'right' },
];

const ACCOUNT_COUNT = {
  oneKey: 'admin.users.accountCount.one',
  otherKey: 'admin.users.accountCount.other',
};

const STATUS_TONE: Record<StaffStatus, 'success' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  INVITED: 'neutral',
  DEACTIVATED: 'neutral',
};

/**
 * The status word, as keys rather than words: this table is module scope and
 * cannot know who is reading it. A literal map rather than a key assembled
 * from the status, because a key built at runtime is invisible to the drift
 * test and to whoever has to find it when it breaks.
 */
const STATUS_KEY: Record<StaffStatus, { labelKey: string }> = {
  ACTIVE: { labelKey: 'admin.users.status.active' },
  INVITED: { labelKey: 'admin.users.status.invited' },
  DEACTIVATED: { labelKey: 'admin.users.status.deactivated' },
};

/** The facilities a user is scoped to, as a list, or the words for none. */
function facilityNames(t: Translator, ids: readonly string[]): string {
  const wanted = new Set(ids);
  const names: string[] = [];
  for (const facility of MOCK_FACILITIES) {
    if (wanted.has(facility.id)) names.push(facility.name);
  }
  return names.length > 0 ? names.join(', ') : t('common.notRecorded');
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
  const t = useTranslator();

  return (
    <div className="or-stack">
      <Input
        label={t('admin.users.invite.name')}
        value={invite.name}
        onChange={(event) => onChange({ ...invite, name: event.target.value })}
        required
      />
      <Input
        label={t('admin.users.invite.email')}
        type="email"
        value={invite.email}
        onChange={(event) => onChange({ ...invite, email: event.target.value })}
        required
      />
      <Select
        label={t('admin.users.invite.role')}
        options={STAFF_ROLES.map((entry) => ({
          value: entry,
          label: t(STAFF_ROLE_KEYS[entry].labelKey),
        }))}
        value={invite.role}
        onChange={(event) => onChange({ ...invite, role: event.target.value as StaffRole })}
      />
      <fieldset className="or-fieldset">
        <legend className="or-overline">{t('admin.users.invite.facilities')}</legend>
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
          ? summariseRole(t, [...permissions], invite.role, {})
          : t('admin.users.invite.summaryPending')}
      </p>
    </div>
  );
}

function userRow(
  t: Translator,
  user: StaffUser,
  onOpen: (id: string) => void
): Record<string, ReactNode> {
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
          <Tag key={entry}>{t(STAFF_ROLE_KEYS[entry].labelKey)}</Tag>
        ))}
        {user.isProvider ? <Tag>{t('admin.users.provider')}</Tag> : null}
      </span>
    ),
    facilities: <span className="or-small">{facilityNames(t, user.facilityIds)}</span>,
    mfa: user.mfaEnrolled ? (
      <Badge tone="success">{t('admin.users.mfa.enrolled')}</Badge>
    ) : (
      <Badge tone="danger">{t('admin.users.mfa.notEnrolled')}</Badge>
    ),
    lastActive: (
      <span className="or-small">
        {user.lastActiveAt
          ? formatDateTime(t, user.lastActiveAt, 'dense')
          : t('admin.users.neverActive')}
      </span>
    ),
    status: <Badge tone={STATUS_TONE[user.status]}>{t(STATUS_KEY[user.status].labelKey)}</Badge>,
    actions: (
      <Button size="sm" variant="ghost" onClick={() => onOpen(user.id)}>
        {t('admin.users.openAccount', { name: user.name })}
      </Button>
    ),
  };
}

/** The exceptions granted on top of this person's role, when there are any. */
function RoleExceptions({ user }: Readonly<{ user: StaffUser }>): ReactElement | null {
  const t = useTranslator();
  if (user.exceptions.length === 0) return null;
  return (
    <div className="or-stack">
      <p className="or-overline">{t('admin.users.exceptions')}</p>
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
  const t = useTranslator();

  return (
    <div className="or-stack">
      <DetailList
        items={[
          {
            label: t('admin.users.detail.roles'),
            value: user.roles.map((r) => t(STAFF_ROLE_KEYS[r].labelKey)).join(', '),
          },
          { label: t('admin.users.detail.facilities'), value: facilityNames(t, user.facilityIds) },
          {
            label: t('admin.users.detail.provider'),
            value: user.isProvider ? t('admin.users.yes') : t('admin.users.no'),
          },
          {
            label: t('admin.users.detail.npi'),
            value: user.npi ?? t('common.notRecorded'),
            mono: true,
          },
          {
            label: t('admin.users.detail.taxonomy'),
            value: user.taxonomy ?? t('common.notRecorded'),
          },
          {
            label: t('admin.users.detail.mfa'),
            value: user.mfaEnrolled
              ? t('admin.users.mfa.enrolled')
              : t('admin.users.mfa.notEnrolled'),
          },
          {
            label: t('admin.users.detail.lastActive'),
            value: user.lastActiveAt
              ? formatDateTime(t, user.lastActiveAt, 'prose')
              : t('admin.users.neverActive'),
          },
        ]}
      />

      <Card tone="bone" headingLevel={3} title={t('admin.users.capabilities.title')}>
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
  const t = useTranslator();

  return (
    <AsyncBoundary
      state={permissions}
      subject={t('admin.users.roles.subject')}
      isEmpty={(rows) => rows.length === 0}
      empty={{
        title: t('admin.users.roles.empty.title'),
        message: t('admin.users.roles.empty.message'),
        icon: 'shield',
      }}
    >
      {(rows: PermissionRow[]) => (
        <div className="or-stack">
          <Select
            label={t('admin.users.roles.summarise')}
            hint={t('admin.users.roles.summariseHint')}
            options={STAFF_ROLES.map((entry) => ({
              value: entry,
              label: t(STAFF_ROLE_KEYS[entry].labelKey),
            }))}
            value={roleFocus}
            onChange={(event) => onRoleFocusChange(event.target.value as StaffRole)}
          />
          <Card tone="bone">
            <p className="or-body" data-testid="role-summary">
              {summariseRole(t, rows, roleFocus, grants)}
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
  const t = useTranslator();

  const roleOptions = [
    { value: '', label: t('admin.users.filter.allRoles') },
    ...STAFF_ROLES.map((entry) => ({ value: entry, label: t(STAFF_ROLE_KEYS[entry].labelKey) })),
  ];
  const statusOptions = [
    { value: '', label: t('admin.users.filter.allStatuses') },
    { value: 'ACTIVE', label: t('admin.users.status.active') },
    { value: 'INVITED', label: t('admin.users.status.invited') },
    { value: 'DEACTIVATED', label: t('admin.users.status.deactivated') },
  ];
  const facilityOptions = [
    { value: '', label: t('admin.users.filter.allFacilities') },
    ...MOCK_FACILITIES.map((facility) => ({ value: facility.id, label: facility.name })),
  ];

  return (
    <>
      <FilterBar
        label={t('admin.users.filter.label')}
        summary={
          users.data
            ? t(pluralKey(ACCOUNT_COUNT, allUsers.length, t.locale), { count: allUsers.length })
            : null
        }
      >
        <Input
          label={t('admin.users.filter.search')}
          iconLeft="search"
          placeholder={t('admin.users.filter.searchPlaceholder')}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <Select
          label={t('admin.users.filter.role')}
          options={roleOptions}
          value={role}
          onChange={(event) => onRoleChange(event.target.value as StaffRole | '')}
        />
        <Select
          label={t('admin.users.filter.status')}
          options={statusOptions}
          value={status}
          onChange={(event) => onStatusChange(event.target.value as StaffStatus | '')}
        />
        <Select
          label={t('admin.users.filter.facility')}
          options={facilityOptions}
          value={facilityId}
          onChange={(event) => onFacilityChange(event.target.value)}
        />
      </FilterBar>

      <AsyncBoundary
        state={users}
        subject={t('admin.users.subject')}
        isEmpty={isEmptyList}
        empty={{
          title: t('admin.users.empty.title'),
          message: t('admin.users.empty.message'),
          icon: 'users',
          action: (
            <Button variant="primary" onClick={onInvite}>
              {t('admin.users.invite.title')}
            </Button>
          ),
        }}
      >
        {() => (
          <Table
            caption={t('admin.users.tableCaption')}
            columns={translateColumns(t, COLUMNS)}
            rows={allUsers.map((user) => userRow(t, user, onOpenUser))}
          />
        )}
      </AsyncBoundary>
    </>
  );
}

export function UsersScreen({ client }: Readonly<UsersScreenProps>): ReactElement {
  const t = useTranslator();
  const options = useAdminClientOption(client);

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<StaffRole | ''>('');
  const [status, setStatus] = useState<StaffStatus | ''>('');
  const [facilityId, setFacilityId] = useState('');

  const [drawer, setDrawer] = useState<DrawerView>({ kind: 'none' });
  const [toast, setToast] = useState<string | null>(null);

  /* Local write overlay. See the file comment: the demo client does not accept
     writes, and a fixture that pretended to would teach the screen to trust
     state the server never saw. */

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
        label: t('admin.users.invite.title'),
        keywords: searchWords(t('admin.users.command.invite.keywords')),
        icon: 'user-plus',
        perform: openInvite,
      },
      {
        id: 'admin.users.roles',
        group: 'actions',
        label: t('admin.users.roles.edit'),
        keywords: searchWords(t('admin.users.command.roles.keywords')),
        icon: 'shield-check',
        perform: openRoles,
      },
      {
        id: 'admin.users.active',
        group: 'actions',
        label: t('admin.users.command.active'),
        keywords: searchWords(t('admin.users.command.active.keywords')),
        icon: 'filter',
        perform: showUnenrolled,
      },
    ],
    [openInvite, openRoles, showUnenrolled, t]
  );

  const [invite, setInvite] = useState<InviteDraft>(EMPTY_INVITE);

  /* Straight through. This used to have a locally-invited row and a locally-
     deactivated set layered on top, which is how the list came to agree with
     writes nobody had made. */
  const allUsers = users.data?.data ?? [];
  const selected =
    drawer.kind === 'user' ? (allUsers.find((user) => user.id === drawer.id) ?? null) : null;
  const unenrolled = allUsers.filter(
    (user) => user.status === 'ACTIVE' && !user.mfaEnrolled
  ).length;

  return (
    <AppShell
      title={t(adminArea('users').labelKey)}
      description={t('admin.users.description')}
      breadcrumb={adminBreadcrumb(t, 'users')}
      actions={
        <>
          <Button variant="secondary" iconLeft="shield-check" onClick={openRoles}>
            {t('admin.users.roles.edit')}
          </Button>
          <Button variant="primary" iconLeft="user-plus" onClick={openInvite}>
            {t('admin.users.invite.title')}
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      {unenrolled > 0 ? (
        <Card className="or-notice" data-tone="serious">
          <p className="or-body">
            <strong>{t('admin.users.mfaNotice.title', { count: unenrolled })}</strong>{' '}
            {t('admin.users.mfaNotice.body')}
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
            <Badge tone={STATUS_TONE[selected.status]}>
              {t(STATUS_KEY[selected.status].labelKey)}
            </Badge>
          ) : null
        }
        footer={
          selected ? (
            <>
              <Button variant="ghost" onClick={closeDrawer}>
                {t('admin.action.close')}
              </Button>
              {/* Disabled unconditionally, not only for an account already
                  marked deactivated. There is no endpoint behind this: it used
                  to write the id into local state and report the account
                  closed, so somebody withdrawing a colleague's access was told
                  it had been withdrawn by a screen that had asked nobody. */}
              <Button variant="danger" disabled>
                {t('admin.users.deactivate')}
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="or-stack">
            <Demonstration message={t('admin.users.deactivateNotBuilt')} />
            <UserDetail
              user={selected}
              roleSummary={
                permissions.data
                  ? summariseRole(t, permissions.data, selected.roles[0] ?? 'READ_ONLY', grants)
                  : t('admin.users.roles.summaryLoading')
              }
            />
          </div>
        ) : null}
      </Drawer>

      {/* ---- Invite ---------------------------------------------------- */}
      <Drawer
        open={drawer.kind === 'invite'}
        title={t('admin.users.invite.title')}
        description={t('admin.users.invite.description')}
        onClose={closeDrawer}
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              {t('admin.action.cancel')}
            </Button>
            {/* Disabled: nothing is sent. This built a row in this component's
                own state and reported the invitation as delivered, so a
                colleague who never got an email appeared on the list as
                invited. */}
            <Button variant="primary" disabled>
              {t('admin.users.invite.send')}
            </Button>
          </>
        }
      >
        <div className="or-stack">
          <Demonstration message={t('admin.users.inviteNotBuilt')} />
          <InviteFields
            invite={invite}
            permissions={permissions.data ?? null}
            onChange={setInvite}
          />
        </div>
      </Drawer>

      {/* ---- Role editor ----------------------------------------------- */}
      <Drawer
        open={drawer.kind === 'roles'}
        title={t('admin.users.roles.title')}
        description={t('admin.users.roles.description')}
        width={720}
        onClose={closeDrawer}
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              {t('admin.action.cancel')}
            </Button>
            {/* Disabled: editing what a role may do reaches no policy. It used
                to close the drawer and report that everyone holding the role was
                affected, while `grants` stayed in this component and authorisation
                stayed exactly as it was. */}
            <Button variant="primary" disabled>
              {t('admin.users.roles.save')}
            </Button>
          </>
        }
      >
        <Demonstration message={t('admin.users.rolePermissionsNotBuilt')} />
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

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="success" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}
