import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hidePage, showPage } from '@/__tests__/support';
import { usePageHidden } from '@/components/assistant/usePageHidden';

/**
 * The plumbing, on its own.
 *
 * What the voice surface does when the page goes is asserted where that surface
 * is, against both of its adapters. This file is only about the four ways the
 * browser half can be got wrong: the wrong direction, the wrong callback, a
 * listener that outlives the component, and a listener re-registered often
 * enough to miss the event it exists for.
 */

afterEach(() => {
  showPage();
});

describe('the page going out of sight', () => {
  it('says so when the page is hidden', () => {
    const hidden = vi.fn();
    renderHook(() => usePageHidden(hidden));

    hidePage();

    expect(hidden).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the page comes back', () => {
    const hidden = vi.fn();
    renderHook(() => usePageHidden(hidden));

    hidePage();
    showPage();

    /* One event fires in both directions. A hook that did not read the state
       would stop the voice and then stop it again on the way back, which reads
       as working right up until somebody asks why the switch is off. */
    expect(hidden).toHaveBeenCalledTimes(1);
  });

  it('says nothing after the component has gone', () => {
    const hidden = vi.fn();
    const { unmount } = renderHook(() => usePageHidden(hidden));

    unmount();
    hidePage();

    expect(hidden).not.toHaveBeenCalled();
  });

  it('calls the callback it was last given', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onHidden }: { onHidden: () => void }) => usePageHidden(onHidden),
      {
        initialProps: { onHidden: first },
      }
    );

    rerender({ onHidden: second });
    hidePage();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('registers once however often the callback changes', () => {
    /* The callback both callers pass is rebuilt on every render, so a hook that
       depended on it would tear the listener down and put it back constantly.
       That is not merely wasteful: between the two there is no listener at all,
       and the event this exists to catch is one the reader can produce at any
       moment. */
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');

    const { rerender } = renderHook(
      ({ onHidden }: { onHidden: () => void }) => usePageHidden(onHidden),
      {
        initialProps: { onHidden: () => undefined },
      }
    );
    rerender({ onHidden: () => undefined });
    rerender({ onHidden: () => undefined });

    const registrations = add.mock.calls.filter(([type]) => type === 'visibilitychange');
    const removals = remove.mock.calls.filter(([type]) => type === 'visibilitychange');

    expect(registrations).toHaveLength(1);
    expect(removals).toHaveLength(0);

    add.mockRestore();
    remove.mockRestore();
  });
});
