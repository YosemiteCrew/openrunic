'use client';

import { formatCount } from '@openrunic/i18n';
import { Badge, Button, Card, Input, Tag } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Translator } from '@openrunic/i18n';
import { Demonstration, DetailList, Drawer, adminArea, adminBreadcrumb } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { useAdminClientOption, useIntegrations } from '@/lib/api';
import type { AdminClient, Integration, IntegrationStatus } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * AD-07 Integrations and adapters.
 *
 * Connection state is visible, testable, and honest about which failures are
 * ours and which are a partner's. Demo adapters are never quiet about being
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

/** What a translator does, for the helpers below that are not components. */
const STATUS_KEY: Record<IntegrationStatus, { labelKey: string }> = {
  CONNECTED: { labelKey: 'admin.integrations.status.connected' },
  DEMO: { labelKey: 'admin.integrations.status.demo' },
  ERROR: { labelKey: 'admin.integrations.status.error' },
  NOT_CONNECTED: { labelKey: 'admin.integrations.status.notConnected' },
};

const STATUS_TONE: Record<IntegrationStatus, 'success' | 'neutral' | 'danger'> = {
  CONNECTED: 'success',
  DEMO: 'neutral',
  ERROR: 'danger',
  NOT_CONNECTED: 'neutral',
};

/** One sentence under the chip, so the state is never only a colour and a word. */
function statusSentence(t: Translator, integration: Integration): string {
  switch (integration.status) {
    case 'CONNECTED':
      return t('admin.integrations.sentence.connected', {
        when: formatDateTime(t, integration.lastActivityAt, 'dense'),
      });
    case 'DEMO':
      return t('admin.integrations.sentence.demo');
    case 'ERROR':
      return t('admin.integrations.sentence.error', {
        when: formatDateTime(t, integration.lastActivityAt, 'dense'),
      });
    default:
      return t('admin.integrations.sentence.notConnected');
  }
}

/** One seam's card in the grid: what it is, how it is doing, and a way in. */
function AdapterCard({
  integration,
  onConfigure,
}: Readonly<{ integration: Integration; onConfigure: (id: string) => void }>): ReactElement {
  const t = useTranslator();

  return (
    <Card className="or-adapter" data-status={integration.status}>
      <div className="or-adapter__head">
        <h2 className="or-h3">{integration.name}</h2>
        <Badge tone={STATUS_TONE[integration.status]}>
          {t(STATUS_KEY[integration.status].labelKey)}
        </Badge>
      </div>

      <p className="or-small">{integration.description}</p>
      <p className="or-small or-adapter__state">{statusSentence(t, integration)}</p>

      <div className="or-cell-chips">
        <Tag mono>{integration.seam}</Tag>
        {integration.adapter ? (
          <Tag>
            {integration.adapter} {integration.adapterVersion}
          </Tag>
        ) : null}
        {integration.webhookVerified ? <Tag>{t('admin.integrations.webhookVerified')}</Tag> : null}
      </div>

      <Button variant="secondary" size="sm" onClick={() => onConfigure(integration.id)}>
        {t('admin.integrations.configure', { name: integration.name })}
      </Button>
    </Card>
  );
}

/** The notice at the top of the drawer, when this seam has something to say. */
function SeamNotice({ integration }: Readonly<{ integration: Integration }>): ReactElement | null {
  const t = useTranslator();

  if (integration.status === 'ERROR') {
    return (
      <Card className="or-notice" data-tone="serious">
        <p className="or-body">{integration.failureDetail}</p>
        <p className="or-small">
          {t('admin.integrations.lastWorking', {
            when: formatDateTime(t, integration.lastGoodAt, 'prose'),
          })}
        </p>
      </Card>
    );
  }

  if (integration.status === 'DEMO') {
    return (
      <Card className="or-notice" data-tone="info">
        <p className="or-body">
          <strong>{t('admin.integrations.demoNotice.title')}</strong>{' '}
          {t('admin.integrations.demoNotice.body')}
        </p>
      </Card>
    );
  }

  return null;
}

