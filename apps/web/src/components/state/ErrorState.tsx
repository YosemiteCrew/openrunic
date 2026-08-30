'use client';

import { Button, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { ApiError } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

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
  /**
   * What was being read: "today's schedule", "this patient". Lower case, no
   * full stop.
   *
   * Already translated when it arrives: the screen that failed knows which of
   * its regions this was, and looks the noun phrase up before handing it over.
   * It lands inside a translated sentence, so passing a key would only move the
   * lookup without changing what the reader sees.
   */
  subject: string;
  error?: ExplainableError;
  /** Overrides the derived sentence when a screen knows better. Already translated. */
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
  const t = useTranslator();
  const explanation = explain(error);
  const requestId = error instanceof ApiError ? (error.problem?.requestId ?? null) : null;

  /* The screen's own override first, then the server's own sentence when it
     sent one, and only then this application's wording. The middle case is why
     `detail` is carried rather than translated: it is the API's account of what
     it refused, and it is shown as received. */
  const derived = explanation.takesSubject
    ? t(explanation.messageKey, { subject })
    : t(explanation.messageKey);
  const body = message ?? explanation.detail ?? derived;

  return (
    <Card className="or-error-state" tone="cream">
      {/* role="alert" so the failure interrupts: the user is waiting on this. */}
      <div role="alert" className="or-error-state__body">
        <h3 className="or-h3">{t(explanation.titleKey)}</h3>
        <p className="or-body">{body}</p>
        {requestId ? (
          <p className="or-caption or-error-state__meta">
            {t('common.requestId')} <span className="or-mono">{requestId}</span>
          </p>
        ) : null}
      </div>
      {onRetry && explanation.retryable ? (
        <Button variant="secondary" iconLeft="rotate-ccw" onClick={onRetry}>
          {t('common.tryAgain')}
        </Button>
      ) : null}
    </Card>
  );
}
