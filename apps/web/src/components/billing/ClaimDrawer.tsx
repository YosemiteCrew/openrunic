'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge, Button, Card, Table, Tag } from '@openrunic/ui';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { Claim } from '@/lib/api';
import { formatDate, formatDateTime, formatMrn, formatName, NOT_RECORDED } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { CLAIM_STATUS_LABEL_KEYS, CLAIM_STATUS_TONE, claimLifecycle } from './billing';
import { translateColumns } from './columns';
import type { KeyedColumn } from './columns';
import { Drawer } from './Drawer';
import { Money } from './Money';

/**
 * BL-04 Claim detail, in the drawer the queue opens it from.
 *
 * One timeline tells the claim's whole story: every transition, every
 * acknowledgement, every note, timestamped and attributed. In legacy systems that
 * story was scattered across EDI history, claim notes and the database; here
 * there is one place to read it and the queue behind stays visible while you
 * do.
 *
 * The rebill confirmation happens inside the drawer's own footer rather than in
 * a dialog on top of it. Stacking a modal over a drawer is the pattern the
 * canon forbids, and the consequence sentence reads just as clearly here.
 *
 * The denial reason, the denial code, the scrub errors and every event on the
 * timeline arrive from the payer or the clearinghouse and are rendered in the
 * words they came in. Rewording a denial in the interface would leave the
 * practice arguing a case in language the payer never used.
 */

const LINE_COLUMNS: readonly KeyedColumn[] = [
  { key: 'code', headerKey: 'billing.claimDrawer.line.code', mono: true },
  { key: 'description', headerKey: 'billing.claimDrawer.line.description' },
  { key: 'units', headerKey: 'billing.claimDrawer.line.units', numeric: true },
  { key: 'billed', headerKey: 'billing.claimDrawer.line.billed', numeric: true },
  { key: 'allowed', headerKey: 'billing.claimDrawer.line.allowed', numeric: true },
  { key: 'paid', headerKey: 'billing.claimDrawer.line.paid', numeric: true },
  { key: 'responsibility', headerKey: 'billing.claimDrawer.line.responsibility', numeric: true },
];

export interface ClaimDrawerProps {
  claim: Claim | null;
  onClose: () => void;
  onRebill: (claim: Claim) => void;
}

/**
 * A money cell that has not been adjudicated yet says so, rather than showing a
 * zero a biller would read as "the payer allowed nothing".
 */
function amountCell(amount: number | null, currency: string): ReactNode {
  if (amount === null) return <span className="or-small">{NOT_RECORDED}</span>;
  return <Money amount={amount} currency={currency} />;
}

interface RebillFooterProps {
  claim: Claim;
  confirming: boolean;
  onConfirmingChange: (confirming: boolean) => void;
  onRebill: (claim: Claim) => void;
  translate: Translator;
}

/**
 * Only a denied claim can be rebilled, and rebilling is a two-step action: the
 * consequence is spelled out before the button that carries it out.
 */
function RebillFooter({
  claim,
  confirming,
  onConfirmingChange,
  onRebill,
  translate,
}: Readonly<RebillFooterProps>): ReactElement | null {
  if (claim.status !== 'DENIED') return null;

  if (!confirming) {
    return (
      <Button iconLeft="refresh-cw" onClick={() => onConfirmingChange(true)}>
        {translate('billing.claimDrawer.rebill')}
      </Button>
    );
  }

  return (
    <>
      <p className="or-small or-drawer__confirm">
        {translate('billing.claimDrawer.rebillConfirm', {
          number: claim.claimNumber,
          payer: claim.payer.name,
        })}
      </p>
      <Button variant="secondary" onClick={() => onConfirmingChange(false)}>
        {translate('billing.claimDrawer.cancel')}
      </Button>
      <Button
        onClick={() => {
          onConfirmingChange(false);
          onRebill(claim);
        }}
      >
        {translate('billing.claimDrawer.rebillAction')}
      </Button>
    </>
  );
}

