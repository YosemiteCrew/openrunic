import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two constants this component reads are module-level and resolved at
 * import time in the real build - `IS_MOCK_MODE` from the inlined
 * `NEXT_PUBLIC_API_MODE`, `WORKLIST_IS_FIXTURE_BACKED` from a literal. Neither
 * can be set per case from outside, so the barrel is mocked with getters: an ES
 * import is a live binding, so the component re-reads them on every render and
 * one module instance serves every case below.
 *
 * Mocking the barrel rather than the two source modules keeps the double at the
 * same seam the component imports from, so a constant that moves file does not
 * silently leave this file asserting against the real value.
 */
const state = vi.hoisted(() => ({ isMockMode: false, isFixtureBacked: true }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    get IS_MOCK_MODE(): boolean {
      return state.isMockMode;
    },
    get WORKLIST_IS_FIXTURE_BACKED(): boolean {
      return state.isFixtureBacked;
    },
  };
});

const { FixtureDataNotice } = await import('@/components/state/FixtureDataNotice');

describe('FixtureDataNotice', () => {
  beforeEach(() => {
    state.isMockMode = false;
    state.isFixtureBacked = true;
  });

  it('says the rows are not real when the shell badge is absent', () => {
    render(<FixtureDataNotice />);

    expect(screen.getByText('These are not real patients')).toBeInTheDocument();
    expect(screen.getByText(/built-in sample rows, not your practice’s work/)).toBeInTheDocument();
  });

  /**
   * The point of the notice is that it cannot be turned off. `Alert` renders
   * its dismiss control only when given `onClose`, so the absence of a button
   * here is the assertion that it was not given one.
   */
  it('offers no way to dismiss it', () => {
    render(<FixtureDataNotice />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stays quiet in mock mode, where the shell badge already says it', () => {
    state.isMockMode = true;

    const { container } = render(<FixtureDataNotice />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('These are not real patients')).not.toBeInTheDocument();
  });

  /**
   * The day `apps/api` grows a worklist aggregate, the constant becomes a mode
   * test and this case is what stops the notice outliving the fixtures.
   */
  it('stays quiet once the worklist is no longer fixture-backed', () => {
    state.isFixtureBacked = false;

    const { container } = render(<FixtureDataNotice />);

    expect(container).toBeEmptyDOMElement();
  });
});
