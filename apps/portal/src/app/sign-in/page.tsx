import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { SignInScreen } from './SignInScreen';

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...(await pageMetadata({ titleKey: 'portal.auth.page.title' })),
    robots: { index: false, follow: false },
  };
}

function first(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function SignInPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  return <SignInScreen next={first(params.next)} reason={first(params.reason)} />;
}
