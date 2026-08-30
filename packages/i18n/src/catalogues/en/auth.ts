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

  /* ------------------------------------------------------- the browser tab */
  /*
   * A route file is a server component, so it cannot reach `useTranslator`.
   * `lib/i18n/metadata.ts` builds its own translator and looks these up. The tab
   * strip is often all a tired person has to tell nine open screens apart.
   */
  'auth.page.title': 'Sign in',

  /*
   * The two paragraphs on the sign-in screen that were written into the JSX.
   *
   * They were missed by #132: both are multi-line text nodes, and one carries an
   * `&apos;`, so neither matched the scan that inventoried that work. They are
   * here now, and the drift test's catalogue-to-code direction is what will
   * notice if either key stops being asked for.
   *
   * `developmentLede` is also rewritten. It used to say the principals "exist in
   * this build only, and the API refuses to accept any of them in production",
   * which stops being true the moment a demonstration build shows them. What is
   * true is narrower and is what it says now: the API refuses to start with
   * them, so nothing they open reaches a real deployment.
   */
  'auth.signIn.providerLede':
    'You will be sent to your identity provider and returned here once it has confirmed who you are.',
  'auth.signIn.developmentLede':
    "These are the API's public development principals: fixtures rather than credentials. The API refuses to start with them in production, so nothing they open reaches a real deployment.",
  'auth.signIn.demoHeading': 'Demonstration',
  'auth.signIn.demoLede':
    'This is a demonstration of openrunic. Every record in it is invented, nothing is saved, and each sign-in below is a public fixture. Sign in as anyone and look around.',
};
