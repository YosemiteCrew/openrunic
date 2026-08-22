'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { endSession, restoreSession } from './client';
import { watchForIdleness } from './idle';
import { isPublicPath, signInUrl } from './routes';
import { useSession } from './useSession';

import { useTranslator } from '@/lib/i18n/messages';

/**
 * Stands between a clinical route and its screen until there is a session
 * behind it, and takes the session away again when the workstation goes quiet.
 *
 * The quiet half is `lib/auth/idle.ts`: it watches for a person at the
 * keyboard, keeps the server's idle clock stamped while there is one, and calls
 * back here when there has not been one for the whole window. This component
 * only decides what that should look like on screen.
 *
 * ## Why a gate as well as `proxy.ts`
 *
 * The proxy decides whether a page is served; it cannot put a token into
 * the browser's memory, because the token arrives in an httpOnly cookie that
 * only the server can read. So a freshly loaded chart has a page but no
 * credential for one frame, and every hook on it fires immediately. Without
 * this gate the first render of a chart is a burst of unauthenticated requests,
 * a row of error panels, and no second attempt: the data layer does not retry a
 * 401 it has already reported. The clinician sees a broken chart and reloads.
 *
 * So the gate holds the screen back for exactly as long as it takes `/session`
 * to answer, and renders the chart only once the token is in hand. The cost is
 * that clinical routes do not server-render their content. That costs little
 * here, because every screen is a client component that fetches on mount, so
 * the server-rendered HTML was a shell either way; and the public marketing
 * pages are unaffected, because the gate does nothing at all on a public path.
 *
 * ## What it is not
 *
 * It is not the security boundary, and it must not be read as one. Anything the
 * browser is told, the browser can be made to forget. The rules are enforced by
 * `proxy.ts` on the way in and by the API on every request; this component
 * exists so that a signed-out person sees a sign-in form instead of a chart
 * frame full of errors. That is why an unknown pathname renders its children
 * rather than blocking: guessing wrong here costs a confusing screen, and the
 * things that would actually leak a record are elsewhere and not guessing.
 */

export interface SessionGateProps {
  children: ReactNode;
  /**
   * Injectable for tests. Defaults to a full document navigation rather than a
   * router push, and that is deliberate: leaving a signed-out clinician's chart
   * mounted behind a client transition keeps the rendered record, and every
   * response the screens fetched, alive in the tab. A document navigation
   * discards the React tree, its state and the in-memory token together, which
   * is the only version of "signed out" worth the name on a shared workstation.
   */
  navigate?: (url: string) => void;
}

function documentNavigate(url: string): void {
  window.location.assign(url);
}

/** Where to come back to, including the query the clinician was looking at. */
function currentTarget(pathname: string): string {
  return `${pathname}${window.location.search}`;
}

export function SessionGate({
  children,
  navigate = documentNavigate,
}: Readonly<SessionGateProps>): ReactElement {
  const t = useTranslator();
  const pathname = usePathname();
  const session = useSession();
  const [restoreFailed, setRestoreFailed] = useState(false);

  const guarded = pathname !== null && !isPublicPath(pathname);
  const blocked = guarded && session === null;

  // One effect, not two. Setting state and then redirecting from a second
  // effect keyed on that state costs a render nobody sees: the answer is
  // already known the moment the restore resolves to nothing. `restoreFailed`
  // still exists to stop a second attempt, because the injected `navigate` in
  // tests leaves the component mounted where a document navigation would not.
  useEffect(() => {
    if (!blocked || restoreFailed) return;

    let cancelled = false;
    void restoreSession().then((restored) => {
      if (cancelled || restored !== null) return;
      setRestoreFailed(true);
      if (pathname !== null) navigate(signInUrl(currentTarget(pathname), 'expired'));
    });

    return () => {
      cancelled = true;
    };
  }, [blocked, restoreFailed, navigate, pathname]);

  /**
   * What to do when the workstation goes quiet, held in a ref so that changing
   * it does not restart the watch.
   *
   * It depends on where the clinician is, and where they are changes on every
   * client navigation. If those changes were effect dependencies the watch
   * would be torn down and rebuilt on each one, restarting the tab's countdown
   * from zero without telling the server anything - and the tab would then be
   * holding a screen open that the proxy had already decided was over. The
   * countdown has to survive navigation for the same reason the session does.
   */
  const onIdle = useRef<() => void>(undefined);

  useEffect(() => {
    onIdle.current = () => {
      void endSession().finally(() => {
        // Only a guarded route is worth interrupting. Ending the session while
        // someone reads the public pages is right; throwing them off the page
        // they were reading to say so is not.
        if (guarded && pathname !== null) navigate(signInUrl(currentTarget(pathname), 'idle'));
      });
    };
  });

  useEffect(() => {
    if (session === null) return undefined;

    return watchForIdleness({ onIdle: () => onIdle.current?.() });
  }, [session]);

  if (!blocked) return <>{children}</>;

  return (
    <div className="or-auth">
      {/* An <output> rather than a paragraph with role="status": it is the
          element the platform already defines as a live result, so assistive
          technology announces the wait without the role being asserted by
          hand. */}
      <output className="or-auth__status">{t('auth.holding')}</output>
    </div>
  );
}
