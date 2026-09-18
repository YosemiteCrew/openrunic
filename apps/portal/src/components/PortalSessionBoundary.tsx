'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { isLiveMode } from '@/lib/api/config';
import { endSession, restoreSession, returnToSignIn } from '@/lib/auth/client';
import { SIGN_IN_PATH } from '@/lib/auth/routes';
import type { PortalSessionState } from '@/lib/auth/session';
import { useTranslator } from '@/lib/i18n/messages';

const REFRESH_INTERVAL_MS = 60_000;

function currentTarget(pathname: string): string {
  return `${pathname}${window.location.search}`;
}

function scheduleExpiry(
  state: PortalSessionState,
  expire: (reason: 'idle' | 'expired') => void
): () => void {
  const deadline = Math.min(state.expiresAt, state.idleExpiresAt);
  const timer = setTimeout(
    () => expire(deadline === state.expiresAt ? 'expired' : 'idle'),
    Math.max(deadline - Date.now(), 0)
  );
  return () => clearTimeout(timer);
}

export function PortalSessionBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const t = useTranslator();
  const pathname = usePathname();
  const live = isLiveMode();
  const publicPage = pathname === SIGN_IN_PATH;
  const [session, setSession] = useState<PortalSessionState | null>(null);

  useEffect(() => {
    if (!live || publicPage || pathname === null) return;
    const controller = new AbortController();
    let active = true;
    let cancelExpiry = () => {};
    let refreshing = false;
    let nextRefreshAt = 0;

    const expire = (reason: 'idle' | 'expired') => {
      void endSession().finally(() => returnToSignIn(reason, currentTarget(pathname)));
    };

    const schedule = (state: PortalSessionState) => {
      setSession(state);
      cancelExpiry();
      cancelExpiry = scheduleExpiry(state, expire);
    };

    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const restored = await restoreSession(controller.signal);
      refreshing = false;
      if (!active) return;
      if (restored === null) {
        returnToSignIn('expired', currentTarget(pathname));
        return;
      }
      nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
      schedule(restored);
    };

    const onActivity = () => {
      if (Date.now() >= nextRefreshAt) void refresh();
    };

    void refresh();
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('focus', onActivity, { passive: true });
    return () => {
      active = false;
      controller.abort();
      cancelExpiry();
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('focus', onActivity);
    };
  }, [live, pathname, publicPage]);

  if (!live || publicPage) return <>{children}</>;
  if (session !== null) return <>{children}</>;
  return <output className="portal-session-check">{t('portal.auth.checking')}</output>;
}
