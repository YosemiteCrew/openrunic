import type { Messages } from '../../catalogue.js';

/**
 * Sign-in, and being signed out mid-shift. A form that appears without
 * explanation reads as a fault and gets reported as one, so every notice here
 * says why it is on screen.
 *
 * See `../en/index.ts` for how the areas compose and why they are separate
 * files.
 */
export const auth: Messages = {
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
