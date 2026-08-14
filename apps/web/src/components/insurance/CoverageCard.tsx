'use client';

import { Badge, Button, Card, IconButton, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { CoveragePriority, MockCoverage, MockEligibilityResult } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, NOT_RECORDED } from '@/lib/format';

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
  return (
    <dl className="or-coverage__facts">
      <div>
        <dt className="or-caption">Member id</dt>
        <dd className="or-mono">{coverage.memberId}</dd>
      </div>
      <div>
        <dt className="or-caption">Group</dt>
        <dd className="or-mono">{coverage.groupNumber ?? NOT_RECORDED}</dd>
      </div>
      <div>
        <dt className="or-caption">Subscriber</dt>
        <dd>
          {coverage.subscriberName} ({coverage.subscriberRelationship.toLowerCase()})
        </dd>
      </div>
      <div>
        <dt className="or-caption">Effective</dt>
        <dd>
          {formatDate(coverage.effectiveFrom)} to{' '}
          {coverage.effectiveTo ? formatDate(coverage.effectiveTo) : 'no end date'}
        </dd>
      </div>
      <div>
        <dt className="or-caption">Copay</dt>
        <dd className="or-mono">{moneyText(coverage.copayAmount)}</dd>
      </div>
      <div>
        <dt className="or-caption">Assignment of benefits</dt>
        <dd>{coverage.assignmentOfBenefits ? 'Accepted' : 'Not accepted'}</dd>
      </div>
    </dl>
  );
}

/** The numbers a payer returns only when the policy is actually active. */
function ActiveBenefits({ result }: Readonly<{ result: MockEligibilityResult }>): ReactElement {
  return (
    <dl className="or-coverage__benefits">
      <div>
        <dt className="or-caption">Copay today</dt>
        <dd className="or-mono">{moneyText(result.copayAmount)}</dd>
      </div>
      <div>
        <dt className="or-caption">Deductible remaining</dt>
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
  if (checking) {
    return <output className="or-body">Checking eligibility with {coverage.payerName}</output>;
  }

  return (
    <>
      <div className="or-coverage__chips">
        <Badge tone={presented.tone}>{presented.label}</Badge>
        {presented.degraded ? <Tag>Queued</Tag> : null}
      </div>
      {result ? (
        <p className="or-body">{result.detail}</p>
      ) : (
        <p className="or-small">
          {coverage.lastVerifiedAt
            ? `Last verified ${formatDateTime(coverage.lastVerifiedAt)}.`
            : 'This coverage has never been verified.'}
        </p>
      )}
      {presented.guidance ? <p className="or-small">{presented.guidance}</p> : null}
      {result?.outcome === 'ACTIVE' ? <ActiveBenefits result={result} /> : null}
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
  const presented = presentEligibility(result?.outcome ?? coverage.lastOutcome);

  return (
    <Card
      overline={`${PRIORITY_LABEL[priority]} coverage`}
      title={coverage.payerName}
      className="or-coverage"
      data-degraded={presented.degraded || undefined}
    >
      <div className="or-coverage__head">
        <p className="or-body">{coverage.planName}</p>
        <div className="or-coverage__reorder">
          <IconButton
            icon="arrow-up"
            label={`Move ${coverage.payerName} up the priority order`}
            variant="ghost"
            size="sm"
            disabled={!canMoveUp}
            onClick={() => onMove(coverage, -1)}
          />
          <IconButton
            icon="arrow-down"
            label={`Move ${coverage.payerName} down the priority order`}
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
          <summary className="or-small">Eligibility history ({history.length})</summary>
          <ul>
            {history.map((entry) => (
              /* One coverage cannot be checked twice in the same instant, so the
                 pair identifies the row even when the list is refiltered. */
              <li key={`${entry.coverageId}-${entry.checkedAt}`} className="or-small">
                <span className="or-mono">{formatDateTime(entry.checkedAt)}</span>
                {' · '}
                {presentEligibility(entry.outcome).label}
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
          aria-label={`Verify eligibility with ${coverage.payerName} now`}
        >
          {checking ? 'Checking' : 'Verify now'}
        </Button>
      </div>
    </Card>
  );
}
