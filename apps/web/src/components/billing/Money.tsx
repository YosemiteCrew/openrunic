'use client';

import type { ReactElement } from 'react';

import { formatMoney } from '@/lib/format';
import type { NegativeLabel } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * The money cell the canon calls C27, in one component.
 *
 * Right-aligned tabular figures, a negative in parentheses AND carrying its
 * word ("Credit", "Refund"), and the whole amount spoken properly for a screen
 * reader, because parentheses do not read as a minus sign. Every amount on a
 * billing surface goes through this, so no screen can quietly render a bare
 * number with no currency.
 *
 * `negativeLabel` names which meaning applies rather than supplying the word.
 * The word itself comes from the catalogue, so a Spanish reader sees "Saldo a
 * favor" where an English one sees "Credit" and neither screen had to know.
 */

export interface MoneyProps {
  amount: number;
  currency?: string;
  negativeLabel?: NegativeLabel;
  /** Renders the amount at the size a total deserves. */
  emphasis?: boolean;
}

export function Money({
  amount,
  currency = 'USD',
  negativeLabel,
  emphasis = false,
}: Readonly<MoneyProps>): ReactElement {
  const t = useTranslator();
  const money = formatMoney(t, amount, { currency, negativeLabel });

  return (
    <span className={emphasis ? 'or-money or-money--total' : 'or-money'}>
      <span aria-hidden="true" className="or-mono">
        {money.text}
      </span>
      {money.label ? (
        <span aria-hidden="true" className="or-money__label">
          {money.label}
        </span>
      ) : null}
      <span className="or-visually-hidden">{money.srText}</span>
    </span>
  );
}
