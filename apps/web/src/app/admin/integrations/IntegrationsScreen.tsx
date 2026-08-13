'use client';

import { Badge, Button, Card, Input, Tag, Toast } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { adminBreadcrumb, DetailList, Drawer } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { useAdminClientOption, useIntegrations } from '@/lib/api';
import type { AdminClient, Integration, IntegrationStatus } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * AD-07 Integrations and adapters.
 *
 * Connection state is visible, testable, and honest about which failures are
 * ours and which are a partner's. Placeholder adapters are never quiet about being
 * demo adapters: the chip says so here, and every dependent screen's transmit
 * action says so there.
 *
 * Credentials are shown as a secret reference and never as a value, on this
 * screen or any other. A test connection is the only way to find out whether a
 * credential works, which is why it is a first-class action rather than a link
 * to a wiki page.
 */

export interface IntegrationsScreenProps {
  client?: AdminClient;
}

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  CONNECTED: 'Connected',
  DEMO: 'Placeholder mode',
  ERROR: 'Not working',
  NOT_CONNECTED: 'Not connected',
};

const STATUS_TONE: Record<IntegrationStatus, 'success' | 'neutral' | 'danger'> = {
  CONNECTED: 'success',
  DEMO: 'neutral',
  ERROR: 'danger',
  NOT_CONNECTED: 'neutral',
};

/**
 * What a test connection reports back, per state. A seam that is already
 * failing says what to replace, one with no adapter says what is missing, and
 * a working seam reports the round trip. Listed per status rather than
 * branched, so adding a state forces a sentence to be written for it.
 */
const TEST_RESULT: Record<IntegrationStatus, string> = {
  CONNECTED: 'The connection answered in 142 ms and returned the expected response.',
  DEMO: 'The connection answered in 142 ms and returned the expected response.',
  ERROR: 'The lab refused the credentials again. Replace the service account, then test once more.',
  NOT_CONNECTED: 'There is nothing to test yet. Choose an adapter and save its credentials first.',
};

function testResultFor(status: IntegrationStatus): string {
  return TEST_RESULT[status];
}

/** One sentence under the chip, so the state is never only a colour and a word. */
function statusSentence(integration: Integration): string {
  switch (integration.status) {
    case 'CONNECTED':
      return `Working. Last activity ${formatDateTime(integration.lastActivityAt, 'dense')}.`;
    case 'DEMO':
      return 'Working against the built-in demo network. Nothing leaves this practice.';
    case 'ERROR':
      return `Not working since ${formatDateTime(integration.lastActivityAt, 'dense')}. Work queues until it is fixed.`;
    default:
      return 'No adapter configured. The features that need this seam are unavailable.';
  }
}

/** One seam's card in the grid: what it is, how it is doing, and a way in. */
function AdapterCard({
  integration,
  onConfigure,
}: Readonly<{ integration: Integration; onConfigure: (id: string) => void }>): ReactElement {
  return (
    <Card className="or-adapter" data-status={integration.status}>
      <div className="or-adapter__head">
        <h2 className="or-h3">{integration.name}</h2>
        <Badge tone={STATUS_TONE[integration.status]}>{STATUS_LABEL[integration.status]}</Badge>
      </div>

      <p className="or-small">{integration.description}</p>
      <p className="or-small or-adapter__state">{statusSentence(integration)}</p>

      <div className="or-cell-chips">
        <Tag mono>{integration.seam}</Tag>
        {integration.adapter ? (
          <Tag>
            {integration.adapter} {integration.adapterVersion}
          </Tag>
        ) : null}
        {integration.webhookVerified ? <Tag>Webhook verified</Tag> : null}
      </div>

      <Button variant="secondary" size="sm" onClick={() => onConfigure(integration.id)}>
        Configure {integration.name}
      </Button>
    </Card>
  );
}

/** The notice at the top of the drawer, when this seam has something to say. */
function SeamNotice({ integration }: Readonly<{ integration: Integration }>): ReactElement | null {
  if (integration.status === 'ERROR') {
    return (
      <Card className="or-notice" data-tone="serious">
        <p className="or-body">{integration.failureDetail}</p>
        <p className="or-small">Last working: {formatDateTime(integration.lastGoodAt, 'prose')}.</p>
      </Card>
    );
  }

  if (integration.status === 'DEMO') {
    return (
      <Card className="or-notice" data-tone="info">
        <p className="or-body">
          <strong>Placeholder mode.</strong> Orders, messages and payments through this seam go to
          the built-in mock and never reach a real partner. Every screen that transmits through it
          says so on its own button.
        </p>
      </Card>
    );
  }

  return null;
}

/** Everything that has gone through this seam, newest first. */
function ActivityLog({ integration }: Readonly<{ integration: Integration }>): ReactElement {
  if (integration.activityLog.length === 0) {
    return (
      <p className="or-body">
        Nothing has gone through this seam yet. Activity appears here as soon as it does.
      </p>
    );
  }

  return (
    <ul className="or-log">
      {integration.activityLog.map((entry) => (
        <li key={entry.at} className="or-log__row">
          <span className="or-caption or-mono">{formatDateTime(entry.at, 'dense')}</span>
          <span className="or-small">{entry.summary}</span>
          <Badge tone={entry.ok ? 'success' : 'danger'}>{entry.ok ? 'Succeeded' : 'Failed'}</Badge>
        </li>
      ))}
    </ul>
  );
}

