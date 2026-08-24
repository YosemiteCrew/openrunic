import type { Messages } from '../catalogue.js';

import { common } from './en/common.js';
import { marketing } from './en/marketing.js';
import { nav } from './en/nav.js';
import { reports } from './en/reports.js';
import { shell } from './en/shell.js';

/**
 * THE SOURCE CATALOGUE: EVERY STRING THE STAFF APPLICATION SHOWS.
 *
 * This is the language the software is written in, so it is also the fallback
 * for every other. A key that is missing here is a bug rather than a
 * translation job, which is why `lookup` distinguishes the two.
 *
 * ## How keys are named
 *
 * `area.thing.detail`, dotted, lowercase. The first segment names the screen or
 * the shared surface, so a translator working on billing can see the whole of
 * billing in one place and a reviewer can tell which screen a change affects
 * without opening it.
 *
 * Flat, not nested. A nested catalogue reads better in a file and turns every
 * lookup into a walk that can end on an object rather than a string, which then
 * renders as `[object Object]` in the one place nobody tested.
 *
 * ## One file per area
 *
 * An area whose copy is large enough to review on its own lives in `en/`, one
 * file per first segment, and is spread in below. The areas still in this file
 * are the ones small enough to read in place. Splitting is a move, never a
 * rewrite: the keys and their text are identical either side of it, and a key
 * may appear in exactly one place, because two files claiming the same key
 * makes which text wins a question about import order.
 *
 * ## What belongs here and what does not
 *
 * Anything a person reads. Not: coded values that come from the API and are
 * already coded (a LOINC display, an ICD-10 title), because translating those
 * in the interface would put a second, diverging name on a code that already
 * has one.
 */
export const en: Messages = {
  ...shell,
  ...nav,
  ...common,
  ...reports,
  ...marketing,

  /* ------------------------------------------------------------- connection */
  /* The single most important sentence this application ever shows, and the one
     a reader is least able to puzzle out from context: their notes are not
     being saved. Written for a front-desk user in the middle of a clinic day.
     No "5xx", no "upstream", no "connection pool". */
  'downtime.online.title': 'Connected',
  'downtime.online.detail': 'openrunic is working normally.',
  'downtime.degraded.title': 'Read-only: records cannot be saved',
  'downtime.degraded.detail':
    'The application is running but cannot reach the patient records database. Anything already on screen is still readable. New notes, orders and changes will not be saved.',
  'downtime.degraded.action':
    'Keep working on paper for now and enter it once this message clears. Tell whoever looks after your server that the database is unreachable. This page checks again every few seconds on its own.',
  'downtime.offline.title': 'Cannot reach openrunic',
  'downtime.offline.detail':
    'This computer cannot reach the openrunic server. That usually means the server is restarting, or this machine has lost its network connection.',
  'downtime.offline.action':
    'Check that this computer is on the practice network. If other computers have the same message, the server itself is down - tell whoever looks after it. This page keeps trying on its own; do not close it.',
  'downtime.checkAgain': 'Check again now',

  /* The error boundary. `area` is the screen's own name, or "this screen". */
  'downtime.failed.title': '{area} could not be displayed',
  'downtime.failed.reassurance':
    'Something went wrong while loading this page. No patient information has been changed or lost by this - anything you saved before now is safe.',
  'downtime.failed.next':
    'Try reloading the page. If it happens again, use a different screen for now and tell whoever looks after your server, quoting the reference below.',
  'downtime.failed.reference': 'Reference {reference}',
  'downtime.failed.thisScreen': 'this screen',

  /* ------------------------------------------------------------------- auth */
  /* The sign-in screen is the first thing anybody reads, and often the first
     thing they read after being signed out mid-shift. A form that appears
     without explanation reads as a fault and gets reported as one, so every
     notice here says why it is on screen. */
  'auth.signIn.title': 'Sign in',
  'auth.signIn.lede':
    'openrunic staff access. A session ends after {minutes} minutes without activity, so a workstation left unattended does not stay open on a chart.',
  'auth.signIn.tokenLabel': 'Access token',
  'auth.signIn.tokenHint': 'The bearer token your deployment issued you.',
  'auth.signIn.tokenRejected': 'That access token was not recognised.',
  'auth.signIn.submit': 'Sign in',
  'auth.signIn.submitting': 'Signing in',
  'auth.signIn.provider': 'Sign in with your organisation',
  'auth.signIn.developmentHeading': 'Development sign-in',
  'auth.signIn.unavailable.title': 'The sign-in service could not be reached.',
  'auth.signIn.unavailable.body': 'Check that the application is still running, then try again.',
  'auth.signedOut.idle.title': 'You were signed out after {minutes} minutes without activity.',
  'auth.signedOut.idle.body': 'Sign in again to pick up where you left off.',
  'auth.signedOut.expired.title': 'Your session has ended.',
  'auth.signedOut.expired.body': 'Sign in again to continue.',
  'auth.holding': 'Restoring your session',
};
