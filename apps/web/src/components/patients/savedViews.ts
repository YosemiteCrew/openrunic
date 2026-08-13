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
 */

export interface SavedView {
  id: string;
  /** Sentence case. Also the palette command's label. */
  label: string;
  /** One line: what this view answers. Shown under the roster heading. */
  description: string;
  query: PatientListQuery;
}

export const DEFAULT_VIEW_ID = 'all';

/** The view every roster starts on, and falls back to when an id is unknown. */
const ALL_PATIENTS: SavedView = {
  id: DEFAULT_VIEW_ID,
  label: 'All patients',
  description: 'Everyone in the practice, by family name.',
  query: { sort: 'familyName', order: 'asc' },
};

export const SAVED_VIEWS: readonly SavedView[] = [
  ALL_PATIENTS,
  {
    id: 'active',
    label: 'Active patients',
    description: 'Patients the practice still sees.',
    query: { active: true, sort: 'familyName', order: 'asc' },
  },
  {
    id: 'inactive',
    label: 'Inactive records',
    description: 'Records closed, merged or marked deceased.',
    query: { active: false, sort: 'familyName', order: 'asc' },
  },
  {
    id: 'recent',
    label: 'Recently registered',
    description: 'Newest records first, for checking a walk-in went in correctly.',
    query: { sort: 'createdAt', order: 'desc' },
  },
];

export function viewById(id: string): SavedView {
  return SAVED_VIEWS.find((view) => view.id === id) ?? ALL_PATIENTS;
}