export function ClaimDrawer({
  claim,
  onClose,
  onRebill,
}: Readonly<ClaimDrawerProps>): ReactElement | null {
  const t = useTranslator();
  const [confirming, setConfirming] = useState(false);

  if (!claim) return null;

  const steps = claimLifecycle(claim.status);
  const reached = steps.indexOf(claim.status);

  const lineRows = claim.lines.map((line): Record<string, ReactNode> => ({
    id: line.id,
    code: line.code,
    description: (
      <span className="or-claim-line">
        <span>{line.display}</span>
        {line.modifiers.length > 0 ? <Tag mono>{line.modifiers.join(', ')}</Tag> : null}
      </span>
    ),
    units: <span className="or-mono">{line.units}</span>,
    billed: <Money amount={line.billed} currency={claim.currency} />,
    allowed: amountCell(line.allowed, claim.currency),
    paid: amountCell(line.paid, claim.currency),
    responsibility: amountCell(line.patientResponsibility, claim.currency),
  }));

  return (
    <Drawer
      open
      title={t('billing.claimDrawer.title', { number: claim.claimNumber })}
      subtitle={
        <>
          {formatName(claim.patient.name)}{' '}
          <span className="or-mono">{formatMrn(claim.patient.mrn)}</span>
          {', '}
          {t('billing.claimDrawer.payerSeen', {
            payer: claim.payer.name,
            date: formatDate(claim.serviceDate),
          })}
        </>
      }
      onClose={onClose}
      footer={
        <RebillFooter
          claim={claim}
          confirming={confirming}
          onConfirmingChange={setConfirming}
          onRebill={onRebill}
          translate={t}
        />
      }
    >
      <div className="or-claim-detail">
        <div className="or-claim-detail__summary">
          <Badge tone={CLAIM_STATUS_TONE[claim.status]}>
            {t(CLAIM_STATUS_LABEL_KEYS[claim.status])}
          </Badge>
          <dl className="or-totals">
            <div className="or-totals__row">
              <dt>{t('billing.claimDrawer.totals.billed')}</dt>
              <dd>
                <Money amount={claim.billed} currency={claim.currency} emphasis />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>{t('billing.claimDrawer.totals.paid')}</dt>
              <dd>
                <Money amount={claim.paid} currency={claim.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>{t('billing.claimDrawer.totals.responsibility')}</dt>
              <dd>
                <Money amount={claim.patientResponsibility} currency={claim.currency} />
              </dd>
            </div>
          </dl>
        </div>

        {/* headingLevel={3} on both cards: the drawer's own title is the h2, and
            the lifecycle section below already sits at h3. Without it the Card
            default of 2 would put an h2 inside an h2 and make these two cards
            outrank a sibling that is their equal. */}
        {claim.denialReason ? (
          <Card
            tone="cream"
            headingLevel={3}
            overline={t('billing.claimDrawer.denial.overline')}
            title={claim.denialCode ?? t('billing.claimDrawer.denial.untitled')}
          >
            <p className="or-body">{claim.denialReason}</p>
          </Card>
        ) : null}

        {claim.scrubErrors.length > 0 ? (
          <Card
            tone="cream"
            headingLevel={3}
            overline={t('billing.claimDrawer.scrub.overline')}
            title={t('billing.claimDrawer.scrub.title')}
          >
            <ul className="or-scrub-list">
              {claim.scrubErrors.map((error) => (
                <li key={error.code} className="or-scrub-list__item">
                  <Badge tone="danger">{error.code}</Badge>
                  <span className="or-small">{error.message}</span>
                  <Button variant="ghost" size="sm" href={error.fixHref}>
                    {t('billing.claimDrawer.scrub.fix')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <section aria-labelledby="claim-lifecycle">
          <h3 id="claim-lifecycle" className="or-h3">
            {t('billing.claimDrawer.lifecycle')}
          </h3>
          <ol className="or-stepper">
            {steps.map((step, index) => {
              const done = reached >= 0 && index <= reached;
              return (
                <li
                  key={step}
                  className={done ? 'or-stepper__step or-stepper__step--done' : 'or-stepper__step'}
                >
                  <span className="or-stepper__label">{t(CLAIM_STATUS_LABEL_KEYS[step])}</span>
                  <span className="or-caption or-stepper__state">
                    {done
                      ? t('billing.claimDrawer.step.done')
                      : t('billing.claimDrawer.step.pending')}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-labelledby="claim-events">
          <h3 id="claim-events" className="or-h3">
            {t('billing.claimDrawer.events')}
          </h3>
          <ol className="or-timeline">
            {claim.events.map((event) => (
              <li key={event.id} className="or-timeline__item">
                <p className="or-timeline__head">
                  <span className="or-timeline__label">{event.label}</span>
                  <span className="or-caption">{formatDateTime(event.at)}</span>
                </p>
                {event.detail ? <p className="or-small">{event.detail}</p> : null}
                <p className="or-caption or-timeline__actor">{event.actor}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="claim-lines">
          <h3 id="claim-lines" className="or-h3">
            {t('billing.claimDrawer.serviceLines')}
          </h3>
          <Table
            caption={t('billing.claimDrawer.serviceLines')}
            columns={translateColumns(LINE_COLUMNS, t)}
            rows={lineRows}
          />
        </section>
      </div>
    </Drawer>
  );
}
