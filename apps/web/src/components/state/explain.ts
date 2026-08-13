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
 */
export function explain(subject: string, error: ExplainableError): Explanation {
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
