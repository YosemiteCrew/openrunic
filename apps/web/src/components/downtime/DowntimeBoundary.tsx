'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { useTranslator } from '@/lib/i18n/messages';

import styles from './downtime.module.css';

/**
 * The last line of defence between a thrown error and the person using this.
 *
 * Without a boundary, an exception during render unmounts the React tree and
 * leaves a white page. With Next's default error page, it shows a stack trace.
 * Both are unacceptable in a clinical setting: the first tells staff nothing,
 * and the second can put a connection string or a patient identifier on a
 * screen in a waiting room.
 *
 * So this catches everything, shows one calm explanation, and keeps the detail
 * for the console where support can ask for it.
 */

export interface DowntimeBoundaryProps {
  readonly children: ReactNode;
  /**
   * Catalogue key for the screen's own name, so staff can tell support which
   * screen it was. Defaults to "this screen".
   *
   * A key rather than the words, because the sentence it lands in is
   * translated, and a Spanish sentence with an English screen name in the
   * middle of it is the half-translated result the catalogue design exists to
   * avoid.
   */
  readonly areaKey?: string;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

/**
 * The boundary itself has to be a class: `getDerivedStateFromError` and
 * `componentDidCatch` have no hook equivalents. So the translator arrives as a
 * prop, put there by the wrapper below, rather than being read from a hook this
 * component cannot call.
 */
interface DowntimeBoundaryViewProps extends DowntimeBoundaryProps {
  readonly translate: (key: string, values?: Record<string, string | number>) => string;
}

interface DowntimeBoundaryState {
  readonly failed: boolean;
  /** A short opaque id, printed for support. Never the error text. */
  readonly reference: string | null;
}

/**
 * A short code staff can read down a phone line.
 *
 * From `crypto`, not `Math.random`. Not because a support reference is a
 * secret, but because these codes are the only thing tying a report to an
 * entry in a log, and `Math.random` is seeded per context: several tabs that
 * crash on the same deployment can produce the same six characters, and two
 * different incidents wearing one reference is the failure mode that matters
 * here. `crypto.getRandomValues` has no such collision structure and costs
 * nothing on a path that runs once, while a screen is already broken.
 *
 * Base36 over 32 bits, left-padded, so the code is always six characters -
 * a reference that is sometimes shorter reads like a truncation to whoever is
 * writing it down.
 */
function reference(): string {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)
    .toString(36)
    .padStart(6, '0')
    .slice(0, 6)
    .toUpperCase();
}

class DowntimeBoundaryView extends Component<DowntimeBoundaryViewProps, DowntimeBoundaryState> {
  public override state: DowntimeBoundaryState = { failed: false, reference: null };

  public static getDerivedStateFromError(): DowntimeBoundaryState {
    return { failed: true, reference: reference() };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the right place for the detail: support can ask for it,
    // and it is not rendered where a patient could read it.
    console.error('openrunic: a screen failed to render', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    const t = this.props.translate;
    const area = t(this.props.areaKey ?? 'downtime.failed.thisScreen');

    return (
      <section role="alert" data-testid="downtime-fallback" className={styles.fallback}>
        <h1 className={styles.fallback__title}>{t('downtime.failed.title', { area })}</h1>
        <p className={styles.fallback__body}>{t('downtime.failed.reassurance')}</p>
        <p className={styles.fallback__body}>{t('downtime.failed.next')}</p>
        <p className={styles.reference}>
          {t('downtime.failed.reference', { reference: this.state.reference ?? '' })}
        </p>
      </section>
    );
  }
}

/**
 * The boundary as everything else uses it.
 *
 * A function component so it can read the translator from context, wrapping the
 * class that does the actual catching. Splitting them is what lets an error
 * boundary render translated text at all.
 */
export function DowntimeBoundary(props: Readonly<DowntimeBoundaryProps>) {
  const translate = useTranslator();
  return <DowntimeBoundaryView {...props} translate={translate} />;
}
