import { describe, expect, it, vi } from 'vitest';

const metadata = vi.hoisted(() => ({ pageMetadata: vi.fn() }));

vi.mock('@/lib/i18n/metadata', () => metadata);

import SignInPage, { generateMetadata } from '@/app/sign-in/page';

describe('the sign-in route', () => {
  it('keeps the page out of search indexes', async () => {
    metadata.pageMetadata.mockResolvedValue({ title: 'Sign in' });

    await expect(generateMetadata()).resolves.toEqual({
      title: 'Sign in',
      robots: { index: false, follow: false },
    });
  });

  it('takes only the first value for each sign-in parameter', async () => {
    const page = await SignInPage({
      searchParams: Promise.resolve({
        next: ['/messages', '/bills'],
        reason: ['idle', 'expired'],
      }),
    });

    expect(page.props).toMatchObject({ next: '/messages', reason: 'idle' });
  });

  it('passes missing parameters as null', async () => {
    const page = await SignInPage({ searchParams: Promise.resolve({}) });

    expect(page.props).toMatchObject({ next: null, reason: null });
  });
});
