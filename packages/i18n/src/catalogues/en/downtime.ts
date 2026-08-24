import type { Messages } from '../../catalogue.js';

/**
 * The single most important sentences this application ever shows, and the ones
 * a reader is least able to puzzle out from context. Written for a front-desk
 * user in the middle of a clinic day. No "5xx", no "upstream", no "connection
 * pool".
 *
 * See `../en/index.ts` for how the areas compose and why they are separate
 * files.
 */
export const downtime: Messages = {
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
};
