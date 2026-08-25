'use client';

/**
 * The three states every read on this portal can be in, drawn the same way each time.
 *
 * The voice is fixed here so no screen has to remember it: the loading line and the error
 * both state the fact first and the next action second, address the reader as "you", and
 * never say "we". The error is a `role="alert"` region rather than a toast, because a
 * patient who has just been told their record did not load needs the retry to still be on
 * the page a minute later.
 *
 * ## Two whole sentences, not one noun phrase in a frame
 *
 * Each screen used to pass a phrase such as "your appointments", which this file
 * dropped into "Loading ..." and capitalised for the error title. Both of those
 * were English rules living in shared code: the frame fixed where the verb sits,
 * and upper-casing the first letter of a phrase is not how every language starts
 * a sentence. Each screen now names two finished messages instead.
 */

import type { ReactNode } from 'react';
import { Button, EmptyState } from '@openrunic/ui';
import { useTranslator } from '@/lib/i18n/messages';
import type { AsyncState } from '@/lib/useAsync';

export interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  /** The whole loading sentence, e.g. the one that says the appointments are loading. */
  loadingKey: string;
  /** The whole error title, e.g. the one that says the appointments did not load. */
  errorKey: string;
  /** Decides whether a successful read came back with nothing to show. */
  isEmpty?: (data: T) => boolean;
  /** Drawn when `isEmpty` says so. Usually an `EmptyState`. */
  empty?: ReactNode;
  /** Wired to the error state's try again. Omit it when a retry cannot help. */
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}

export function AsyncBoundary<T>({
  state,
  loadingKey,
  errorKey,
  isEmpty,
  empty,
  onRetry,
  children,
}: Readonly<AsyncBoundaryProps<T>>) {
  const t = useTranslator();

  if (state.status === 'loading') {
    return <output className="portal-async__loading">{t(loadingKey)}</output>;
  }

  if (state.status === 'error') {
    return (
      <div className="portal-async__error" role="alert">
        <EmptyState
          icon="wifi-off"
          title={t(errorKey)}
          message={t('portal.async.error.message')}
          action={
            onRetry ? (
              <Button variant="secondary" iconLeft="rotate-cw" onClick={onRetry}>
                {t('portal.async.retry')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (isEmpty?.(state.data)) {
    return <>{empty}</>;
  }

  return <>{children(state.data)}</>;
}
