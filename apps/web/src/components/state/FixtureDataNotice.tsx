'use client';

import type { ReactElement } from 'react';

import { Alert } from '@/components/state/Notices';
import { INBOX_IS_FIXTURE_BACKED, IS_MOCK_MODE } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * SAYS THE ROWS ARE NOT REAL, ON THE SCREEN WHERE NOTHING ELSE DOES.
 *
 * The shell states the rule in its own comment - "Demo data is never silent:
 * every screen says so, in the same place" - and puts a `Demo data` badge in
 * the top bar. That badge is gated on the api MODE. The inbox is fixture-backed
 * in EVERY mode, because the mapping from `GET /bff/v0/tasks` onto its view
 * type is not written (see `INBOX_IS_FIXTURE_BACKED`). Orders and results were
 * the other two until they started reading `GET /bff/v0/orders` and
 * `GET /bff/v0/results`, and render this no longer.
 *
 * The two conditions disagree exactly where it matters. Build with
 * `NEXT_PUBLIC_API_MODE=live` and the badge disappears - correctly, the shell
 * has no fixture facility to name - while that screen goes on listing a refill
 * request for Sandboxer, Prototypo. The one marker that said "not real" is
 * removed at the moment the rows start to look real, and the fixture names are
 * the only thing left carrying the warning.
 *
 * So this renders where the badge cannot: on the fixture-backed screen, when
 * the shell is not already saying it. In mock mode it renders nothing, because
 * the badge is there and two notices for one fact is how a reader learns to
 * skip both.
 *
 * It has no dismiss control on purpose. A notice about whether a clinical
 * worklist is real is not one the reader should be able to turn off, and
 * `Alert` renders the control only when it is given `onClose`.
 */
export function FixtureDataNotice(): ReactElement | null {
  const t = useTranslator();

  if (!INBOX_IS_FIXTURE_BACKED) return null;
  if (IS_MOCK_MODE) return null;

  return (
    <Alert
      tone="caution"
      icon="flask-conical"
      title={t('shell.fixtureNotice.title')}
      message={t('shell.fixtureNotice.message')}
    />
  );
}
