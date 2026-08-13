'use client';

import { Badge, Button, Card, Checkbox, Input, Select, Table, Tag, Toast } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  adminBreadcrumb,
  ConfirmDialog,
  DetailList,
  Drawer,
  TabPanel,
  Tabs,
} from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import {
  useAdminClientOption,
  useApiKeys,
  useApiScopes,
  useSmartApps,
  useWebhooks,
} from '@/lib/api';
import type { AdminClient, ApiKey, SmartApp, Webhook } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * DV-01 to DV-03, on one screen with three sections.
 *
 * The whole developer platform in OpenEMR lived in globals with wiki-guided
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

const KEY_COLUMNS: TableColumn[] = [
  { key: 'label', header: 'Key' },
  { key: 'scopes', header: 'Scopes' },
  { key: 'created', header: 'Created' },
  { key: 'lastUsed', header: 'Last used' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

const APP_COLUMNS: TableColumn[] = [
  { key: 'name', header: 'App' },
  { key: 'launch', header: 'Launch' },
  { key: 'scopes', header: 'Scopes' },
  { key: 'lastLaunch', header: 'Last launch' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

const HOOK_COLUMNS: TableColumn[] = [
  { key: 'event', header: 'Event' },
  { key: 'endpoint', header: 'Endpoint' },
  { key: 'health', header: 'Health' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

const DELIVERY_COLUMNS: TableColumn[] = [
  { key: 'at', header: 'When' },
  { key: 'event', header: 'Event' },
  { key: 'code', header: 'Response', numeric: true },
  { key: 'latency', header: 'Latency', numeric: true },
  { key: 'attempt', header: 'Attempt', numeric: true },
  { key: 'outcome', header: 'Outcome' },
];

/** Obviously fake, shown once, never stored. The real one is generated server-side. */
const DEMO_SECRET = 'ork_demo_new_key_shown_once_0000';

export function DeveloperScreen({ client }: DeveloperScreenProps = {}): ReactElement {
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
        label: 'Create an API key',
        keywords: ['token', 'backend service', 'credential'],
        icon: 'key',
        perform: startKey,
      },
      {
        id: 'admin.developer.apps',
        group: 'actions',
        label: 'Show SMART on FHIR apps',
        keywords: ['smart', 'launch', 'oauth', 'app registration'],
        icon: 'app-window',
        perform: showApps,
      },
      {
        id: 'admin.developer.webhooks',
        group: 'actions',
        label: 'Show webhook deliveries',
        keywords: ['subscriptions', 'events', 'retry', 'delivery log'],
        icon: 'webhook',
        perform: showWebhooks,
      },
    ],
    [startKey, showApps, showWebhooks]
  );

  const keyRows: ApiKey[] = (keys.data?.data ?? []).map((key) =>
    revoked.includes(key.id) ? { ...key, status: 'REVOKED' as const, revokedAt: null } : key
  );
  const appRows: SmartApp[] = apps.data?.data ?? [];
  const hookRows: Webhook[] = webhooks.data?.data ?? [];

  const selectedApp = appRows.find((app) => app.id === openApp) ?? null;
  const selectedHook = hookRows.find((hook) => hook.id === openHook) ?? null;

  const createKey = () => {
    if (!keyLabel.trim()) return;
    setNewSecret(DEMO_SECRET);
    setToast(`${keyLabel.trim()} created. Copy the secret now; it is not shown again.`);
  };

  const confirmRevoke = () => {
    if (!revoking) return;
    setRevoked((previous) => [...previous, revoking.id]);
    setToast(
      `${revoking.label} stops working immediately. The record is kept for the audit trail.`
    );
    setRevoking(null);
  };

  return (
    <AppShell
      title="Developer platform"
      description="API keys, SMART on FHIR apps, and webhook subscriptions with every delivery."
      breadcrumb={adminBreadcrumb('Developer platform')}
      actions={
        <Button variant="primary" iconLeft="key" onClick={startKey}>
          Create an API key
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Tabs
        label="Developer platform sections"
        active={section}
        onChange={(id) => setSection(id as SectionId)}
        items={[
          { id: 'keys', label: 'API keys', hint: `${keyRows.length}` },
          { id: 'apps', label: 'SMART apps', hint: `${appRows.length}` },
          { id: 'webhooks', label: 'Webhooks', hint: `${hookRows.length}` },
        ]}
      />

      {/* ---- API keys ------------------------------------------------- */}
      <TabPanel id="keys" active={section === 'keys'}>
        <AsyncBoundary
          state={keys}
          subject="API keys"
          isEmpty={isEmptyList}
          empty={{
            title: 'No API keys yet',
            message:
              'A key lets a backend service read this practice through the FHIR API. Create one, choose its scopes, and copy the secret once.',
            icon: 'key',
            action: (
              <Button variant="primary" onClick={startKey}>
                Create an API key
              </Button>
            ),
          }}
        >
          {() => (
            <Table
              caption="API keys"
              columns={KEY_COLUMNS}
              rows={keyRows.map((key) => ({
                id: key.id,
                label: (
                  <span className="or-cell-stack">
                    <span className="or-body">{key.label}</span>
                    <span className="or-caption or-mono">{key.prefix}...</span>
                  </span>
                ),
                scopes: (
                  <span className="or-cell-chips">
                    {key.scopes.map((scope) => (
                      <Tag key={scope} mono>
                        {scope}
                      </Tag>
                    ))}
                  </span>
                ),
                created: <span className="or-small">{formatDateTime(key.createdAt, 'dense')}</span>,
                lastUsed: (
                  <span className="or-small">
                    {key.lastUsedAt ? formatDateTime(key.lastUsedAt, 'dense') : 'Never used'}
                  </span>
                ),
                status:
                  key.status === 'ACTIVE' ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="neutral">Revoked</Badge>
                  ),
                actions: (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={key.status === 'REVOKED'}
                    onClick={() => setRevoking(key)}
                  >
                    Revoke {key.label}
                  </Button>
                ),
              }))}
            />
          )}
        </AsyncBoundary>
      </TabPanel>

      {/* ---- SMART apps ----------------------------------------------- */}
      <TabPanel id="apps" active={section === 'apps'}>
        <AsyncBoundary
          state={apps}
          subject="registered apps"
          isEmpty={isEmptyList}
          empty={{
            title: 'No apps registered',
            message:
              'A SMART on FHIR app launches from a chart or on its own and reads through scopes you grant. Register the first one to test a launch.',
            icon: 'app-window',
            action: <Button variant="primary">Register an app</Button>,
          }}
        >
          {() => (
            <Table
              caption="SMART on FHIR apps"
              columns={APP_COLUMNS}
              rows={appRows.map((app) => ({
                id: app.id,
                name: (
                  <span className="or-cell-stack">
                    <span className="or-body">{app.name}</span>
                    <span className="or-caption or-mono">{app.clientId}</span>
                  </span>
                ),
                launch: (
                  <span className="or-small">
                    {app.launchType === 'EHR' ? 'From a chart' : 'On its own'}
                  </span>
                ),
                scopes: (
                  <span className="or-cell-chips">
                    {app.scopes.map((scope) => (
                      <Tag key={scope} mono>
                        {scope}
                      </Tag>
                    ))}
                  </span>
                ),
                lastLaunch: (
                  <span className="or-small">
                    {app.lastLaunchAt ? formatDateTime(app.lastLaunchAt, 'dense') : 'Never'}
                  </span>
                ),
                status:
                  app.status === 'APPROVED' ? (
                    <Badge tone="success">Approved</Badge>
                  ) : (
                    <Badge tone="neutral">Waiting for approval</Badge>
                  ),
                actions: (
                  <Button size="sm" variant="ghost" onClick={() => setOpenApp(app.id)}>
                    Open {app.name}
                  </Button>
                ),
              }))}
            />
          )}
        </AsyncBoundary>
      </TabPanel>

      {/* ---- Webhooks -------------------------------------------------- */}
      <TabPanel id="webhooks" active={section === 'webhooks'}>
        <AsyncBoundary
          state={webhooks}
          subject="webhook subscriptions"
          isEmpty={isEmptyList}
          empty={{
            title: 'No subscriptions yet',
            message:
              'A subscription posts an event to your endpoint as it happens, signed with a shared secret. Create one and fire a test delivery.',
            icon: 'webhook',
            action: <Button variant="primary">Create a subscription</Button>,
          }}
        >
          {() => (
            <Table
              caption="Webhook subscriptions"
              columns={HOOK_COLUMNS}
              rows={hookRows.map((hook) => ({
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
                    {Math.round(hook.failureRate * 100)}% failed of the last 100
                  </span>
                ),
                status:
                  hook.status === 'ACTIVE' ? (
                    <Badge tone="success">Delivering</Badge>
                  ) : hook.status === 'FAILING' ? (
                    <Badge tone="danger">Failing</Badge>
                  ) : (
                    <Badge tone="neutral">Paused</Badge>
                  ),
                actions: (
                  <Button size="sm" variant="ghost" onClick={() => setOpenHook(hook.id)}>
                    Open {hook.event} deliveries
                  </Button>
                ),
              }))}
            />
          )}
        </AsyncBoundary>
      </TabPanel>

      {/* ---- Create key ------------------------------------------------ */}
      <Drawer
        open={creatingKey}
        title="Create an API key"
        description="Backend services authenticate with this key. It is shown once and cannot be recovered."
        width={640}
        onClose={() => setCreatingKey(false)}
        footer={
          newSecret ? (
            <Button variant="primary" onClick={() => setCreatingKey(false)}>
              I have copied the secret
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setCreatingKey(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={createKey}>
                Create key
              </Button>
            </>
          )
        }
      >
        {newSecret ? (
          <div className="or-stack">
            <Card className="or-notice" data-tone="serious">
              <p className="or-body">
                <strong>Copy this secret now.</strong> openrunic stores a hash of it and cannot show
                it again. If it is lost, create a new key and revoke this one.
              </p>
            </Card>
            <Input label="Secret" mono readOnly value={newSecret} />
          </div>
        ) : (
          <div className="or-stack">
            <Input
              label="What is this key for?"
              hint="A person reading the list in a year should know whether they can revoke it."
              value={keyLabel}
              onChange={(event) => setKeyLabel(event.target.value)}
              required
            />
            <Select
              label="Type"
              options={[
                { value: 'backend', label: 'Backend service' },
                { value: 'portal', label: 'Portal integration' },
              ]}
              defaultValue="backend"
            />
            <AsyncBoundary
              state={scopes}
              subject="scopes"
              isEmpty={(rows) => rows.length === 0}
              loadingVariant="text"
              loadingRows={5}
              empty={{
                title: 'No scopes available',
                message:
                  'A key with no scope can read nothing. Reload the screen, and report it if the list stays empty.',
                icon: 'shield',
              }}
            >
              {(rows) => (
                <fieldset className="or-fieldset">
                  <legend className="or-overline">Scopes</legend>
                  {rows.map((scope) => (
                    <Checkbox
                      key={scope.id}
                      label={scope.id}
                      hint={scope.description}
                      checked={keyScopes.includes(scope.id)}
                      onChange={() =>
                        setKeyScopes((previous) =>
                          previous.includes(scope.id)
                            ? previous.filter((entry) => entry !== scope.id)
                            : [...previous, scope.id]
                        )
                      }
                    />
                  ))}
                </fieldset>
              )}
            </AsyncBoundary>
          </div>
        )}
      </Drawer>

      {/* ---- App detail ------------------------------------------------ */}
      <Drawer
        open={selectedApp !== null}
        title={selectedApp?.name ?? ''}
        description="Launch configuration and every launch this app has attempted."
        width={720}
        onClose={() => setOpenApp(null)}
        meta={
          selectedApp ? (
            <Badge tone={selectedApp.status === 'APPROVED' ? 'success' : 'neutral'}>
              {selectedApp.status === 'APPROVED' ? 'Approved' : 'Waiting for approval'}
            </Badge>
          ) : null
        }
        footer={
          selectedApp ? (
            <>
              <Button variant="ghost" onClick={() => setOpenApp(null)}>
                Close
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  setToast(
                    `Test launch of ${selectedApp.name} succeeded against the demo tenant with patient OR-100482.`
                  )
                }
              >
                Test launch
              </Button>
            </>
          ) : null
        }
      >
        {selectedApp ? (
          <div className="or-stack">
            <DetailList
              columns={2}
              items={[
                { label: 'Client id', value: selectedApp.clientId, mono: true },
                {
                  label: 'Launch',
                  value: selectedApp.launchType === 'EHR' ? 'From a chart' : 'On its own',
                },
                { label: 'Redirect URIs', value: selectedApp.redirectUris.join(', '), mono: true },
                { label: 'Scopes', value: selectedApp.scopes.join(' '), mono: true },
              ]}
            />

            <Card tone="bone" title="Launch history">
              {selectedApp.launches.length === 0 ? (
                <p className="or-body">
                  This app has never launched. Use Test launch to try it against the demo tenant.
                </p>
              ) : (
                <ul className="or-log">
                  {selectedApp.launches.map((launch) => (
                    <li key={launch.id} className="or-log__row">
                      <span className="or-caption or-mono">
                        {formatDateTime(launch.at, 'dense')}
                      </span>
                      <span className="or-small">
                        {launch.detail}
                        {launch.patientContext ? ` Patient ${launch.patientContext}.` : ''}
                      </span>
                      <Badge tone={launch.outcome === 'SUCCESS' ? 'success' : 'danger'}>
                        {launch.outcome === 'SUCCESS' ? 'Launched' : 'Refused'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        ) : null}
      </Drawer>

      {/* ---- Webhook detail -------------------------------------------- */}
      <Drawer
        open={selectedHook !== null}
        title={selectedHook ? `${selectedHook.event} deliveries` : ''}
        description={selectedHook?.endpoint}
        width={720}
        onClose={() => setOpenHook(null)}
        meta={
          selectedHook ? (
            <Badge tone={selectedHook.status === 'FAILING' ? 'danger' : 'success'}>
              {selectedHook.status === 'FAILING'
                ? 'Failing'
                : selectedHook.status === 'PAUSED'
                  ? 'Paused'
                  : 'Delivering'}
            </Badge>
          ) : null
        }
        footer={
          selectedHook ? (
            <>
              <Button variant="ghost" onClick={() => setOpenHook(null)}>
                Close
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  setToast(
                    `Re-sent the last ${selectedHook.event} delivery. Watch the log for the response.`
                  )
                }
              >
                Retry last delivery
              </Button>
            </>
          ) : null
        }
      >
        {selectedHook ? (
          <div className="or-stack">
            {selectedHook.status === 'FAILING' ? (
              <Card className="or-notice" data-tone="serious">
                <p className="or-body">
                  <strong>This endpoint is failing.</strong> Deliveries retry with backoff for 24
                  hours, and the subscription pauses itself after 100 consecutive failures so it
                  stops queueing behind a dead endpoint.
                </p>
              </Card>
            ) : null}

            <DetailList
              columns={2}
              items={[
                { label: 'Criteria', value: selectedHook.criteria, mono: true },
                { label: 'Signing secret', value: selectedHook.secretRef, mono: true },
                {
                  label: 'Failure rate',
                  value: `${Math.round(selectedHook.failureRate * 100)}% of the last 100`,
                },
                { label: 'Created', value: formatDateTime(selectedHook.createdAt, 'prose') },
              ]}
            />

            <Table
              caption={`Deliveries for ${selectedHook.event}`}
              columns={DELIVERY_COLUMNS}
              rows={selectedHook.deliveries.map((delivery) => ({
                id: delivery.id,
                at: formatDateTime(delivery.at, 'dense'),
                event: delivery.event,
                code: delivery.responseCode === null ? 'No answer' : String(delivery.responseCode),
                latency: delivery.latencyMs === null ? 'Timed out' : `${delivery.latencyMs} ms`,
                attempt: String(delivery.attempt),
                outcome:
                  delivery.outcome === 'DELIVERED' ? (
                    <Badge tone="success">Delivered</Badge>
                  ) : delivery.outcome === 'FAILED' ? (
                    <Badge tone="danger">Failed</Badge>
                  ) : (
                    <Badge tone="neutral">Retrying</Badge>
                  ),
              }))}
            />
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.label ?? ''}`}
        consequence="Anything using this key stops working immediately. The key is kept, revoked, so the audit trail still resolves it."
        confirmLabel="Revoke key"
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
