import { describe, expect, it, vi } from 'vitest';

/**
 * Whether a build asks to be indexed.
 *
 * A demonstration build is a second copy of these four pages on a second host.
 * Indexed, it competes with the real site for the same words and teaches a
 * crawler that the canonical answer is a sandbox full of invented patients.
 *
 * The root layout is already fail-closed and this is the one place that opts
 * back in, so it is the one place that has to ask - and until now nothing
 * checked which way it answered. The demo side had never been rendered.
 */

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

/** Re-imports the layout with the demo flag forced either way. */
async function robotsWhenDemoBuildIs(demo: boolean): Promise<unknown> {
  vi.resetModules();
  vi.doMock('@/lib/auth/build', async () => {
    const actual = await vi.importActual<typeof import('@/lib/auth/build')>('@/lib/auth/build');
    return { ...actual, IS_DEMO_BUILD: demo };
  });

  const layout = await import('../layout');
  const metadata = await layout.generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
  vi.doUnmock('@/lib/auth/build');
  return metadata.robots;
}

describe('the public pages', () => {
  it('ask to be indexed in an ordinary build', async () => {
    expect(await robotsWhenDemoBuildIs(false)).toEqual({ index: true, follow: true });
  });

  it('refuse indexing in a demonstration build', async () => {
    /*
     * Both flags, not just `index`. A page that refuses indexing but permits
     * following still hands a crawler every link on the demonstration site.
     */
    expect(await robotsWhenDemoBuildIs(true)).toEqual({ index: false, follow: false });
  });
});
