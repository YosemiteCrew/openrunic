import type { ReactNode } from 'react';

/**
 * The sign-in group.
 *
 * It has no frame of its own, and that is the point: the shell belongs to
 * people who are already signed in, and the marketing masthead belongs to
 * people who are reading about the project. Someone at the sign-in screen is
 * neither, and a page with nothing on it but the thing being asked for is the
 * clearest version of that.
 *
 * The root layout's `robots: { index: false, follow: false }` is inherited
 * unchanged. The `(marketing)` group opts back into indexing for its four
 * pages; a sign-in form is not one of them.
 *
 * The stylesheet is imported by the root layout rather than here, because the
 * `SessionGate` notice it also dresses appears on protected routes that never
 * pass through this group.
 */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
