'use client';

import { Badge, Button, Select } from '@openrunic/ui';
import { useId, useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';

import type { OrderWarning, WarningTier } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * The tiered alert (guidelines C10), as the order composer needs it.
 *
 * Three tiers, and the tier is a word before it is a colour:
 *
 * - Information: a quiet line. Nothing to do.
 * - Caution: caramel wash, espresso ink. Asks to be read and acknowledged.
 * - Critical: danger, and signing does not happen until a reason is chosen.
 *
 * Alert fatigue is the documented killer of computerised ordering, so the
 * blocking tier is reserved for genuine danger and everything else clears with
 * one click. Nothing blinks, nothing stacks: the composer shows criticals
 * first and the rest below them.
 *
 * Proposed @openrunic/ui addition: a `Callout`/`Alert` primitive with these
 * three tiers. Badge covers status words, not a banner with a body and an
 * action, and the caution tier has no token pair yet (`--status-caution`,
 * `--status-caution-wash`). Composed here rather than forking Badge.
 */

/* The tier's name, as a catalogue key rather than a word: the tier is a word
   before it is a colour, so it has to be a word the reader has. */
const TIER_LABELS: Record<WarningTier, { labelKey: string }> = {
  INFO: { labelKey: 'orders.warning.tier.info' },
  CAUTION: { labelKey: 'orders.warning.tier.caution' },
  CRITICAL: { labelKey: 'orders.warning.tier.critical' },
};

const TIER_CLASS: Record<WarningTier, string> = {
  INFO: 'or-alert--info',
  CAUTION: 'or-alert--caution',
  CRITICAL: 'or-alert--critical',
};

export interface TieredAlertProps {
  tier: WarningTier;
  title: string;
  detail: string;
  children?: ReactNode;
}

export function TieredAlert({
  tier,
  title,
  detail,
  children,
}: Readonly<TieredAlertProps>): ReactElement {
  const t = useTranslator();
  /* `title` and `detail` are the warning as the rule engine wrote it, so only
     the tier word around them is translated. */
  const tierLabel = t(TIER_LABELS[tier].labelKey);

  return (
    <section
      className={`or-alert ${TIER_CLASS[tier]}`}
      // A critical alert interrupts, because it is the one that stops a signature.
      // The lower tiers are read in flow and would only add noise if announced.
      role={tier === 'CRITICAL' ? 'alert' : 'note'}
      aria-label={t('orders.warning.label', { tier: tierLabel, title })}
    >
      <p className="or-overline or-alert__tier">{tierLabel}</p>
      <h4 className="or-small or-alert__title">{title}</h4>
      <p className="or-small or-alert__detail">{detail}</p>
      {children ? <div className="or-alert__actions">{children}</div> : null}
    </section>
  );
}

export interface OrderWarningsProps {
  warnings: OrderWarning[];
  /** Warning id to the reason it was cleared with. Criticals need a reason. */
  cleared: Record<string, string>;
  onClear: (warningId: string, reason: string) => void;
  onRestore: (warningId: string) => void;
}

/** Every warning the current draft raises, criticals first. */
export function OrderWarnings({
  warnings,
  cleared,
  onClear,
  onRestore,
}: Readonly<OrderWarningsProps>): ReactElement | null {
  if (warnings.length === 0) return null;

  return (
    <div className="or-stack" data-testid="order-warnings">
      {warnings.map((warning) => (
        <WarningRow
          key={warning.id}
          warning={warning}
          clearedWith={cleared[warning.id]}
          onClear={onClear}
          onRestore={onRestore}
        />
      ))}
    </div>
  );
}

interface WarningRowProps {
  warning: OrderWarning;
  clearedWith: string | undefined;
  onClear: (warningId: string, reason: string) => void;
  onRestore: (warningId: string) => void;
}

function WarningRow({
  warning,
  clearedWith,
  onClear,
  onRestore,
}: Readonly<WarningRowProps>): ReactElement {
  const t = useTranslator();
  /* The reasons themselves come from the rule that raised the warning and are
     recorded verbatim; only the fallback, used by the tiers that offer no list
     to choose from, is this application's own word. */
  const reasons = warning.overrideReasons ?? [];
  const [reason, setReason] = useState(reasons[0] ?? t('orders.warning.defaultReason'));
  const selectId = useId();

  if (warning.tier === 'INFO') {
    return <TieredAlert tier="INFO" title={warning.title} detail={warning.detail} />;
  }

  if (clearedWith) {
    return (
      <TieredAlert tier={warning.tier} title={warning.title} detail={warning.detail}>
        <Badge tone="neutral" icon="check">
          {warning.tier === 'CRITICAL'
            ? t('orders.warning.overridden')
            : t('orders.warning.acknowledged')}
        </Badge>
        <span className="or-small or-alert__reason">{clearedWith}</span>
        {/* Two whole sentences rather than one with the noun swapped in: which
            word a language puts where is not this component's decision. */}
        <Button variant="ghost" size="sm" onClick={() => onRestore(warning.id)}>
          {warning.tier === 'CRITICAL'
            ? t('orders.warning.undoOverride')
            : t('orders.warning.undoWarning')}
        </Button>
      </TieredAlert>
    );
  }

  return (
    <TieredAlert tier={warning.tier} title={warning.title} detail={warning.detail}>
      {warning.tier === 'CRITICAL' ? (
        <Select
          id={selectId}
          label={t('orders.warning.reasonLabel')}
          options={reasons}
          value={reason}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setReason(event.target.value)}
        />
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        iconLeft={warning.tier === 'CRITICAL' ? 'shield-alert' : 'check'}
        onClick={() => onClear(warning.id, reason)}
      >
        {warning.tier === 'CRITICAL'
          ? t('orders.warning.override')
          : t('orders.warning.acknowledge')}
      </Button>
    </TieredAlert>
  );
}
