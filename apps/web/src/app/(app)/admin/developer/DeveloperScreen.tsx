'use client';

import { Badge, Button, Card, Checkbox, Input, Select, Table, Tag, Toast } from '@openrunic/ui';
import type { BadgeTone } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  adminArea,
  adminBreadcrumb,
  ConfirmDialog,
  DetailList,
  Drawer,
  TabPanel,
  Tabs,
  translateColumns,
} from '@/components/admin';
import type { AdminColumn } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import {
  MOCK_NEW_KEY_DISPLAY,
  useAdminClientOption,
  useApiKeys,
  useApiScopes,
  useSmartApps,
  useWebhooks,
} from '@/lib/api';
import type { AdminClient, ApiKey, SmartApp, Webhook, WebhookDelivery } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * DV-01 to DV-03, on one screen with three sections.
 *
 * Legacy developer platforms lived in server globals with wiki-guided
 * steps, and debugging a SMART launch meant reading server logs. Here
 * registration is a product flow with the secret discipline built in (shown
 * once, never retrievable, revocable without deletion), and every launch and
 * every webhook delivery is visible with its outcome translated into a
 * sentence. Delivery observability is the product.
 */

export interface DeveloperScreenProps {
  client?: AdminClient;
}

type SectionId = 'keys' | 'apps' | 'webhooks';

/** What a translator does, for the helpers below that are not components. */
type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

const KEY_COLUMNS: readonly AdminColumn[] = [
  { key: 'label', headerKey: 'admin.developer.keys.column.key' },
  { key: 'scopes', headerKey: 'admin.developer.keys.column.scopes' },
  { key: 'created', headerKey: 'admin.developer.keys.column.created' },
  { key: 'lastUsed', headerKey: 'admin.developer.keys.column.lastUsed' },
  { key: 'status', headerKey: 'admin.developer.keys.column.status' },
  { key: 'actions', headerKey: 'admin.developer.keys.column.actions', align: 'right' },
];

const APP_COLUMNS: readonly AdminColumn[] = [
  { key: 'name', headerKey: 'admin.developer.apps.column.app' },
  { key: 'launch', headerKey: 'admin.developer.apps.column.launch' },
  { key: 'scopes', headerKey: 'admin.developer.apps.column.scopes' },
  { key: 'lastLaunch', headerKey: 'admin.developer.apps.column.lastLaunch' },
  { key: 'status', headerKey: 'admin.developer.apps.column.status' },
  { key: 'actions', headerKey: 'admin.developer.apps.column.actions', align: 'right' },
];

const HOOK_COLUMNS: readonly AdminColumn[] = [
  { key: 'event', headerKey: 'admin.developer.hooks.column.event' },
  { key: 'endpoint', headerKey: 'admin.developer.hooks.column.endpoint' },
  { key: 'health', headerKey: 'admin.developer.hooks.column.health' },
  { key: 'status', headerKey: 'admin.developer.hooks.column.status' },
  { key: 'actions', headerKey: 'admin.developer.hooks.column.actions', align: 'right' },
];

const DELIVERY_COLUMNS: readonly AdminColumn[] = [
  { key: 'at', headerKey: 'admin.developer.deliveries.column.when' },
  { key: 'event', headerKey: 'admin.developer.deliveries.column.event' },
  { key: 'code', headerKey: 'admin.developer.deliveries.column.response', numeric: true },
  { key: 'latency', headerKey: 'admin.developer.deliveries.column.latency', numeric: true },
  { key: 'attempt', headerKey: 'admin.developer.deliveries.column.attempt', numeric: true },
  { key: 'outcome', headerKey: 'admin.developer.deliveries.column.outcome' },
];

/**
 * Every status a developer sees is a word, and the word is decided in one
 * place. A lookup keeps the three tables and the two drawers from drifting
 * apart on what "FAILING" is called.
 */
