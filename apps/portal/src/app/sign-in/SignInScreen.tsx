'use client';

import { Button, Input } from '@openrunic/ui';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { landingPath, signIn } from '@/lib/auth/client';
import { useTranslator } from '@/lib/i18n/messages';

export interface SignInScreenProps {
  next?: string | null;
  reason?: string | null;
  navigate?: (path: string) => void;
  developmentToken?: string | null;
}

function navigateDocument(path: string): void {
  window.location.assign(path);
}

export function SignInScreen({
  next,
  reason,
  navigate = navigateDocument,
  developmentToken = process.env.NODE_ENV === 'production' ? null : 'dev-portal-a',
}: Readonly<SignInScreenProps>) {
  const t = useTranslator();
  const [token, setToken] = useState('');
  const [state, setState] = useState<'ready' | 'pending' | 'rejected' | 'unavailable'>('ready');

  async function submit(candidate: string): Promise<void> {
    setState('pending');
    const outcome = await signIn(candidate);
    if (outcome.ok) {
      navigate(landingPath(next));
      return;
    }
    setState(outcome.reason);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit(token);
  }

  const notice = reason === 'idle' ? t('portal.auth.idle') : t('portal.auth.expired');

  return (
    <main className="portal-sign-in">
      <section className="portal-sign-in__panel" aria-labelledby="portal-sign-in-title">
        <p className="or-overline">{t('portal.auth.overline')}</p>
        <h1 className="or-h1" id="portal-sign-in-title">
          {t('portal.auth.title')}
        </h1>
        <p className="or-body">{t('portal.auth.lede')}</p>

        {reason === 'idle' || reason === 'expired' ? (
          <p className="portal-sign-in__notice">
            <output>{notice}</output>
          </p>
        ) : null}

        <form className="portal-sign-in__form" onSubmit={onSubmit} noValidate>
          <Input
            id="portal-access-token"
            label={t('portal.auth.tokenLabel')}
            type="password"
            autoComplete="off"
            value={token}
            hint={t('portal.auth.tokenHint')}
            error={state === 'rejected' ? t('portal.auth.rejected') : undefined}
            onChange={(event) => {
              setToken(event.target.value);
              setState('ready');
            }}
          />
          <Button type="submit" fullWidth disabled={state === 'pending' || token === ''}>
            {state === 'pending' ? t('portal.auth.signingIn') : t('portal.auth.submit')}
          </Button>
        </form>

        {state === 'unavailable' ? (
          <p className="portal-sign-in__error" role="alert">
            {t('portal.auth.unavailable')}
          </p>
        ) : null}

        {developmentToken === null ? null : (
          <div className="portal-sign-in__development">
            <p className="or-small">{t('portal.auth.developmentLede')}</p>
            <Button
              variant="secondary"
              fullWidth
              disabled={state === 'pending'}
              onClick={() => void submit(developmentToken)}
            >
              {t('portal.auth.developmentAction')}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
