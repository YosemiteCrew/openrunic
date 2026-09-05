'use client';

import { Alert as UiAlert, Toast as UiToast } from '@openrunic/ui';
import type { AlertProps, AlertTone, ToastProps, ToastTone } from '@openrunic/ui';
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
 * `toneLabel` came later and by the same route, and it is the more important of
 * the two. The word before the body - "Information", "Caution" - is what keeps
 * the tone off colour alone, and `.or-alert__tone` is clipped to 1x1, so it is
 * the only text on a notice that a sighted reader never sees and a screen
 * reader always does. It was announcing English inside a `lang="es"` page. See
 * #312.
 *
 * Everything else is passed straight through. These are not wrappers that add
 * behaviour; they add three words.
 */

/**
 * The catalogue key per tone.
 *
 * `Alert` has four tones and `Toast` three, and `ToastTone` is a subset of
 * `AlertTone`, so one table serves both and the compiler says so: a tone added
 * to either union without a key here fails to build.
 */
const TONE_KEY: Record<AlertTone, string> = {
  info: 'common.tone.info',
  caution: 'common.tone.caution',
  danger: 'common.tone.danger',
  success: 'common.tone.success',
};

export function Alert(props: Readonly<Omit<AlertProps, 'closeLabel' | 'toneLabel'>>): ReactElement {
  const t = useTranslator();
  return (
    <UiAlert
      {...props}
      closeLabel={t('common.dismiss')}
      toneLabel={t(TONE_KEY[props.tone ?? 'info'])}
    />
  );
}

export function Toast(props: Readonly<Omit<ToastProps, 'closeLabel' | 'toneLabel'>>): ReactElement {
  const t = useTranslator();
  const tone: ToastTone = props.tone ?? 'info';
  return <UiToast {...props} closeLabel={t('common.dismiss')} toneLabel={t(TONE_KEY[tone])} />;
}
