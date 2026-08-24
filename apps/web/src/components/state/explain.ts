import type { Translator } from '@openrunic/i18n';

import { ApiError } from '@/lib/api';

/**
 * Anything a screen can hand the error surface.
 *
 * `null` is the single "no detail" value, because that is what the data layer
 * produces: `AsyncState.error` is `ApiError | null` in every state it can be
 * in. Callers that have no error at all omit the prop instead, and
 * `ErrorState` normalises the omission to `null` with a destructuring default,
 * so `undefined` never needs to reach `explain`.
 */
export type ExplainableError = ApiError | Error | null;

interface Explanation {
  title: string;
  message: string;
  retryable: boolean;
}

/**
 * The status-to-sentence table. Each line says what happened and what to do,
 * in the clinician register: precise, short, no filler, never blaming.
 *
 * It takes the translator rather than reaching for the hook, because this is a
 * plain function: it is called from `ErrorState` during render and from tests
 * directly, and neither is a place a React hook can run. The keys live in
 * `common` because every screen in the product shows these same eight
 * sentences.
 *
 * `subject` arrives already translated - the screen owns the noun phrase for
 * what it was reading - and goes into the message as a placeholder rather than
 * being concatenated onto a translated fragment, because where the subject
 * falls in the sentence is a decision each language makes for itself.
 */
export function explain(
  translate: Translator,
  subject: string,
  error: ExplainableError
): Explanation {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return {
        title: translate('common.error.network.title'),
        message: translate('common.error.network.message', { subject }),
        retryable: true,
      };
    }
    if (error.status === 401) {
      return {
        title: translate('common.error.sessionEnded.title'),
        // The one sentence with no subject in it: what was being read does not
        // change what to do about a session that has ended.
        message: translate('common.error.sessionEnded.message'),
        retryable: false,
      };
    }
    if (error.status === 403) {
      return {
        title: translate('common.error.forbidden.title'),
        message: translate('common.error.forbidden.message', { subject }),
        retryable: false,
      };
    }
    if (error.status === 404) {
      return {
        title: translate('common.error.notFound.title'),
        message: translate('common.error.notFound.message', { subject }),
        retryable: false,
      };
    }
    if (error.status === 501) {
      return {
        title: translate('common.error.notBuilt.title'),
        message: translate('common.error.notBuilt.message', { subject }),
        retryable: false,
      };
    }
    if (error.status >= 500) {
      return {
        title: translate('common.error.server.title'),
        message: translate('common.error.server.message', { subject }),
        retryable: true,
      };
    }
    return {
      title: translate('common.error.refused.title'),
      // The server's own detail when it sent one. It is a problem document
      // field rather than copy this application wrote, so it is rendered as it
      // arrived rather than translated over.
      message: error.problem?.detail ?? translate('common.error.refused.message', { subject }),
      retryable: false,
    };
  }

  return {
    title: translate('common.error.unknown.title'),
    message: translate('common.error.unknown.message', { subject }),
    retryable: true,
  };
}