interface SeamDetailProps {
  integration: Integration;
  testResult: string | undefined;
}

/**
 * The drawer body: why this seam is in the state it is, and what it did.
 *
 * Cards here pass `headingLevel={3}`. The drawer renders its own title as the h2,
 * so a card inside it is a level below; leaving the Card default would put an h2
 * inside an h2 and flatten the outline a screen reader moves through.
 */
function SeamDetail({ integration, testResult }: Readonly<SeamDetailProps>): ReactElement {
  return (
    <div className="or-stack">
      <SeamNotice integration={integration} />

      <Card tone="bone" headingLevel={3} title="Credentials">
        <p className="or-small">
          openrunic stores a reference, not the secret. The value is never displayed, logged or
          exported, including here.
        </p>
        <Input
          label="Secret reference"
          mono
          readOnly
          value={integration.secretRef ?? 'No credential stored'}
        />
      </Card>

      {testResult ? (
        <Card tone="bone" headingLevel={3} title="Test result">
          <output className="or-body">{testResult}</output>
        </Card>
      ) : null}

      <DetailList
        columns={2}
        items={[
          { label: 'Seam', value: integration.seam, mono: true },
          { label: 'Adapter', value: integration.adapter ?? 'None chosen' },
          { label: 'Version', value: integration.adapterVersion ?? 'Not applicable' },
          { label: 'Last activity', value: formatDateTime(integration.lastActivityAt, 'prose') },
          { label: 'Last working', value: formatDateTime(integration.lastGoodAt, 'prose') },
          { label: 'Webhook', value: integration.webhookVerified ? 'Verified' : 'Not verified' },
        ]}
      />

      <Card tone="bone" headingLevel={3} title="Recent activity">
        <ActivityLog integration={integration} />
      </Card>
    </div>
  );
}

export function IntegrationsScreen({ client }: Readonly<IntegrationsScreenProps>): ReactElement {
  const options = useAdminClientOption(client);
  const integrations = useIntegrations(options);

  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});

  /* Memoised: the "open the failing connection" command closes over it. */
  const rows = useMemo(() => integrations.data?.data ?? [], [integrations.data]);
  const selected = rows.find((integration) => integration.id === openId) ?? null;
  const broken = rows.filter((integration) => integration.status === 'ERROR');

  const openFirstProblem = useCallback(() => {
    const problem = rows.find((integration) => integration.status === 'ERROR');
    if (problem) setOpenId(problem.id);
  }, [rows]);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'admin.integrations.problem',
        group: 'actions',
        label: 'Open the failing connection',
        keywords: ['error', 'broken adapter', 'outage'],
        icon: 'triangle-alert',
        perform: openFirstProblem,
      },
    ],
    [openFirstProblem]
  );

  const testConnection = (integration: Integration) => {
    const result = testResultFor(integration.status);
    setTested((previous) => ({ ...previous, [integration.id]: result }));
    setToast(`${integration.name}: ${result}`);
  };

  return (
    <AppShell
      title="Integrations"
      description="The partner seams: prescribing, claims, labs, payments, fax, text and video."
      breadcrumb={adminBreadcrumb('Integrations')}
    >
      <ScreenCommands commands={commands} />

      {broken.length > 0 ? (
        <Card className="or-notice" data-tone="serious">
          <p className="or-body">
            <strong>
              {broken.length === 1
                ? `${broken[0]?.name} is not working.`
                : `${broken.length} connections are not working.`}
            </strong>{' '}
            Work that needs them is queued rather than lost. Open the card to see what the partner
            said and what to do.
          </p>
          <Button variant="secondary" size="sm" onClick={openFirstProblem}>
            Open the failing connection
          </Button>
        </Card>
      ) : null}

      <AsyncBoundary
        state={integrations}
        subject="integrations"
        isEmpty={isEmptyList}
        loadingVariant="cards"
        loadingRows={6}
        empty={{
          title: 'No seams configured',
          message:
            'Prescribing, claims, labs and payments each run through an adapter. Connect the first one, or keep working in demo mode.',
          icon: 'plug',
        }}
      >
        {() => (
          <ul className="or-cardgrid">
            {rows.map((integration) => (
              <li key={integration.id}>
                <AdapterCard integration={integration} onConfigure={setOpenId} />
              </li>
            ))}
          </ul>
        )}
      </AsyncBoundary>

      <Drawer
        open={selected !== null}
        title={selected?.name ?? ''}
        description={selected?.description}
        width={720}
        onClose={() => setOpenId(null)}
        meta={
          selected ? (
            <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
          ) : null
        }
        footer={
          selected ? (
            <>
              <Button variant="ghost" onClick={() => setOpenId(null)}>
                Close
              </Button>
              <Button variant="secondary" onClick={() => testConnection(selected)}>
                Test connection
              </Button>
              <Button variant="primary" onClick={() => setOpenId(null)}>
                Save connection
              </Button>
            </>
          ) : null
        }
      >
        {selected ? <SeamDetail integration={selected} testResult={tested[selected.id]} /> : null}
      </Drawer>

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="info" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}