/** Everything that has gone through this seam, newest first. */
function ActivityLog({ integration }: Readonly<{ integration: Integration }>): ReactElement {
  const t = useTranslator();

  if (integration.activityLog.length === 0) {
    return <p className="or-body">{t('admin.integrations.activity.empty')}</p>;
  }

  return (
    <ul className="or-log">
      {integration.activityLog.map((entry) => (
        <li key={entry.at} className="or-log__row">
          <span className="or-caption or-mono">{formatDateTime(t, entry.at, 'dense')}</span>
          <span className="or-small">{entry.summary}</span>
          <Badge tone={entry.ok ? 'success' : 'danger'}>
            {entry.ok
              ? t('admin.integrations.activity.succeeded')
              : t('admin.integrations.activity.failed')}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

interface SeamDetailProps {
  integration: Integration;
}

/**
 * The drawer body: why this seam is in the state it is, and what it did.
 *
 * Cards here pass `headingLevel={3}`. The drawer renders its own title as the h2,
 * so a card inside it is a level below; leaving the Card default would put an h2
 * inside an h2 and flatten the outline a screen reader moves through.
 */
function SeamDetail({ integration }: Readonly<SeamDetailProps>): ReactElement {
  const t = useTranslator();

  return (
    <div className="or-stack">
      <SeamNotice integration={integration} />

      <Card tone="bone" headingLevel={3} title={t('admin.integrations.credentials.title')}>
        <p className="or-small">{t('admin.integrations.credentials.explanation')}</p>
        <Input
          label={t('admin.integrations.credentials.label')}
          mono
          readOnly
          value={integration.secretRef ?? t('admin.integrations.credentials.none')}
        />
      </Card>

      <DetailList
        columns={2}
        items={[
          { label: t('admin.integrations.detail.seam'), value: integration.seam, mono: true },
          {
            label: t('admin.integrations.detail.adapter'),
            value: integration.adapter ?? t('admin.integrations.detail.noAdapter'),
          },
          {
            label: t('admin.integrations.detail.version'),
            value: integration.adapterVersion ?? t('admin.integrations.detail.notApplicable'),
          },
          {
            label: t('admin.integrations.detail.lastActivity'),
            value: formatDateTime(t, integration.lastActivityAt, 'prose'),
          },
          {
            label: t('admin.integrations.detail.lastWorking'),
            value: formatDateTime(t, integration.lastGoodAt, 'prose'),
          },
          {
            label: t('admin.integrations.detail.webhook'),
            value: integration.webhookVerified
              ? t('admin.integrations.detail.verified')
              : t('admin.integrations.detail.notVerified'),
          },
        ]}
      />

      <Card tone="bone" headingLevel={3} title={t('admin.integrations.recentActivity.title')}>
        <ActivityLog integration={integration} />
      </Card>
    </div>
  );
}

export function IntegrationsScreen({ client }: Readonly<IntegrationsScreenProps>): ReactElement {
  const t = useTranslator();
  const options = useAdminClientOption(client);
  const integrations = useIntegrations(options);

  const [openId, setOpenId] = useState<string | null>(null);

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
        label: t('admin.integrations.openFailing'),
        keywords: searchWords(t('admin.integrations.command.problem.keywords')),
        icon: 'triangle-alert',
        perform: openFirstProblem,
      },
    ],
    [openFirstProblem, t]
  );

  return (
    <AppShell
      title={t(adminArea('integrations').labelKey)}
      description={t('admin.integrations.description')}
      breadcrumb={adminBreadcrumb(t, 'integrations')}
    >
      <ScreenCommands commands={commands} />

      {broken.length > 0 ? (
        <Card className="or-notice" data-tone="serious">
          <p className="or-body">
            <strong>
              {broken.length === 1
                ? t('admin.integrations.broken.one', { name: broken[0]?.name ?? '' })
                : t('admin.integrations.broken.other', {
                    count: formatCount(broken.length, t.locale),
                  })}
            </strong>{' '}
            {t('admin.integrations.broken.body')}
          </p>
          <Button variant="secondary" size="sm" onClick={openFirstProblem}>
            {t('admin.integrations.openFailing')}
          </Button>
        </Card>
      ) : null}

      <AsyncBoundary
        state={integrations}
        subject={t('admin.integrations.subject')}
        isEmpty={isEmptyList}
        loadingVariant="cards"
        loadingRows={6}
        empty={{
          title: t('admin.integrations.empty.title'),
          message: t('admin.integrations.empty.message'),
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
            <Badge tone={STATUS_TONE[selected.status]}>
              {t(STATUS_KEY[selected.status].labelKey)}
            </Badge>
          ) : null
        }
        footer={
          selected ? (
            <>
              <Button variant="ghost" onClick={() => setOpenId(null)}>
                {t('admin.action.close')}
              </Button>
              {/* Both disabled. The test used to read a canned sentence off the
                  status this page had already loaded and report it as a round
                  trip, so a broken adapter looked verified; saving closed the
                  drawer and wrote nothing. */}
              <Button variant="secondary" disabled>
                {t('admin.integrations.testConnection')}
              </Button>
              <Button variant="primary" disabled>
                {t('admin.integrations.saveConnection')}
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="or-stack">
            <Demonstration message={t('admin.integrations.connectionNotBuilt')} />
            <SeamDetail integration={selected} />
          </div>
        ) : null}
      </Drawer>
    </AppShell>
  );
}
