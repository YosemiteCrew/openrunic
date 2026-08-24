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

/**
 * What went wrong, as catalogue keys rather than sentences.
 *
 * Keys because this is a plain function with no translator and no reader: the
 * words are looked up by `ErrorState`, per render, in the language of whoever
 * is looking at the screen. Returning English here would have made every error
 * in the product untranslatable however well the surface around it was wired.
 *
 * Most of these messages carry a `{subject}` the surface fills in with what
 * failed to load - one message with a placeholder rather than a fragment joined
 * to a noun, because word order differs by language and a sentence assembled
 * from pieces cannot be reordered by a translator. `takesSubject` says which,
 * and the field's own note says why that is not left to be inferred.
 */
export interface Explanation {
  readonly titleKey: string;
  readonly messageKey: string;
  /**
   * Whether `messageKey` has a `{subject}` to fill.
   *
   * Carried rather than inferred because interpolation is strict in both
   * directions: a placeholder with no value throws, and so does a value the
   * message does not use. Every explanation here names what failed to load
   * except the ended session, which is about the reader rather than the region
   * they were looking at, so passing it a subject would be a runtime error in
   * the one place a person is already locked out.
   */
  readonly takesSubject: boolean;
  /**
   * The server's own sentence, when it sent one, and null otherwise.
   *
   * Data rather than copy: it arrives in an RFC 9457 problem document written
   * by the API, and it is shown as received. Translating it here would put a
   * second wording on a sentence that already has one, and the second would be
   * this application guessing at what the server meant.
   */
  readonly detail: string | null;
  readonly retryable: boolean;
}

/**
 * The status-to-sentence table. Each line says what happened and what to do,
 * in the clinician register: precise, short, no filler, never blaming.
 */
export function explain(error: ExplainableError): Explanation {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return {
        titleKey: 'common.error.network.title',
        messageKey: 'common.error.network.message',
        takesSubject: true,
        detail: null,
        retryable: true,
      };
    }
    if (error.status === 401) {
      return {
        titleKey: 'common.error.session.title',
        messageKey: 'common.error.session.message',
        takesSubject: false,
        detail: null,
        retryable: false,
      };
    }
    if (error.status === 403) {
      return {
        titleKey: 'common.error.forbidden.title',
        messageKey: 'common.error.forbidden.message',
        takesSubject: true,
        detail: null,
        retryable: false,
      };
    }
    if (error.status === 404) {
      return {
        titleKey: 'common.error.notFound.title',
        messageKey: 'common.error.notFound.message',
        takesSubject: true,
        detail: null,
        retryable: false,
      };
    }
    if (error.status === 501) {
      return {
        titleKey: 'common.error.notBuilt.title',
        messageKey: 'common.error.notBuilt.message',
        takesSubject: true,
        detail: null,
        retryable: false,
      };
    }
    if (error.status >= 500) {
      return {
        titleKey: 'common.error.server.title',
        messageKey: 'common.error.server.message',
        takesSubject: true,
        detail: null,
        retryable: true,
      };
    }
    return {
      titleKey: 'common.error.refused.title',
      messageKey: 'common.error.refused.message',
      takesSubject: true,
      detail: error.problem?.detail ?? null,
      retryable: false,
    };
  }

  return {
    titleKey: 'common.error.unknown.title',
    messageKey: 'common.error.unknown.message',
    takesSubject: true,
    detail: null,
    retryable: true,
  };
}
