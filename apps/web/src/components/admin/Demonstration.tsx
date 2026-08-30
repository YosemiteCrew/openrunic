'use client';

import type { ReactElement } from 'react';

import { Alert } from '@/components/state';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * A control the design has and the system does not.
 *
 * Several admin surfaces present a control that reports a completed action and
 * performs none: it shows a toast, closes a drawer, or updates a local overlay,
 * and never reaches the API. Three of them are security-shaped - key
 * revocation, account deactivation and role permissions - and those are the
 * ones this exists for first. Somebody responding to a leaked credential must
 * not be told it is closed by a screen that did nothing.
 *
 * The control is disabled and this sits beside it. A disabled control with a
 * note reads as unfinished, which is true; a control that says "Revoked" reads
 * as finished, which is not. There is deliberately no third state where the
 * button works and the message stays.
 *
 * `caution` rather than `info`, because the reader is looking at a screen that
 * has just failed to do something they may have believed was done.
 *
 * The message is passed as text rather than as a key, so the `t('...')` call
 * stays at the call site where `catalogue-drift.test.ts` can see it. A key given
 * to this component as a JSX attribute would be invisible to that scan.
 */
export function Demonstration({ message }: Readonly<{ message: string }>): ReactElement {
  const t = useTranslator();
  return <Alert tone="caution" title={t('admin.notBuilt.title')} message={message} />;
}
