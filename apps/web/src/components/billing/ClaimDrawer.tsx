'use client';

import { Badge, Button, Card, Table, Tag } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { Claim } from '@/lib/api';
import { formatDate, formatDateTime, formatMrn, formatName, NOT_RECORDED } from '@/lib/format';

import { CLAIM_STATUS_LABELS, CLAIM_STATUS_TONE, claimLifecycle } from './billing';
import { Drawer } from './Drawer';
import { Money } from './Money';

/**
 * BL-04 Claim detail, in the drawer the queue opens it from.
 *
 * One timeline tells the claim's whole story: every transition, every
 * acknowledgement, every note, timestamped and attributed. In OpenEMR that
 * story was scattered across EDI history, claim notes and the database; here
 * there is one place to read it and the queue behind stays visible while you
 * do.
 *
 * The rebill confirmation happens inside the drawer's own footer rather than in
 * a dialog on top of it. Stacking a modal over a drawer is the pattern the
 * canon forbids, and the consequence sentence reads just as clearly here.
 */

const LINE_COLUMNS: TableColumn[] = [
  { key: 'code', header: 'Code', mono: true },
  { key: 'description', header: 'Description' },
  { key: 'units', header: 'Units', numeric: true },
  { key: 'billed', header: 'Billed', numeric: true },
  { key: 'allowed', header: 'Allowed', numeric: true },
  { key: 'paid', header: 'Paid', numeric: true },
  { key: 'responsibility', header: 'Patient responsibility', numeric: true },
];

export interface ClaimDrawerProps {
  claim: Claim | null;
  onClose: () => void;
  onRebill: (claim: Claim) => void;
}

export function ClaimDrawer({ claim, onClose, onRebill }: ClaimDrawerProps): ReactElement | null {
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
    allowed:
      line.allowed === null ? (
        <span className="or-small">{NOT_RECORDED}</span>
      ) : (
        <Money amount={line.allowed} currency={claim.currency} />
      ),
    paid:
      line.paid === null ? (
        <span className="or-small">{NOT_RECORDED}</span>
      ) : (
        <Money amount={line.paid} currency={claim.currency} />
      ),
    responsibility:
      line.patientResponsibility === null ? (
        <span className="or-small">{NOT_RECORDED}</span>
      ) : (
        <Money amount={line.patientResponsibility} currency={claim.currency} />
      ),
  }));

  return (
    <Drawer
      open
      title={`Claim ${claim.claimNumber}`}
      subtitle={
        <>
          {formatName(claim.patient.name)}{' '}
          <span className="or-mono">{formatMrn(claim.patient.mrn)}</span>
          {', '}
          {claim.payer.name}, seen {formatDate(claim.serviceDate)}
        </>
      }
      onClose={onClose}
      footer={
        claim.status === 'DENIED' ? (
          confirming ? (
            <>
              <p className="or-small or-drawer__confirm">
                Correct and rebill {claim.claimNumber} to {claim.payer.name}. The original stays on
                the record and the replacement links back to it.
              </p>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  onRebill(claim);
                }}
              >
                Rebill claim
              </Button>
            </>
          ) : (
            <Button iconLeft="refresh-cw" onClick={() => setConfirming(true)}>
              Correct and rebill
            </Button>
          )
        ) : null
      }
    >
      <div className="or-claim-detail">
        <div className="or-claim-detail__summary">
          <Badge tone={CLAIM_STATUS_TONE[claim.status]}>{CLAIM_STATUS_LABELS[claim.status]}</Badge>
          <dl className="or-totals">
            <div className="or-totals__row">
              <dt>Billed</dt>
              <dd>
                <Money amount={claim.billed} currency={claim.currency} emphasis />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>Paid</dt>
              <dd>
                <Money amount={claim.paid} currency={claim.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>Patient responsibility</dt>
              <dd>
                <Money amount={claim.patientResponsibility} currency={claim.currency} />
              </dd>
            </div>
          </dl>
        </div>

        {claim.denialReason ? (
          <Card tone="cream" overline="Denial" title={claim.denialCode ?? 'Denied'}>
            <p className="or-body">{claim.denialReason}</p>
          </Card>
        ) : null}

        {claim.scrubErrors.length > 0 ? (
          <Card tone="cream" overline="Scrub" title="Fix before submitting">
            <ul className="or-scrub-list">
              {claim.scrubErrors.map((error) => (
                <li key={error.code} className="or-scrub-list__item">
                  <Badge tone="danger">{error.code}</Badge>
                  <span className="or-small">{error.message}</span>
                  <Button variant="ghost" size="sm" href={error.fixHref}>
                    Fix on the fee sheet
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <section aria-labelledby="claim-lifecycle">
          <h3 id="claim-lifecycle" className="or-h3">
            Lifecycle
          </h3>
          <ol className="or-stepper">
            {steps.map((step, index) => {
              const done = reached >= 0 && index <= reached;
              return (
                <li
                  key={step}
                  className={done ? 'or-stepper__step or-stepper__step--done' : 'or-stepper__step'}
                >
                  <span className="or-stepper__label">{CLAIM_STATUS_LABELS[step]}</span>
                  <span className="or-caption or-stepper__state">{done ? 'Done' : 'Pending'}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-labelledby="claim-events">
          <h3 id="claim-events" className="or-h3">
            Event history
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
            Service lines
          </h3>
          <Table caption="Service lines" columns={LINE_COLUMNS} rows={lineRows} />
        </section>
      </div>
    </Drawer>
  );
}
