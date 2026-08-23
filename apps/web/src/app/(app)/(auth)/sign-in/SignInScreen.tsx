'use client';

import { Alert, Button, Input } from '@openrunic/ui';
import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { signIn } from '@/lib/auth/client';
import { developmentCredentials } from '@/lib/auth/directory';
import type { StaffCredential } from '@/lib/auth/directory';
import { landingPath } from '@/lib/auth/routes';
import type { SignInReason } from '@/lib/auth/routes';
import { IDLE_TIMEOUT_MS } from '@/lib/auth/session';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * The one screen that exists before the application does.
 *
 * It asks for an access token, because that is what a credential is in this
 * system today: the API resolves a bearer token to a principal, and its
 * development resolver reads that token out of a table of public fixtures. A
 * username and password form would be the more familiar shape and a lie, since
 * nothing here checks a password.
 *
 * The shape survives the change that makes it true. When the identity provider
 * lands this screen loses the field and gains a button that starts a redirect;
 * what it does with the answer - hand it to `signIn`, then go where the
 * clinician was trying to get to - is already written and does not move.
 *
 * `reason` and `next` arrive as props from the server component that read them
 * off the URL, rather than being read from `window` here. That keeps the screen
 * a pure function of its inputs, and it avoids the hydration mismatch that
 * comes from a notice which exists in the browser and not in the HTML.
 *
 * The development credentials are buttons rather than text to copy, because a
 * token that has to be typed is a token that gets mistyped, and the point of
 * the list is to get past this screen rather than to practise entering one.
 */

const MILLISECONDS_PER_MINUTE = 60_000;

const IDLE_MINUTES = Math.round(IDLE_TIMEOUT_MS / MILLISECONDS_PER_MINUTE);

/** What the screen is doing, and what went wrong if it stopped. */
type Attempt = 'ready' | 'signing-in' | 'rejected' | 'unavailable';

interface ReasonNotice {
  readonly tone: 'caution' | 'info';
  readonly titleKey: string;
  readonly bodyKey: string;
  /**
   * Values the title needs, and only the ones it needs.
   *
   * The formatter refuses a value a message does not use, which is right: an
   * extra one almost always means the caller believes the message says
   * something it does not. So the idle notice carries the minute count and the
   * expired notice carries nothing.
   */
  readonly titleValues?: Readonly<Record<string, string | number>>;
}

/**
 * The two ways a clinician arrives here already holding a session that no
 * longer works. Both are stated, because a sign-in form that appears without
 * explanation reads as a fault and gets reported as one.
 */
const REASON_NOTICE: Record<SignInReason, ReasonNotice> = {
  idle: {
    tone: 'caution',
    titleKey: 'auth.signedOut.idle.title',
    bodyKey: 'auth.signedOut.idle.body',
    titleValues: { minutes: IDLE_MINUTES },
  },
  expired: {
    tone: 'info',
    titleKey: 'auth.signedOut.expired.title',
    bodyKey: 'auth.signedOut.expired.body',
  },
};

function noticeFor(reason: string | null | undefined): ReasonNotice | null {
  return reason === 'idle' || reason === 'expired' ? REASON_NOTICE[reason] : null;
}

export interface SignInScreenProps {
  /** Why the clinician is here, from the URL. Anything unrecognised is ignored. */
  reason?: string | null;
  /** Where to go afterwards, from the URL. Validated by `landingPath`. */
  next?: string | null;
  /**
   * Injectable for tests. A document navigation rather than a router push, so
   * the tab starts the signed-in application from scratch instead of layering
   * it over what the signed-out one had already rendered.
   */
  navigate?: (url: string) => void;
  /** Injectable for tests. Empty in a production build, which offers no door. */
  credentials?: readonly StaffCredential[];
  /**
   * Whether this deployment has an identity provider configured. Decided on the
   * server, because the client bundle has no business holding issuer settings
   * and `process.env` here would be inlined at build time rather than read at
   * run time, which is how one image cannot serve two deployments.
   */
  oidcEnabled?: boolean;
}

function documentNavigate(url: string): void {
  window.location.assign(url);
}

export function SignInScreen({
  reason,
  next,
  navigate = documentNavigate,
  credentials = developmentCredentials(process.env.NODE_ENV),
  oidcEnabled = false,
}: Readonly<SignInScreenProps>): ReactElement {
  const t = useTranslator();
  const [token, setToken] = useState('');
  const [attempt, setAttempt] = useState<Attempt>('ready');

  const notice = noticeFor(reason);
  const busy = attempt === 'signing-in';

  async function attemptSignIn(candidate: string): Promise<void> {
    setAttempt('signing-in');
    const outcome = await signIn(candidate);
    if (outcome.ok) {
      navigate(landingPath(next));
      return;
    }
    setAttempt(outcome.reason);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void attemptSignIn(token);
  }

  return (
    <div className="or-auth">
      <div className="or-auth__panel">
        <div className="or-auth__intro">
          <h1 className="or-auth__title">{t('auth.signIn.title')}</h1>
          <p className="or-auth__lede">{t('auth.signIn.lede', { minutes: IDLE_MINUTES })}</p>
        </div>

        {notice === null ? null : (
          <Alert
            tone={notice.tone}
            title={t(notice.titleKey, notice.titleValues)}
            message={t(notice.bodyKey)}
          />
        )}

        {attempt === 'unavailable' ? (
          <Alert
            tone="danger"
            title={t('auth.signIn.unavailable.title')}
            message={t('auth.signIn.unavailable.body')}
          />
        ) : null}

        <form className="or-auth__form" onSubmit={onSubmit} noValidate>
          <Input
            id="sign-in-token"
            label={t('auth.signIn.tokenLabel')}
            type="password"
            autoComplete="off"
            value={token}
            hint={t('auth.signIn.tokenHint')}
            error={attempt === 'rejected' ? t('auth.signIn.tokenRejected') : undefined}
            onChange={(event) => {
              setToken(event.target.value);
              setAttempt('ready');
            }}
          />
          <Button type="submit" variant="primary" fullWidth disabled={busy || token === ''}>
            {busy ? t('auth.signIn.submitting') : t('auth.signIn.submit')}
          </Button>
        </form>

        {oidcEnabled ? (
          <div className="or-auth__sso">
            <a
              className="or-auth__sso-link"
              href={next ? `/auth/start?next=${encodeURIComponent(next)}` : '/auth/start'}
            >
              {t('auth.signIn.provider')}
            </a>
            <p className="or-auth__lede">
              You will be sent to your identity provider and returned here once it has confirmed who
              you are.
            </p>
          </div>
        ) : null}

        {credentials.length > 0 ? (
          <fieldset className="or-auth__demo">
            <legend className="or-auth__demo-legend">{t('auth.signIn.developmentHeading')}</legend>
            <p className="or-auth__lede">
              These are the API&apos;s public development principals. They exist in this build only,
              and the API refuses to accept any of them in production.
            </p>
            <div className="or-auth__demo-list">
              {credentials.map((credential) => (
                <Button
                  key={credential.token}
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void attemptSignIn(credential.token)}
                >
                  {credential.identity.displayName} ({credential.identity.roles.join(', ')})
                </Button>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
    </div>
  );
}
