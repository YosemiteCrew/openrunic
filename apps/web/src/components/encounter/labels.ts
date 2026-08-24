import type { EmittedItemKind } from '@/lib/api/chart/types';

/**
 * What a note emits, as catalogue keys.
 *
 * `EmittedItemKind` is declared in `lib/api/chart/types.ts` and nowhere else.
 * It is not a Prisma enum, and `chart/live.ts` says why: "The API has no
 * structured record of what a command block emitted", so this is a view model
 * the editor derives rather than anything the wire carries. Nothing outside
 * this codebase has ever named a `FOLLOW_UP`.
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
