'use client';

/**
 * A money figure. Tabular, right-alignable, and never a bare number.
 *
 * A negative amount is money owed back to the patient, so it renders as a positive figure
 * with the word "credit" beside it. The sign alone would be easy to miss and impossible to
 * hear, which is the same failure as signalling status with colour.
 */

import { formatMoney, formatMoneyWithCode } from '@/lib/format';
import type { Money as MoneyValue } from '@/lib/api/types';

export interface MoneyProps {
  value: MoneyValue;
  /** Appends the ISO code, for a headline figure that has to name its currency outright. */
  showCode?: boolean;
}

export function Money({ value, showCode = false }: MoneyProps) {
  const isCredit = value.amountMinor < 0;

  return (
    <span className="portal-money">
      <span className="portal-money__figure">
        {showCode ? formatMoneyWithCode(value) : formatMoney(value)}
      </span>
      {isCredit ? <span className="portal-money__credit">credit</span> : null}
    </span>
  );
}
