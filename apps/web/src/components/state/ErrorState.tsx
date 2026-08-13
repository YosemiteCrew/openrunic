'use client';

import { Button, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { ApiError } from '@/lib/api';

/**
 * The one error surface: what happened, then what to do.
 *
 * Never "Something went wrong", and never an error without a next step. It also
 * separates our failure from a partner outage, because a front desk that reads
 * "the eligibility service didn't respond" behaves differently from one that
 * reads "we lost your check-in".
 */

export interface ErrorStateProps {
  /** What was being read: "today's schedule", "this patient". Lower case, no full stop. */
  subject: string;
  error?: ApiError | Error | null;
  /** Overrides the derived sentence when a screen knows better. */
  message?: string;
  /** Wire this to the hook's `refetch`. Omitted when nothing is retryable. */
  onRetry?: () => void;
}

interface Explanation {
  title: string;
  message: string;
  retryable: boolean;
}

/**
 * The status-to-sentence table. Each line says what happened and what to do,
 * in the clinician register: precise, short, no filler, never blaming.
 */
export function explain(subject: string, error: ErrorStateProps['error']): Explanation {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return {
        title: 'No connection to the server',
        message: `openrunic could not reach the server, so ${subject} did not load. Check the connection and try again.`,
        retryable: true,
      };
    }
    if (error.status === 401) {
      return {
        title: 'Your session has ended',
        message: 'Sign in again to continue. Nothing you entered has been lost.',
        retryable: false,
      };
    }
    if (error.status === 403) {
      return {
        title: 'Your role cannot open this',
        message: `Your role does not include access to ${subject}. Ask a practice admin to grant it.`,
        retryable: false,
      };
    }
    if (error.status === 404) {
      return {
        title: 'Not found',
        message: `openrunic could not find ${subject}. It may have been merged or removed. Check the identifier and search again.`,
        retryable: false,
      };
    }
    if (error.status === 501) {
      return {
        title: 'Not built yet',
        message: `This part of openrunic is not implemented yet, so ${subject} has nothing to show.`,
        retryable: false,
      };
    }
    if (error.status >= 500) {
      return {
        title: 'The server could not answer',
        message: `The server failed while loading ${subject}. Try again; if it keeps failing, report the request id below.`,
        retryable: true,
      };
    }
    return {
      title: 'That request was refused',
      message: error.problem?.detail ?? `The server refused the request for ${subject}.`,
      retryable: false,
    };
  }

  return {
    title: 'This did not load',
    message: `openrunic could not load ${subject}. Try again.`,
    retryable: true,
  };
}

export function ErrorState({
  subject,
  error = null,
  message,
  onRetry,
}: ErrorStateProps): ReactElement {
  const explanation = explain(subject, error);
  const requestId = error instanceof ApiError ? (error.problem?.requestId ?? null) : null;

  return (
    <Card className="or-error-state" tone="cream">
      {/* role="alert" so the failure interrupts: the user is waiting on this. */}
      <div role="alert" className="or-error-state__body">
        <h3 className="or-h3">{explanation.title}</h3>
        <p className="or-body">{message ?? explanation.message}</p>
        {requestId ? (
          <p className="or-caption or-error-state__meta">
            Request id <span className="or-mono">{requestId}</span>
          </p>
        ) : null}
      </div>
      {onRetry && explanation.retryable ? (
        <Button variant="secondary" iconLeft="rotate-ccw" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Card>
  );
}
