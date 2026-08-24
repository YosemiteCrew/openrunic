import type { PatientListQuery } from '@/lib/api';

/**
 * Saved views for the patient roster.
 *
 * A saved view is a named query, not a second screen. Legacy systems shipped a
 * different search form per purpose and none of them remembered anything;
 * here every view is the same table with a different question asked of it, and
 * each one is a palette command so it is reachable without the mouse.
 *
 * Every view maps onto filters the API actually supports, so a view can never
 * quietly become a client-side lie about how many patients matched.
 *
 * The name and the one-line answer are carried as catalogue keys rather than as
 * the words themselves, because this table is built at module scope and the
 * reader's language is not known there. `catalogue-drift.test.ts` reads
 * `somethingKey:` out of the source, so a view pointing at a key nobody defined
 * fails the build rather than rendering the key as a button.
 */

export interface SavedView {
  id: string;
  /** Sentence case. Also the palette command's label. */
  labelKey: string;
  /** One line: what this view answers. Shown under the roster heading. */
  descriptionKey: string;
  query: PatientListQuery;
}

export const DEFAULT_VIEW_ID = 'all';

/** The view every roster starts on, and falls back to when an id is unknown. */
const ALL_PATIENTS: SavedView = {
  id: DEFAULT_VIEW_ID,
  labelKey: 'patients.view.all.label',
  descriptionKey: 'patients.view.all.description',
  query: { sort: 'familyName', order: 'asc' },
};

export const SAVED_VIEWS: readonly SavedView[] = [
  ALL_PATIENTS,
  {
    id: 'active',
    labelKey: 'patients.view.active.label',
    descriptionKey: 'patients.view.active.description',
    query: { active: true, sort: 'familyName', order: 'asc' },
  },
  {
    id: 'inactive',
    labelKey: 'patients.view.inactive.label',
    descriptionKey: 'patients.view.inactive.description',
    query: { active: false, sort: 'familyName', order: 'asc' },
  },
  {
    id: 'recent',
    labelKey: 'patients.view.recent.label',
    descriptionKey: 'patients.view.recent.description',
    query: { sort: 'createdAt', order: 'desc' },
  },
];

export function viewById(id: string): SavedView {
  return SAVED_VIEWS.find((view) => view.id === id) ?? ALL_PATIENTS;
}
