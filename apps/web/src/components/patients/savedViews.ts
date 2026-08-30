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
 * The words a view is made of are catalogue keys rather than sentences, and the
 * screen translates them at render. Keeping the copy as data is what lets the
 * four views be reviewed together in one table instead of scattered through
 * JSX, and keeping it as keys is what lets a clinic that does not work in
 * English read them.
 */

export interface SavedView {
  /**
   * Stable identity, independent of what the view is called.
   *
   * The palette command's id is built from this rather than from the label: a
   * command id derived from a label changes when the reader's language does,
   * and anything keyed on it stops matching.
   */
  id: string;
  /** Catalogue key for the button and the table caption. Sentence case. */
  labelKey: string;
  /** Catalogue key for one line saying what this view answers. */
  descriptionKey: string;
  /**
   * Catalogue key for the palette command.
   *
   * Written out in full ("Show inactive records") rather than assembled from a
   * verb and a lowercased label: a noun does not lowercase mid-sentence in
   * every language, and the assembled version was doing exactly that.
   */
  commandKey: string;
  query: PatientListQuery;
}

export const DEFAULT_VIEW_ID = 'all';

/** The view every roster starts on, and falls back to when an id is unknown. */
const ALL_PATIENTS: SavedView = {
  id: DEFAULT_VIEW_ID,
  labelKey: 'patients.view.all.label',
  descriptionKey: 'patients.view.all.description',
  commandKey: 'patients.view.all.command',
  query: { sort: 'familyName', order: 'asc' },
};

export const SAVED_VIEWS: readonly SavedView[] = [
  ALL_PATIENTS,
  {
    id: 'active',
    labelKey: 'patients.view.active.label',
    descriptionKey: 'patients.view.active.description',
    commandKey: 'patients.view.active.command',
    query: { active: true, sort: 'familyName', order: 'asc' },
  },
  {
    id: 'inactive',
    labelKey: 'patients.view.inactive.label',
    descriptionKey: 'patients.view.inactive.description',
    commandKey: 'patients.view.inactive.command',
    query: { active: false, sort: 'familyName', order: 'asc' },
  },
  {
    id: 'recent',
    labelKey: 'patients.view.recent.label',
    descriptionKey: 'patients.view.recent.description',
    commandKey: 'patients.view.recent.command',
    query: { sort: 'createdAt', order: 'desc' },
  },
];

export function viewById(id: string): SavedView {
  return SAVED_VIEWS.find((view) => view.id === id) ?? ALL_PATIENTS;
}
