'use client';

import type { ReactElement } from 'react';

import { Alert } from '@/components/state/Notices';
import { IS_MOCK_MODE, WORKLIST_IS_FIXTURE_BACKED } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * SAYS THE ROWS ARE NOT REAL, ON THE SCREENS WHERE NOTHING ELSE DOES.
 *
 * The shell states the rule in its own comment - "Demo data is never silent:
 * every screen says so, in the same place" - and puts a `Demo data` badge in
 * the top bar. That badge is gated on the api MODE. The inbox, orders and
 * results screens are fixture-backed in EVERY mode, because `apps/api` has no
 * worklist aggregate for them to read (see `WORKLIST_IS_FIXTURE_BACKED`).
 *
 * The two conditions disagree exactly where it matters. Build with
 * `NEXT_PUBLIC_API_MODE=live` and the badge disappears - correctly, the shell
 * has no fixture facility to name - while those three screens go on listing a
 * refill request for Sandboxer, Prototypo and a critical potassium for
 * Testperson, Exampla. The one marker that said "not real" is removed at the
 * moment the rows start to look real, and the fixture names are the only thing
 * left carrying the warning.
 *
 * So this renders where the badge cannot: on the fixture-backed screens, when
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

  if (!WORKLIST_IS_FIXTURE_BACKED) return null;
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
