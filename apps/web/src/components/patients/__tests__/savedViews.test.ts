import { describe, expect, it } from 'vitest';

import { SAVED_VIEWS, viewById } from '@/components/patients/savedViews';

/**
 * The saved patient views, and what happens to an id that names none of them.
 *
 * `viewById` is reached from a URL, so its argument is whatever a stale
 * bookmark or a hand-edited address contains. Falling back to the full list is
 * what keeps that from being an error page; the fallback had no test, so
 * returning `undefined` there would have crashed the screen instead.
 */

describe('viewById', () => {
  it.each(SAVED_VIEWS.map((view) => view.id))('returns the %s view by its own id', (id) => {
    expect(viewById(id).id).toBe(id);
  });

  it('falls back to all patients for an id that names no view', () => {
    const first = SAVED_VIEWS[0];
    expect(first).toBeDefined();

    expect(viewById('not-a-view')).toBe(viewById(first?.id ?? ''));
    expect(viewById('')).toBe(viewById(first?.id ?? ''));
  });
});

describe('the view list itself', () => {
  it('gives every view an id no other view shares', () => {
    const ids = SAVED_VIEWS.map((view) => view.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every view the three catalogue keys the palette needs', () => {
    /*
     * A missing key renders as the key itself in the command palette, which is
     * the failure `catalogue-drift.test.ts` exists for. This asserts the shape
     * so a view added without one fails here rather than in a reader's palette.
     */
    for (const view of SAVED_VIEWS) {
      expect(view.labelKey).toMatch(/^patients\.view\./u);
      expect(view.descriptionKey).toMatch(/^patients\.view\./u);
      expect(view.commandKey).toMatch(/^patients\.view\./u);
    }
  });
});
