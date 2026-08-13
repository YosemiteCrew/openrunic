import { autoAllocate } from '@/components/billing';
import type { OpenItem } from '@/components/billing';
import type { PaymentMethodKind } from '@/lib/api';

/**
 * The payment being assembled at the desk.
 *
 * Account, amount, method, reference and allocation are not five independent
 * settings; they are one tender. Choosing a different patient invalidates the
 * amount and every allocation, and capturing clears all of them at once. Held
 * as five `useState` values that was five setter calls per transition, any one
 * of which a later edit could forget, leaving the desk allocating one patient's
 * money against another patient's visits.
 */

export interface Tender {
  /** Null means "whichever account the list defaults to". */
  accountId: string | null;
  /** Raw text: the field is a text input until it parses. */
  amountText: string;
  method: PaymentMethodKind;
  /** Check number, or the reference printed on the receipt. */
  reference: string;
  /** Money against a visit, in major units, keyed by visit id. */
  allocations: Record<string, number>;
}

export type TenderAction =
  | { type: 'selectAccount'; accountId: string }
  | { type: 'setAmount'; text: string }
  | { type: 'setMethod'; method: PaymentMethodKind }
  | { type: 'setReference'; reference: string }
  | { type: 'allocate'; visitId: string; value: number }
  | { type: 'allocateOldestFirst'; amount: number; items: readonly OpenItem[] }
  | { type: 'captured' };

export const EMPTY_TENDER: Tender = {
  accountId: null,
  amountText: '',
  method: 'CARD_ON_FILE',
  reference: '',
  allocations: {},
};

export function reduceTender(tender: Tender, action: TenderAction): Tender {
  switch (action.type) {
    case 'selectAccount':
      // A new patient means a new tender. Carrying the amount or the
      // allocations across is how money lands on the wrong visit.
      return { ...EMPTY_TENDER, accountId: action.accountId, method: tender.method };

    case 'setAmount':
      return { ...tender, amountText: action.text };

    case 'setMethod':
      return { ...tender, method: action.method };

    case 'setReference':
      return { ...tender, reference: action.reference };

    case 'allocate':
      return {
        ...tender,
        allocations: {
          ...tender.allocations,
          // Never negative: a negative allocation would read as a refund on a
          // screen that cannot issue one.
          [action.visitId]: Number.isFinite(action.value) ? Math.max(action.value, 0) : 0,
        },
      };

    case 'allocateOldestFirst':
      return { ...tender, allocations: autoAllocate(action.amount, action.items) };

    case 'captured':
      // The account stays selected: the desk usually takes one payment and then
      // looks at what is left on the same patient.
      return { ...EMPTY_TENDER, accountId: tender.accountId, method: tender.method };
  }
}
