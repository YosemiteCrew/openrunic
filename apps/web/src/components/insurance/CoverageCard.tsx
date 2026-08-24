'use client';

import type { Translator } from '@openrunic/i18n';
import { formatCount } from '@openrunic/i18n';
import { Badge, Button, Card, IconButton, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { CoveragePriority, MockCoverage, MockEligibilityResult } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, NOT_RECORDED } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { presentEligibility, PRIORITY_LABEL } from './eligibility';

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
 *
 * The field names and the status words come from the catalogue. What the
 * coverage carries - payer, plan, member id, group, subscriber and their
 * relationship to the patient, and the sentence the payer sent back as
 * `detail` - renders exactly as it arrived, because each of those already has
 * one name and does not need a second.
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
function moneyText(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return NOT_RECORDED;
  return formatMoney(amount).text;
}

/** What the card knows about the policy itself, before anyone verifies it. */
function CoverageFacts({ coverage }: Readonly<{ coverage: MockCoverage }>): ReactElement {
  const t = useTranslator();
  return (
    <dl className="or-coverage__facts">
      <div>
        <dt className="or-caption">{t('insurance.card.memberId')}</dt>
        <dd className="or-mono">{coverage.memberId}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.card.group')}</dt>
        <dd className="or-mono">{coverage.groupNumber ?? NOT_RECORDED}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.card.subscriber')}</dt>
        {/* The relationship is a code the coverage carries
            (`subscriberRelationshipCode` in the schema), so it is shown as it
            arrived rather than given a second, translated name here. */}
        <dd>
          {coverage.subscriberName} ({coverage.subscriberRelationship.toLowerCase()})
        </dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.card.effective')}</dt>
        <dd>
          {t('insurance.card.effectiveRange', {
            from: formatDate(coverage.effectiveFrom),
            to: coverage.effectiveTo
              ? formatDate(coverage.effectiveTo)
              : t('insurance.card.noEndDate'),
          })}
        </dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.card.copay')}</dt>
        <dd className="or-mono">{moneyText(coverage.copayAmount)}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.card.assignment')}</dt>
        <dd>
          {coverage.assignmentOfBenefits
            ? t('insurance.card.assignmentAccepted')
            : t('insurance.card.assignmentNotAccepted')}
        </dd>
      </div>
    </dl>
  );
}

/** The numbers a payer returns only when the policy is actually active. */
function ActiveBenefits({ result }: Readonly<{ result: MockEligibilityResult }>): ReactElement {
  const t = useTranslator();
  return (
    <dl className="or-coverage__benefits">
      <div>
        <dt className="or-caption">{t('insurance.card.copayToday')}</dt>
        <dd className="or-mono">{moneyText(result.copayAmount)}</dd>
      </div>
      <div>
        <dt className="or-caption">{t('insurance.card.deductibleRemaining')}</dt>
        <dd className="or-mono">{moneyText(result.deductibleRemaining)}</dd>
      </div>
    </dl>
  );
}

interface EligibilityStatusProps {
  coverage: MockCoverage;
  checking: boolean;
  result: MockEligibilityResult | null;
  presented: ReturnType<typeof presentEligibility>;
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
}: Readonly<EligibilityStatusProps>): ReactElement {
  const t = useTranslator();

  if (checking) {
    return (
      <output className="or-body">
        {t('insurance.card.checking', { payer: coverage.payerName })}
      </output>
    );
  }

  return (
    <>
      <div className="or-coverage__chips">
        <Badge tone={presented.tone}>{t(presented.labelKey)}</Badge>
        {presented.degraded ? <Tag>{t('insurance.card.queued')}</Tag> : null}
      </div>
      {result ? (
        /* The payer's own sentence, not ours to rewrite. */
        <p className="or-body">{result.detail}</p>
      ) : (
        <p className="or-small">
          {coverage.lastVerifiedAt
            ? t('insurance.card.lastVerified', {
                when: formatDateTime(coverage.lastVerifiedAt),
              })
            : t('insurance.card.neverVerified')}
        </p>
      )}
      {presented.guidanceKey ? <p className="or-small">{t(presented.guidanceKey)}</p> : null}
      {result?.outcome === 'ACTIVE' ? <ActiveBenefits result={result} /> : null}
    </>
  );
}

/** One earlier answer in this session: when it was asked, and what came back. */
function HistoryRow({
  t,
  entry,
}: Readonly<{ t: Translator; entry: MockEligibilityResult }>): ReactElement {
  return (
    <li className="or-small">
      <span className="or-mono">{formatDateTime(entry.checkedAt)}</span>
      {' · '}
      {t(presentEligibility(entry.outcome).labelKey)}
    </li>
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
      overline={t('insurance.card.priority', { priority: t(PRIORITY_LABEL[priority].labelKey) })}
      title={coverage.payerName}
      className="or-coverage"
      data-degraded={presented.degraded || undefined}
    >
      <div className="or-coverage__head">
        <p className="or-body">{coverage.planName}</p>
        <div className="or-coverage__reorder">
          <IconButton
            icon="arrow-up"
            label={t('insurance.card.moveUp', { payer: coverage.payerName })}
            variant="ghost"
            size="sm"
            disabled={!canMoveUp}
            onClick={() => onMove(coverage, -1)}
          />
          <IconButton
            icon="arrow-down"
            label={t('insurance.card.moveDown', { payer: coverage.payerName })}
            variant="ghost"
            size="sm"
            disabled={!canMoveDown}
            onClick={() => onMove(coverage, 1)}
          />
        </div>
      </div>

      <CoverageFacts coverage={coverage} />

      <div className="or-coverage__status">
        <EligibilityStatus
          coverage={coverage}
          checking={checking}
          result={result}
          presented={presented}
        />
      </div>

      {history.length > 0 ? (
        <details className="or-coverage__history">
          <summary className="or-small">
            {t('insurance.card.history', { count: formatCount(history.length, t.locale) })}
          </summary>
          <ul>
            {history.map((entry) => (
              /* One coverage cannot be checked twice in the same instant, so the
                 pair identifies the row even when the list is refiltered. */
              <HistoryRow key={`${entry.coverageId}-${entry.checkedAt}`} t={t} entry={entry} />
            ))}
          </ul>
        </details>
      ) : null}

      <div className="or-coverage__actions">
        <Button
          iconLeft="shield-check"
          disabled={checking}
          onClick={() => onVerify(coverage)}
          aria-label={t('insurance.card.verifyFor', { payer: coverage.payerName })}
        >
          {checking ? t('insurance.card.verifying') : t('insurance.card.verify')}
        </Button>
      </div>
    </Card>
  );
}
