import type { Messages } from '../../catalogue.js';

/**
 * THE WORDS EVERY SCREEN SHARES.
 *
 * "Try again" and "Request id" are here rather than repeated per screen because
 * a retry control that is worded three ways is three controls to a reader who
 * does not already know they are the same one.
 *
 * The bulk of this file is the status-to-sentence table behind `explain()`:
 * what happened, then what to do, in the clinician register. Every message
 * takes `{subject}` - the noun phrase the screen supplies for what it was
 * reading, "today's schedule", "the visits report" - except the ones where
 * naming it would add nothing. A sentence with a placeholder is one message a
 * translator can put in their own word order; a sentence assembled from
 * "could not load" plus a subject is two fragments that cannot be.
 *
 * Nothing here is clinical: these are statements about the software's own
 * state, so they are safe to translate without a clinician.
 */
export const common: Messages = {
  'common.tryAgain': 'Try again',
  'common.requestId': 'Request id',
  /* The polite live region beside a skeleton. The subject arrives lower case. */
  'common.loading': 'Loading {subject}',

  'common.error.network.title': 'No connection to the server',
  'common.error.network.message':
    'openrunic could not reach the server, so {subject} did not load. Check the connection and try again.',
  'common.error.sessionEnded.title': 'Your session has ended',
  'common.error.sessionEnded.message':
    'Sign in again to continue. Nothing you entered has been lost.',
  'common.error.forbidden.title': 'Your role cannot open this',
  'common.error.forbidden.message':
    'Your role does not include access to {subject}. Ask a practice admin to grant it.',
  'common.error.notFound.title': 'Not found',
  'common.error.notFound.message':
    'openrunic could not find {subject}. It may have been merged or removed. Check the identifier and search again.',
  'common.error.notBuilt.title': 'Not built yet',
  'common.error.notBuilt.message':
    'This part of openrunic is not implemented yet, so {subject} has nothing to show.',
  'common.error.server.title': 'The server could not answer',
  'common.error.server.message':
    'The server failed while loading {subject}. Try again; if it keeps failing, report the request id below.',
  'common.error.refused.title': 'That request was refused',
  'common.error.refused.message': 'The server refused the request for {subject}.',
  'common.error.unknown.title': 'This did not load',
  'common.error.unknown.message': 'openrunic could not load {subject}. Try again.',
};
