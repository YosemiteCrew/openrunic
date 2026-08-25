import type { Messages } from '../../catalogue.js';

/**
 * Words that belong to no one screen: a Try again button, a Request id line,
 * an empty-state heading reused in four places. Small on purpose - a key that
 * could live in an area's own file should.
 *
 * The error explanations are here rather than in an area file because there is
 * exactly one error surface in this product and every screen reaches it. Each
 * takes a `{subject}` - "the visits report", "today's schedule" - supplied by
 * the screen that failed, as one message with a placeholder rather than a
 * sentence assembled from translated fragments: word order differs by language,
 * and "The server failed while loading" plus a noun cannot be reordered.
 *
 * See `./index.ts` for how the areas compose and why they are separate files.
 */
export const common: Messages = {
  'common.tryAgain': 'Try again',
  'common.requestId': 'Request id',
  'common.loading': 'Loading {subject}',

  // What a formatter renders when a value is genuinely absent. Never an empty
  // cell: a blank reads as a field that failed to load, and on a chart the
  // difference between "we did not record this" and "this did not arrive" is
  // the difference between a gap and a fault.
  'common.notRecorded': 'Not recorded',

  // Age, in the unit a clinician would say it in. Abbreviations rather than
  // words, because these render inside a patient banner beside the name.
  'common.age.days': '{count} d',
  'common.age.months': '{count} mo',
  'common.age.years': '{count} y',

  // Elapsed time for wait timers and status ages. Under a minute reads as a
  // phrase rather than a count of seconds, because a second-by-second number on
  // a clinical board invites watching it.
  'common.elapsed.justNow': 'just now',
  'common.elapsed.minutes': '{count} min',
  'common.elapsed.hours': '{count} h',
  'common.elapsed.hoursMinutes': '{count} h {minutes} min',
  'common.elapsed.days': '{count} d',

  'common.error.network.title': 'No connection to the server',
  'common.error.network.message':
    'openrunic could not reach the server, so {subject} did not load. Check the connection and try again.',
  'common.error.session.title': 'Your session has ended',
  'common.error.session.message': 'Sign in again to continue. Nothing you entered has been lost.',
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

  /*
   * The accessible name of every dismiss control in the product. It lived in
   * `packages/ui` as an English literal on `Alert` and `Toast`, which meant a
   * Spanish screen had an English close button on its notices. The design system
   * takes it as a prop now and `components/state` supplies it once. See #196.
   */
  'common.dismiss': 'Dismiss',
};
