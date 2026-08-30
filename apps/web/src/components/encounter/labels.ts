import type { EmittedItemKind, NoteSectionKey } from '@/lib/api/chart/types';

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

/**
 * What each SOAP block is called, and what belongs in it.
 *
 * `NoteSection` carries only its key. The heading and the hint used to ride
 * along on it, written out in English twice: once in `lib/api/chart/live.ts`
 * and once in `lib/api/mock/chart.ts`. Neither copy was anything the API sent -
 * that file says so itself, "the API has no opinion about what a block is
 * called" - so both were this editor naming its own blocks and then reading the
 * names back off the wire as though somebody else had supplied them.
 *
 * `nameKey` is the block named inside a sentence, for the button that says which
 * block a command will be inserted into. It is a separate message rather than
 * `label.toLowerCase()`, because lower case mid-sentence is a fact about English
 * and German capitalises the noun in both places.
 */
export const NOTE_SECTION_COPY: Record<
  NoteSectionKey,
  { labelKey: string; nameKey: string; hintKey: string }
> = {
  subjective: {
    labelKey: 'encounter.section.subjective.label',
    nameKey: 'encounter.section.subjective.name',
    hintKey: 'encounter.section.subjective.hint',
  },
  objective: {
    labelKey: 'encounter.section.objective.label',
    nameKey: 'encounter.section.objective.name',
    hintKey: 'encounter.section.objective.hint',
  },
  assessment: {
    labelKey: 'encounter.section.assessment.label',
    nameKey: 'encounter.section.assessment.name',
    hintKey: 'encounter.section.assessment.hint',
  },
  plan: {
    labelKey: 'encounter.section.plan.label',
    nameKey: 'encounter.section.plan.name',
    hintKey: 'encounter.section.plan.hint',
  },
};
