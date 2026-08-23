import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { oidcWebConfig } from '@/lib/auth/oidc';

import { SignInScreen } from './SignInScreen';

export const metadata: Metadata = {
  title: 'Sign in',
  /* Inherited from the root layout, and restated because this is the one page
     of the staff application somebody could plausibly link to. */
  robots: { index: false, follow: false },
};

/** A query parameter can arrive repeated. Take the first and ignore the rest. */
function firstValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Reads `?reason` and `?next` on the server and hands them down.
 *
 * Doing it here rather than from `window` in the screen is what keeps the
 * notice in the server-rendered HTML: read in the browser it would appear after
 * hydration, which is a mismatch on the page least able to afford one. It also
 * leaves the screen a pure function of its props, so its behaviour is testable
 * without a URL.
 */
export default async function SignInPage({
  searchParams,
}: Readonly<SignInPageProps>): Promise<ReactElement> {
  const params = await searchParams;
  return (
    <SignInScreen
      reason={firstValue(params.reason)}
      next={firstValue(params.next)}
      oidcEnabled={oidcWebConfig() !== null}
    />
  );
}
