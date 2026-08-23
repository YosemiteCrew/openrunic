import type { DraftOrder } from '@/components/orders';

/**
 * The order draft being composed, as one value.
 *
 * The drafted orders, the overrides that cleared their warnings, which step the
 * composer is on and whether the blockers are being shown are one workflow, not
 * four settings. Every transition that matters touches several of them at once:
 * signing empties the draft AND drops the overrides AND returns to the build
 * step, and switching patients does the same. Held as four `useState` values,
 * that was four setter calls per transition, and an override left behind after
 * a patient switch would silently clear a warning about a different chart.
 */

export type Step = 'build' | 'review';

export interface Composition {
  drafts: DraftOrder[];
  /** Warning id to the reason the clinician gave for overriding it. */
  cleared: Record<string, string>;
  step: Step;
  /** Set only after a sign attempt, so blockers never nag before one. */
  showBlockers: boolean;
}

export type CompositionAction =
  | { type: 'add'; draft: DraftOrder }
  | { type: 'update'; key: string; patch: Partial<DraftOrder> }
  | { type: 'remove'; key: string }
  | { type: 'clearWarning'; warningId: string; reason: string }
  | { type: 'restoreWarning'; warningId: string }
  | { type: 'goTo'; step: Step }
  | { type: 'revealBlockers' }
  | { type: 'reset' };

export const EMPTY_COMPOSITION: Composition = {
  drafts: [],
  cleared: {},
  step: 'build',
  showBlockers: false,
};

export function reduceComposition(
  composition: Composition,
  action: CompositionAction
): Composition {
  switch (action.type) {
    case 'add':
      // Adding an order can only invalidate a sign attempt, so the blockers
      // stop being shown until the next one.
      return {
        ...composition,
        drafts: [...composition.drafts, action.draft],
        showBlockers: false,
      };

    case 'update':
      return {
        ...composition,
        drafts: composition.drafts.map((draft) =>
          draft.key === action.key ? { ...draft, ...action.patch } : draft
        ),
      };

    case 'remove':
      return {
        ...composition,
        drafts: composition.drafts.filter((draft) => draft.key !== action.key),
      };

    case 'clearWarning':
      return {
        ...composition,
        cleared: { ...composition.cleared, [action.warningId]: action.reason },
      };

    case 'restoreWarning': {
      const cleared = { ...composition.cleared };
      delete cleared[action.warningId];
      return { ...composition, cleared };
    }

    case 'goTo':
      return { ...composition, step: action.step };

    case 'revealBlockers':
      return { ...composition, showBlockers: true };

    case 'reset':
      return EMPTY_COMPOSITION;
  }
}
