'use client';

import { formatCount } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';
import { Badge, Button, Card, IconButton, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { CoveragePriority, MockCoverage, MockEligibilityResult } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, NOT_RECORDED } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { presentEligibility, PRIORITY_COPY } from './eligibility';

/**
 * One coverage slot, with its live eligibility answer attached.
 *
 * Everything a biller needs to raise a claim is on the face of the card: payer,
 * plan, member id, subscriber, dates, copay and assignment of benefits. The
 * eligibility answer sits with it rather than in a separate log, because the
 * question "is this good today" is the only reason anyone opens this screen.
 *
 * Nothing here handles a file. The legacy 270/271 flow was a batch-file shuffle; this
 * is one button and one sentence back.
 */

export interface CoverageCardProps {
  coverage: MockCoverage;
  /** Position in the stack decides the slot, so reordering is the whole edit. */
  priority: CoveragePriority;
  /** True while the adapter is being asked. */
  checking: boolean;
  /** The most recent answer in this session, newest first after it. */
  result: MockEligibilityResult | null;
  /** Earlier answers this session, newest first. */
  history: readonly MockEligibilityResult[];
  onVerify: (coverage: MockCoverage) => void;
  onMove: (coverage: MockCoverage, direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/** A money field that has no value says so, rather than showing a zero. */
function moneyText(t: Translator, amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return NOT_RECORDED;
  return formatMoney(t, amount).text;
}

/**
 * What the card knows about the policy itself, before anyone verifies it.
 *
 * The member id, the group number, the payer's own subscriber name and the
 * relationship code are the payer's words, not this application's, so they are
 * rendered as they arrive. Only the labels beside them are translated.
 */
function CoverageFacts({
  coverage,
  t,
}: Readonly<{ coverage: MockCoverage; t: Translator }>): ReactElement {
  return (
    <dl className="or-coverage__facts">
      <div>
        <dt className="or-caption">{t('insurance.coverage.memberId')}</dt>
        <dd className="or-mono">{coverage.memberId}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.coverage.group')}</dt>
        <dd className="or-mono">{coverage.groupNumber ?? NOT_RECORDED}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.coverage.subscriber')}</dt>
        <dd>
          {coverage.subscriberName} ({coverage.subscriberRelationship.toLowerCase()})
        </dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.coverage.effective')}</dt>
        <dd>
          {t('insurance.coverage.effectiveRange', {
            from: formatDate(coverage.effectiveFrom),
            to: coverage.effectiveTo
              ? formatDate(coverage.effectiveTo)
              : t('insurance.coverage.noEndDate'),
          })}
        </dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.coverage.copay')}</dt>
        <dd className="or-mono">{moneyText(t, coverage.copayAmount)}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.coverage.assignment')}</dt>
        <dd>
          {coverage.assignmentOfBenefits
            ? t('insurance.coverage.accepted')
            : t('insurance.coverage.notAccepted')}
        </dd>
      </div>
    </dl>
  );
}

/** The numbers a payer returns only when the policy is actually active. */
function ActiveBenefits({
  result,
  t,
}: Readonly<{ result: MockEligibilityResult; t: Translator }>): ReactElement {
  return (
    <dl className="or-coverage__benefits">
      <div>
        <dt className="or-caption">{t('insurance.coverage.copayToday')}</dt>
        <dd className="or-mono">{moneyText(t, result.copayAmount)}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.coverage.deductibleRemaining')}</dt>
        <dd className="or-mono">{moneyText(t, result.deductibleRemaining)}</dd>
      </div>
    </dl>
  );
}

interface EligibilityStatusProps {
  coverage: MockCoverage;
  checking: boolean;
  result: MockEligibilityResult | null;
  presented: ReturnType<typeof presentEligibility>;
  t: Translator;
}

/**
 * The answer, or the fact that nobody has asked. "Never verified" is a
 * different statement from "verified and inactive", and the card says which.
 */
function EligibilityStatus({
  coverage,
  checking,
  result,
  presented,
  t,
}: Readonly<EligibilityStatusProps>): ReactElement {
  if (checking) {
    return (
      <output className="or-body">
        {t('insurance.coverage.checking', { payer: coverage.payerName })}
      </output>
    );
  }

  return (
    <>
      <div className="or-coverage__chips">
        <Badge tone={presented.tone}>{t(presented.labelKey)}</Badge>
        {presented.degraded ? <Tag>{t('insurance.coverage.queued')}</Tag> : null}
      </div>
      {/* The detail sentence is the payer's answer, relayed as it arrived. */}
      {result ? (
        <p className="or-body">{result.detail}</p>
      ) : (
        <p className="or-small">
          {coverage.lastVerifiedAt
            ? t('insurance.coverage.lastVerified', {
                when: formatDateTime(coverage.lastVerifiedAt),
              })
            : t('insurance.coverage.neverVerified')}
        </p>
      )}
      {presented.guidanceKey === null ? null : (
        <p className="or-small">{t(presented.guidanceKey)}</p>
      )}
      {result?.outcome === 'ACTIVE' ? <ActiveBenefits result={result} t={t} /> : null}
    </>
  );
}

export function CoverageCard({
  coverage,
  priority,
  checking,
  result,
  history,
  onVerify,
  onMove,
  canMoveUp,
  canMoveDown,
}: Readonly<CoverageCardProps>): ReactElement {
  const t = useTranslator();
  const presented = presentEligibility(result?.outcome ?? coverage.lastOutcome);

  return (
    <Card
      overline={t(PRIORITY_COPY[priority].overlineKey)}
      title={coverage.payerName}
      className="or-coverage"
      data-degraded={presented.degraded || undefined}
    >
      <div className="or-coverage__head">
        <p className="or-body">{coverage.planName}</p>
        <div className="or-coverage__reorder">
          <IconButton
            icon="arrow-up"
            label={t('insurance.coverage.moveUp', { payer: coverage.payerName })}
            variant="ghost"
            size="sm"
            disabled={!canMoveUp}
            onClick={() => onMove(coverage, -1)}
          />
          <IconButton
            icon="arrow-down"
            label={t('insurance.coverage.moveDown', { payer: coverage.payerName })}
            variant="ghost"
            size="sm"
            disabled={!canMoveDown}
            onClick={() => onMove(coverage, 1)}
          />
        </div>
      </div>

      <CoverageFacts coverage={coverage} t={t} />

      <div className="or-coverage__status">
        <EligibilityStatus
          coverage={coverage}
          checking={checking}
          result={result}
          presented={presented}
          t={t}
        />
      </div>

      {history.length > 0 ? (
        <details className="or-coverage__history">
          <summary className="or-small">
            {t('insurance.coverage.historySummary', {
              count: formatCount(history.length, t.locale),
            })}
          </summary>
          <ul>
            {history.map((entry) => (
              /* One coverage cannot be checked twice in the same instant, so the
                 pair identifies the row even when the list is refiltered. */
              <li key={`${entry.coverageId}-${entry.checkedAt}`} className="or-small">
                <span className="or-mono">{formatDateTime(entry.checkedAt)}</span>
                {' · '}
                {t(presentEligibility(entry.outcome).labelKey)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="or-coverage__actions">
        <Button
          iconLeft="shield-check"
          disabled={checking}
          onClick={() => onVerify(coverage)}
          aria-label={t('insurance.coverage.verifyWith', { payer: coverage.payerName })}
        >
          {checking ? t('insurance.coverage.verifying') : t('insurance.coverage.verify')}
        </Button>
      </div>
    </Card>
  );
}
