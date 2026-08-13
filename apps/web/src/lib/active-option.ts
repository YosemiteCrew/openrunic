'use client';

import { useEffect } from 'react';

/**
 * Keeps the option named by `aria-activedescendant` inside the scrolled view.
 *
 * In the ARIA combobox pattern DOM focus never leaves the text field; only
 * `aria-activedescendant` moves. A screen reader follows that attribute, but a
 * scroll container does not, so a sighted keyboard-only user arrowing down a
 * long list watches the highlight disappear below the fold. Both listboxes in
 * this app scroll, so both need this.
 *
 * `block: 'nearest'` is deliberate: it does nothing when the option is already
 * fully visible, so hovering a row with the pointer never yanks the list out
 * from under the cursor.
 */
export function useActiveOptionInView(activeOptionId: string | undefined): void {
  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);
}
