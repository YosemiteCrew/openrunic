'use client';

import { Alert as UiAlert, Toast as UiToast } from '@openrunic/ui';
import type { AlertProps, ToastProps } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { useTranslator } from '@/lib/i18n/messages';

/**
 * THE TWO NOTICES, WITH A DISMISS CONTROL THAT SPEAKS THE READER'S LANGUAGE.
 *
 * `Alert` and `Toast` come from the design system, which has no translator and
 * should not grow one: the label on a close button is configuration, the same
 * as the message is. Both used to write `aria-label="Dismiss"` into the
 * component, so a Spanish screen had an English close button on every notice it
 * raised, and thirty call sites in this application had no way to say otherwise.
 *
 * They take a `closeLabel` prop now, and this is the one place that supplies it.
 * Screens import from `@/components/state` rather than from `@openrunic/ui`, so
 * a new notice cannot be added without the label coming with it.
 *
 * Everything else is passed straight through. These are not wrappers that add
 * behaviour; they add one word.
 */

export function Alert(props: Readonly<Omit<AlertProps, 'closeLabel'>>): ReactElement {
  const t = useTranslator();
  return <UiAlert {...props} closeLabel={t('common.dismiss')} />;
}

export function Toast(props: Readonly<Omit<ToastProps, 'closeLabel'>>): ReactElement {
  const t = useTranslator();
  return <UiToast {...props} closeLabel={t('common.dismiss')} />;
}