const HOOK_STATUS: Record<Webhook['status'], { tone: BadgeTone; labelKey: string }> = {
  ACTIVE: { tone: 'success', labelKey: 'admin.developer.hookStatus.active' },
  FAILING: { tone: 'danger', labelKey: 'admin.developer.hookStatus.failing' },
  PAUSED: { tone: 'neutral', labelKey: 'admin.developer.hookStatus.paused' },
};

const DELIVERY_OUTCOME: Record<WebhookDelivery['outcome'], { tone: BadgeTone; labelKey: string }> =
  {
    DELIVERED: { tone: 'success', labelKey: 'admin.developer.delivery.delivered' },
    FAILED: { tone: 'danger', labelKey: 'admin.developer.delivery.failed' },
    RETRYING: { tone: 'neutral', labelKey: 'admin.developer.delivery.retrying' },
  };

function HookStatusBadge({ status }: Readonly<{ status: Webhook['status'] }>): ReactElement {
  const t = useTranslator();
  const { tone, labelKey } = HOOK_STATUS[status];
  return <Badge tone={tone}>{t(labelKey)}</Badge>;
}

/** Toggle a value in a scope selection without mutating the previous array. */
function toggleScope(previous: readonly string[], id: string): string[] {
  if (previous.includes(id)) {
    return previous.filter((entry) => entry !== id);
  }
  return [...previous, id];
}

const LAUNCH_KEY: Record<SmartApp['launchType'], string> = {
  EHR: 'admin.developer.launch.ehr',
  STANDALONE: 'admin.developer.launch.standalone',
};

function chipList(values: readonly string[]): ReactElement {
  return (
    <span className="or-cell-chips">
      {values.map((value) => (
        <Tag key={value} mono>
          {value}
        </Tag>
      ))}
    </span>
  );
}

function keyRow(
  t: Translate,
  key: ApiKey,
  onRevoke: (key: ApiKey) => void
): Record<string, ReactNode> {
  return {
    id: key.id,
    label: (
      <span className="or-cell-stack">
        <span className="or-body">{key.label}</span>
        <span className="or-caption or-mono">{key.prefix}...</span>
      </span>
    ),
    scopes: chipList(key.scopes),
    created: <span className="or-small">{formatDateTime(key.createdAt, 'dense')}</span>,
    lastUsed: (
      <span className="or-small">
        {key.lastUsedAt
          ? formatDateTime(key.lastUsedAt, 'dense')
          : t('admin.developer.keys.neverUsed')}
      </span>
    ),
    status:
      key.status === 'ACTIVE' ? (
        <Badge tone="success">{t('admin.developer.keys.active')}</Badge>
      ) : (
        <Badge tone="neutral">{t('admin.developer.keys.revoked')}</Badge>
      ),
    actions: (
      <Button
        size="sm"
        variant="ghost"
        disabled={key.status === 'REVOKED'}
        onClick={() => onRevoke(key)}
      >
        {t('admin.developer.keys.revoke', { label: key.label })}
      </Button>
    ),
  };
}

function appRow(
  t: Translate,
  app: SmartApp,
  onOpen: (id: string) => void
): Record<string, ReactNode> {
  return {
    id: app.id,
    name: (
      <span className="or-cell-stack">
        <span className="or-body">{app.name}</span>
        <span className="or-caption or-mono">{app.clientId}</span>
      </span>
    ),
    launch: <span className="or-small">{t(LAUNCH_KEY[app.launchType])}</span>,
    scopes: chipList(app.scopes),
    lastLaunch: (
      <span className="or-small">
        {app.lastLaunchAt
          ? formatDateTime(app.lastLaunchAt, 'dense')
          : t('admin.developer.apps.neverLaunched')}
      </span>
    ),
    status:
      app.status === 'APPROVED' ? (
        <Badge tone="success">{t('admin.developer.apps.approved')}</Badge>
      ) : (
        <Badge tone="neutral">{t('admin.developer.apps.waiting')}</Badge>
      ),
    actions: (
      <Button size="sm" variant="ghost" onClick={() => onOpen(app.id)}>
        {t('admin.developer.apps.open', { name: app.name })}
      </Button>
    ),
  };
}

