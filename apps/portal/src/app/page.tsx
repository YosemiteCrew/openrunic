import type { Metadata } from 'next';
import { HomeScreen } from './HomeScreen';

/* Server component: metadata only. The screen below it is a client component because
   @openrunic/ui ships no 'use client' directive, so a server component that imported one
   of its components directly would fail the build. */

export const metadata: Metadata = {
  title: 'Home',
  description: 'Your next appointment, your balance, your messages and anything waiting on you.',
};

export default function HomePage() {
  return <HomeScreen />;
}
