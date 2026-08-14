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
  readonly title: string;
  readonly body: string;
}

/**
 * The two ways a clinician arrives here already holding a session that no
 * longer works. Both are stated, because a sign-in form that appears without
 * explanation reads as a fault and gets reported as one.
 */
const REASON_NOTICE: Record<SignInReason, ReasonNotice> = {
  idle: {
    tone: 'caution',
    title: `You were signed out after ${IDLE_MINUTES} minutes without activity.`,
    body: 'Sign in again to pick up where you left off.',
  },
  expired: {
    tone: 'info',
    title: 'Your session has ended.',
    body: 'Sign in again to continue.',
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
}

function documentNavigate(url: string): void {
  window.location.assign(url);
}

export function SignInScreen({
  reason,
  next,
  navigate = documentNavigate,
  credentials = developmentCredentials(process.env.NODE_ENV),
}: Readonly<SignInScreenProps>): ReactElement {
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
          <h1 className="or-auth__title">Sign in</h1>
          <p className="or-auth__lede">
            openrunic staff access. A session ends after {IDLE_MINUTES} minutes without activity, so
            a workstation left unattended does not stay open on a chart.
          </p>
        </div>

        {notice === null ? null : (
          <Alert tone={notice.tone} title={notice.title} message={notice.body} />
        )}

        {attempt === 'unavailable' ? (
          <Alert
            tone="danger"
            title="The sign-in service could not be reached."
            message="Check that the application is still running, then try again."
          />
        ) : null}

        <form className="or-auth__form" onSubmit={onSubmit} noValidate>
          <Input
            id="sign-in-token"
            label="Access token"
            type="password"
            autoComplete="off"
            value={token}
            hint="The bearer token your deployment issued you."
            error={attempt === 'rejected' ? 'That access token was not recognised.' : undefined}
            onChange={(event) => {
              setToken(event.target.value);
              setAttempt('ready');
            }}
          />
          <Button type="submit" variant="primary" fullWidth disabled={busy || token === ''}>
            {busy ? 'Signing in' : 'Sign in'}
          </Button>
        </form>

        {credentials.length > 0 ? (
          <fieldset className="or-auth__demo">
            <legend className="or-auth__demo-legend">Development sign-in</legend>
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
