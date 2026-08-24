import type { EmittedItemKind } from '@/lib/api/chart/types';

/**
 * What a note emits, as catalogue keys.
 *
 * `EmittedItemKind` is declared in `lib/api/chart/types.ts` and mirrors an enum
 * in `@openrunic/database`, so the API sends `FOLLOW_UP` and no display for it.
 * The word beside the colon was `formatEnumLabel`'s, which is this codebase
 * naming its own value and then reading the name back as though somebody else
 * had supplied it.
 *
 * `item.label` on the same line is the other side: that is what the order or
 * the prescription is called, and it arrives already named.
 */
export const EMITTED_KIND_LABELS: Record<EmittedItemKind, { labelKey: string }> = {
  ORDER: { labelKey: 'encounter.emittedKind.order' },
  PRESCRIPTION: { labelKey: 'encounter.emittedKind.prescription' },
  PROBLEM: { labelKey: 'encounter.emittedKind.problem' },
  FOLLOW_UP: { labelKey: 'encounter.emittedKind.followUp' },
};
