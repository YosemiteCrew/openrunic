'use client';

/**
 * The three states every read on this portal can be in, drawn the same way each time.
 *
 * The voice is fixed here so no screen has to remember it: the loading line and the error
 * both state the fact first and the next action second, address the reader as "you", and
 * never say "we". The error is a `role="alert"` region rather than a toast, because a
 * patient who has just been told their record did not load needs the retry to still be on
 * the page a minute later.
 */

import type { ReactNode } from 'react';
import { Button, EmptyState } from '@openrunic/ui';
import type { AsyncState } from '@/lib/useAsync';

export interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  /**
   * What is being read, as a lower-case noun phrase starting with "your": the component
   * builds "Loading your appointments." and "Your appointments did not load." from it.
   */
  what: string;
  /** Decides whether a successful read came back with nothing to show. */
  isEmpty?: (data: T) => boolean;
  /** Drawn when `isEmpty` says so. Usually an `EmptyState`. */
  empty?: ReactNode;
  /** Wired to the error state's try again. Omit it when a retry cannot help. */
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}

/** 'your appointments' -> 'Your appointments'. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function AsyncBoundary<T>({
  state,
  what,
  isEmpty,
  empty,
  onRetry,
  children,
}: AsyncBoundaryProps<T>) {
  if (state.status === 'loading') {
    return (
      <p className="portal-async__loading" role="status">
        Loading {what}.
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="portal-async__error" role="alert">
        <EmptyState
          icon="wifi-off"
          title={`${sentenceCase(what)} did not load.`}
          message="Check your connection, then try again. If it keeps failing, message your care team."
          action={
            onRetry ? (
              <Button variant="secondary" iconLeft="rotate-cw" onClick={onRetry}>
                Try again
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
