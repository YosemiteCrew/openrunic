'use client';

import { Button, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { ApiError } from '@/lib/api';

import { explain } from './explain';
import type { ExplainableError } from './explain';

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
  error?: ExplainableError;
  /** Overrides the derived sentence when a screen knows better. */
  message?: string;
  /** Wire this to the hook's `refetch`. Omitted when nothing is retryable. */
  onRetry?: () => void;
}

export function ErrorState({
  subject,
  error = null,
  message,
  onRetry,
}: Readonly<ErrorStateProps>): ReactElement {
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
