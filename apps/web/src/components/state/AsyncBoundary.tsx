'use client';

import { EmptyState } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { AsyncState } from '@/lib/api';

import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import type { LoadingVariant } from './LoadingState';

/**
 * Loading, empty, error and data, in one component.
 *
 * Every data region on every screen goes through this. It is not a convenience:
 * it is how the four states stay identical across sixty screens built by
 * different hands, and how a screen becomes impossible to ship with a blank
 * table region where the empty state should be.
 *
 * The empty state is the library's `EmptyState` - what it is, why it is empty,
 * and exactly one action.
 */

export interface AsyncBoundaryEmpty {
  /**
   * The fact, in one line: "No unsigned notes". Already translated - the screen
   * knows which of its regions is empty and looks the wording up itself.
   */
  title: string;
  /** Why it is empty and what happens next. One sentence, already translated. */
  message?: string;
  /** Exactly one control. More than one is a screen that has not decided. */
  action?: ReactNode;
  /** Lucide slug; omit for the brand glyph. */
  icon?: string;
}

export interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  /**
   * Noun phrase, lower case: "today's schedule". Used by loading and error
   * copy, and already translated when it arrives - it lands inside a sentence
   * this component's children look up, and only the screen knows which of its
   * regions failed.
   */
  subject: string;
  empty: AsyncBoundaryEmpty;
  /** Decides emptiness for this payload; a list is empty when its page has no rows. */
  isEmpty?: (data: T) => boolean;
  loadingVariant?: LoadingVariant;
  loadingRows?: number;
  children: (data: T) => ReactNode;
}

function sentenceStart(subject: string): string {
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

export function AsyncBoundary<T>({
  state,
  subject,
  empty,
  isEmpty,
  loadingVariant = 'table',
  loadingRows = 6,
  children,
}: Readonly<AsyncBoundaryProps<T>>): ReactElement {
  if (state.status === 'loading') {
    return (
      <LoadingState label={sentenceStart(subject)} variant={loadingVariant} rows={loadingRows} />
    );
  }

  if (state.status === 'error' || state.data === null) {
    return <ErrorState subject={subject} error={state.error} onRetry={state.refetch} />;
  }

  if (isEmpty?.(state.data)) {
    return (
      <EmptyState
        title={empty.title}
        message={empty.message}
        action={empty.action}
        icon={empty.icon}
        glyphBasePath="/assets/logo"
      />
    );
  }

  return <>{children(state.data)}</>;
}