function hookRow(
  t: Translate,
  hook: Webhook,
  onOpen: (id: string) => void
): Record<string, ReactNode> {
  return {
    id: hook.id,
    event: (
      <span className="or-cell-stack">
        <span className="or-body">{hook.event}</span>
        <span className="or-caption or-mono">{hook.criteria}</span>
      </span>
    ),
    endpoint: <span className="or-small or-mono">{hook.endpoint}</span>,
    health: (
      <span className="or-small">
        {t('admin.developer.hooks.health', { percent: Math.round(hook.failureRate * 100) })}
      </span>
    ),
    status: <HookStatusBadge status={hook.status} />,
    actions: (
      <Button size="sm" variant="ghost" onClick={() => onOpen(hook.id)}>
        {t('admin.developer.hooks.open', { event: hook.event })}
      </Button>
    ),
  };
}

function deliveryRow(t: Translate, delivery: WebhookDelivery): Record<string, ReactNode> {
  const { tone, labelKey } = DELIVERY_OUTCOME[delivery.outcome];
  return {
    id: delivery.id,
    at: formatDateTime(delivery.at, 'dense'),
    event: delivery.event,
    code:
      delivery.responseCode === null
        ? t('admin.developer.deliveries.noAnswer')
        : String(delivery.responseCode),
    latency:
      delivery.latencyMs === null
        ? t('admin.developer.deliveries.timedOut')
        : t('admin.developer.deliveries.latencyMs', { ms: delivery.latencyMs }),
    attempt: String(delivery.attempt),
    outcome: <Badge tone={tone}>{t(labelKey)}</Badge>,
  };
}

/** The launch log for one SMART app. Empty is a sentence, not a blank card. */
function LaunchHistory({ app }: Readonly<{ app: SmartApp }>): ReactElement {
  const t = useTranslator();

  if (app.launches.length === 0) {
    return <p className="or-body">{t('admin.developer.launchHistory.empty')}</p>;
  }
  return (
    <ul className="or-log">
      {app.launches.map((launch) => (
        <li key={launch.id} className="or-log__row">
          <span className="or-caption or-mono">{formatDateTime(launch.at, 'dense')}</span>
          <span className="or-small">
            {/* The detail line comes from the launch record; only the sentence
                naming the patient context is this screen's to write. */}
            {launch.detail}
            {launch.patientContext
              ? ` ${t('admin.developer.launchHistory.patientContext', {
                  mrn: launch.patientContext,
                })}`
              : ''}
          </span>
          <Badge tone={launch.outcome === 'SUCCESS' ? 'success' : 'danger'}>
            {launch.outcome === 'SUCCESS'
              ? t('admin.developer.launchHistory.launched')
              : t('admin.developer.launchHistory.refused')}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * The drawer body for one app.
 *
 * The card passes `headingLevel={3}`: the drawer's own title is the h2 above it,
 * and the Card default of 2 would nest an h2 inside an h2.
 */
function AppDetail({ app }: Readonly<{ app: SmartApp }>): ReactElement {
  const t = useTranslator();

  return (
    <div className="or-stack">
      <DetailList
        columns={2}
        items={[
          { label: t('admin.developer.apps.detail.clientId'), value: app.clientId, mono: true },
          { label: t('admin.developer.apps.detail.launch'), value: t(LAUNCH_KEY[app.launchType]) },
          {
            label: t('admin.developer.apps.detail.redirectUris'),
            value: app.redirectUris.join(', '),
            mono: true,
          },
          {
            label: t('admin.developer.apps.detail.scopes'),
            value: app.scopes.join(' '),
            mono: true,
          },
        ]}
      />

      <Card tone="bone" headingLevel={3} title={t('admin.developer.launchHistory.title')}>
        <LaunchHistory app={app} />
      </Card>
    </div>
  );
}

function HookDetail({ hook }: Readonly<{ hook: Webhook }>): ReactElement {
  const t = useTranslator();

  return (
    <div className="or-stack">
      {hook.status === 'FAILING' ? (
        <Card className="or-notice" data-tone="serious">
          <p className="or-body">
            <strong>{t('admin.developer.hooks.failingNotice.title')}</strong>{' '}
            {t('admin.developer.hooks.failingNotice.body')}
          </p>
        </Card>
      ) : null}

      <DetailList
        columns={2}
        items={[
          { label: t('admin.developer.hooks.detail.criteria'), value: hook.criteria, mono: true },
          { label: t('admin.developer.hooks.detail.secret'), value: hook.secretRef, mono: true },
          {
            label: t('admin.developer.hooks.detail.failureRate'),
            value: t('admin.developer.hooks.detail.failureRateValue', {
              percent: Math.round(hook.failureRate * 100),
            }),
          },
          {
            label: t('admin.developer.hooks.detail.created'),
            value: formatDateTime(hook.createdAt, 'prose'),
          },
        ]}
      />

      <Table
        caption={t('admin.developer.hooks.deliveriesCaption', { event: hook.event })}
        columns={translateColumns(t, DELIVERY_COLUMNS)}
        rows={hook.deliveries.map((delivery) => deliveryRow(t, delivery))}
      />
    </div>
  );
}

interface ScopePickerProps {
  scopes: ReturnType<typeof useApiScopes>;
  selected: readonly string[];
  onToggle: (id: string) => void;
}

/**
 * Scope selection lives in its own component so the checkbox handler is a
 * plain callback rather than a closure nested five deep inside the screen.
 */
function ScopePicker({ scopes, selected, onToggle }: Readonly<ScopePickerProps>): ReactElement {
  const t = useTranslator();
  /* A set, because the answer is asked once per scope row and `includes` would
     rescan the whole selection each time. */
  const chosen = new Set(selected);
  return (
    <AsyncBoundary
      state={scopes}
      subject={t('admin.developer.scopes.subject')}
      isEmpty={(rows) => rows.length === 0}
      loadingVariant="text"
      loadingRows={5}
      empty={{
        title: t('admin.developer.scopes.empty.title'),
        message: t('admin.developer.scopes.empty.message'),
        icon: 'shield',
      }}
    >
      {(rows) => (
        <fieldset className="or-fieldset">
          <legend className="or-overline">{t('admin.developer.scopes.legend')}</legend>
          {rows.map((scope) => (
            /* The scope's id and its description are the API's own vocabulary:
               a scope means what the server says it means. */
            <Checkbox
              key={scope.id}
              label={scope.id}
              hint={scope.description}
              checked={chosen.has(scope.id)}
              onChange={() => onToggle(scope.id)}
            />
          ))}
        </fieldset>
      )}
    </AsyncBoundary>
  );
}

/**
 * The two faces of key creation: describe the key, then copy the secret once.
 *
 * They are one component because they are one moment. The secret replaces the
 * form rather than appearing beside it, so there is no state in which a person
 * is still editing a key that has already been issued.
 */
function KeyCreationBody({
  newSecret,
  keyLabel,
  scopes,
  keyScopes,
  onLabelChange,
  onToggleScope,
}: Readonly<{
  newSecret: string | null;
  keyLabel: string;
  scopes: ReturnType<typeof useApiScopes>;
  keyScopes: string[];
  onLabelChange: (value: string) => void;
  onToggleScope: (id: string) => void;
}>): ReactElement {
  const t = useTranslator();

  if (newSecret) {
    return (
      <div className="or-stack">
        <Card className="or-notice" data-tone="serious">
          <p className="or-body">
            <strong>{t('admin.developer.newKey.copyTitle')}</strong>{' '}
            {t('admin.developer.newKey.copyBody')}
          </p>
        </Card>
        <Input label={t('admin.developer.newKey.secret')} mono readOnly value={newSecret} />
      </div>
    );
  }

  return (
    <div className="or-stack">
      <Input
        label={t('admin.developer.newKey.purpose')}
        hint={t('admin.developer.newKey.purposeHint')}
        value={keyLabel}
        onChange={(event) => onLabelChange(event.target.value)}
        required
      />
      <Select
        label={t('admin.developer.newKey.type')}
        options={[
          { value: 'backend', label: t('admin.developer.newKey.typeBackend') },
          { value: 'portal', label: t('admin.developer.newKey.typePortal') },
        ]}
        defaultValue="backend"
      />
      <ScopePicker scopes={scopes} selected={keyScopes} onToggle={onToggleScope} />
    </div>
  );
}

/**
 * The three registries a developer manages here: keys, SMART apps, and webhook
 * subscriptions.
 *
 * Grouped into one component because they are the same shape (a boundary, an
 * empty state that says what the thing is for, and a table), and because the
 * screen around them is about the drawers that create and inspect them.
 */
function DeveloperRegistries({
  section,
  keys,
  apps,
  webhooks,
  keyRows,
  appRows,
  hookRows,
  onStartKey,
  onRevoke,
  onOpenApp,
  onOpenHook,
}: Readonly<{
  section: SectionId;
  keys: ReturnType<typeof useApiKeys>;
  apps: ReturnType<typeof useSmartApps>;
  webhooks: ReturnType<typeof useWebhooks>;
  keyRows: readonly ApiKey[];
  appRows: readonly SmartApp[];
  hookRows: readonly Webhook[];
  onStartKey: () => void;
  onRevoke: (key: ApiKey) => void;
  onOpenApp: (id: string) => void;
  onOpenHook: (id: string) => void;
}>): ReactElement {
  const t = useTranslator();

  return (
    <>
      <TabPanel id="keys" active={section === 'keys'}>
        <AsyncBoundary
          state={keys}
          subject={t('admin.developer.keys.subject')}
          isEmpty={isEmptyList}
          empty={{
            title: t('admin.developer.keys.empty.title'),
            message: t('admin.developer.keys.empty.message'),
            icon: 'key',
            action: (
              <Button variant="primary" onClick={onStartKey}>
                {t('admin.developer.keys.create')}
              </Button>
            ),
          }}
        >
          {() => (
            <Table
              caption={t('admin.developer.keys.caption')}
              columns={translateColumns(t, KEY_COLUMNS)}
              rows={keyRows.map((key) => keyRow(t, key, onRevoke))}
            />
          )}
        </AsyncBoundary>
      </TabPanel>

      {/* ---- SMART apps ----------------------------------------------- */}
      <TabPanel id="apps" active={section === 'apps'}>
        <AsyncBoundary
          state={apps}
          subject={t('admin.developer.apps.subject')}
          isEmpty={isEmptyList}
          empty={{
            title: t('admin.developer.apps.empty.title'),
            message: t('admin.developer.apps.empty.message'),
            icon: 'app-window',
            action: <Button variant="primary">{t('admin.developer.apps.register')}</Button>,
          }}
        >
          {() => (
            <Table
              caption={t('admin.developer.apps.caption')}
              columns={translateColumns(t, APP_COLUMNS)}
              rows={appRows.map((app) => appRow(t, app, onOpenApp))}
            />
          )}
        </AsyncBoundary>
      </TabPanel>

      {/* ---- Webhooks -------------------------------------------------- */}
      <TabPanel id="webhooks" active={section === 'webhooks'}>
        <AsyncBoundary
          state={webhooks}
          subject={t('admin.developer.hooks.subject')}
          isEmpty={isEmptyList}
          empty={{
            title: t('admin.developer.hooks.empty.title'),
            message: t('admin.developer.hooks.empty.message'),
            icon: 'webhook',
            action: <Button variant="primary">{t('admin.developer.hooks.create')}</Button>,
          }}
        >
          {() => (
            <Table
              caption={t('admin.developer.hooks.caption')}
              columns={translateColumns(t, HOOK_COLUMNS)}
              rows={hookRows.map((hook) => hookRow(t, hook, onOpenHook))}
            />
          )}
        </AsyncBoundary>
      </TabPanel>
    </>
  );
}

export function DeveloperScreen({ client }: Readonly<DeveloperScreenProps>): ReactElement {
  const t = useTranslator();
  const options = useAdminClientOption(client);
  const keys = useApiKeys(options);
  const scopes = useApiScopes(options);
  const apps = useSmartApps(options);
  const webhooks = useWebhooks(options);

  const [section, setSection] = useState<SectionId>('keys');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [keyLabel, setKeyLabel] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>([]);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [revoked, setRevoked] = useState<string[]>([]);
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [openHook, setOpenHook] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const startKey = useCallback(() => {
    setSection('keys');
    setCreatingKey(true);
    setNewSecret(null);
  }, []);
  const showWebhooks = useCallback(() => setSection('webhooks'), []);
  const showApps = useCallback(() => setSection('apps'), []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'admin.developer.key',
        group: 'actions',
        label: t('admin.developer.keys.create'),
        keywords: searchWords(t('admin.developer.command.key.keywords')),
        icon: 'key',
        perform: startKey,
      },
      {
        id: 'admin.developer.apps',
        group: 'actions',
        label: t('admin.developer.command.apps'),
        keywords: searchWords(t('admin.developer.command.apps.keywords')),
        icon: 'app-window',
        perform: showApps,
      },
      {
        id: 'admin.developer.webhooks',
        group: 'actions',
        label: t('admin.developer.command.webhooks'),
        keywords: searchWords(t('admin.developer.command.webhooks.keywords')),
        icon: 'webhook',
        perform: showWebhooks,
      },
    ],
    [startKey, showApps, showWebhooks, t]
  );

  const revokedIds = new Set(revoked);
  const keyRows: ApiKey[] = (keys.data?.data ?? []).map((key) =>
    revokedIds.has(key.id) ? { ...key, status: 'REVOKED' as const, revokedAt: null } : key
  );
  const appRows: SmartApp[] = apps.data?.data ?? [];
  const hookRows: Webhook[] = webhooks.data?.data ?? [];

  const selectedApp = appRows.find((app) => app.id === openApp) ?? null;
  const selectedHook = hookRows.find((hook) => hook.id === openHook) ?? null;

  const toggleKeyScope = useCallback((id: string) => {
    setKeyScopes((previous) => toggleScope(previous, id));
  }, []);

  const createKey = () => {
    if (!keyLabel.trim()) return;
    setNewSecret(MOCK_NEW_KEY_DISPLAY);
    setToast(t('admin.developer.newKey.createdToast', { label: keyLabel.trim() }));
  };

  const confirmRevoke = () => {
    if (!revoking) return;
    setRevoked((previous) => [...previous, revoking.id]);
    setToast(t('admin.developer.keys.revokedToast', { label: revoking.label }));
    setRevoking(null);
  };

  return (
    <AppShell
      title={t(adminArea('developer').labelKey)}
      description={t('admin.developer.description')}
      breadcrumb={adminBreadcrumb(t, 'developer')}
      actions={
        <Button variant="primary" iconLeft="key" onClick={startKey}>
          {t('admin.developer.keys.create')}
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Tabs
        label={t('admin.developer.tabs.label')}
        active={section}
        onChange={(id) => setSection(id as SectionId)}
        items={[
          { id: 'keys', label: t('admin.developer.tabs.keys'), hint: `${keyRows.length}` },
          { id: 'apps', label: t('admin.developer.tabs.apps'), hint: `${appRows.length}` },
          {
            id: 'webhooks',
            label: t('admin.developer.tabs.webhooks'),
            hint: `${hookRows.length}`,
          },
        ]}
      />

      {/* ---- API keys ------------------------------------------------- */}
      <DeveloperRegistries
        section={section}
        keys={keys}
        apps={apps}
        webhooks={webhooks}
        keyRows={keyRows}
        appRows={appRows}
        hookRows={hookRows}
        onStartKey={startKey}
        onRevoke={setRevoking}
        onOpenApp={setOpenApp}
        onOpenHook={setOpenHook}
      />

      {/* ---- Create key ------------------------------------------------ */}
      <Drawer
        open={creatingKey}
        title={t('admin.developer.keys.create')}
        description={t('admin.developer.newKey.description')}
        width={640}
        onClose={() => setCreatingKey(false)}
        footer={
          newSecret ? (
            <Button variant="primary" onClick={() => setCreatingKey(false)}>
              {t('admin.developer.newKey.copied')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setCreatingKey(false)}>
                {t('admin.action.cancel')}
              </Button>
              <Button variant="primary" onClick={createKey}>
                {t('admin.developer.newKey.create')}
              </Button>
            </>
          )
        }
      >
        <KeyCreationBody
          newSecret={newSecret}
          keyLabel={keyLabel}
          scopes={scopes}
          keyScopes={keyScopes}
          onLabelChange={setKeyLabel}
          onToggleScope={toggleKeyScope}
        />
      </Drawer>

      {/* ---- App detail ------------------------------------------------ */}
      <Drawer
        open={selectedApp !== null}
        title={selectedApp?.name ?? ''}
        description={t('admin.developer.apps.drawerDescription')}
        width={720}
        onClose={() => setOpenApp(null)}
        meta={
          selectedApp ? (
            <Badge tone={selectedApp.status === 'APPROVED' ? 'success' : 'neutral'}>
              {selectedApp.status === 'APPROVED'
                ? t('admin.developer.apps.approved')
                : t('admin.developer.apps.waiting')}
            </Badge>
          ) : null
        }
        footer={
          selectedApp ? (
            <>
              <Button variant="ghost" onClick={() => setOpenApp(null)}>
                {t('admin.action.close')}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  setToast(t('admin.developer.apps.testLaunchToast', { name: selectedApp.name }))
                }
              >
                {t('admin.developer.apps.testLaunch')}
              </Button>
            </>
          ) : null
        }
      >
        {selectedApp ? <AppDetail app={selectedApp} /> : null}
      </Drawer>

      {/* ---- Webhook detail -------------------------------------------- */}
      <Drawer
        open={selectedHook !== null}
        title={
          selectedHook ? t('admin.developer.hooks.drawerTitle', { event: selectedHook.event }) : ''
        }
        description={selectedHook?.endpoint}
        width={720}
        onClose={() => setOpenHook(null)}
        meta={selectedHook ? <HookStatusBadge status={selectedHook.status} /> : null}
        footer={
          selectedHook ? (
            <>
              <Button variant="ghost" onClick={() => setOpenHook(null)}>
                {t('admin.action.close')}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  setToast(t('admin.developer.hooks.retryToast', { event: selectedHook.event }))
                }
              >
                {t('admin.developer.hooks.retry')}
              </Button>
            </>
          ) : null
        }
      >
        {selectedHook ? <HookDetail hook={selectedHook} /> : null}
      </Drawer>

      <ConfirmDialog
        open={revoking !== null}
        title={t('admin.developer.keys.revoke', { label: revoking?.label ?? '' })}
        consequence={t('admin.developer.keys.revokeConsequence')}
        confirmLabel={t('admin.developer.keys.revokeConfirm')}
        typedConfirmation={revoking?.label}
        onCancel={() => setRevoking(null)}
        onConfirm={confirmRevoke}
      />

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="success" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}
