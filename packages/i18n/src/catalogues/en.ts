import type { Messages } from '../catalogue.js';

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
 * ## What belongs here and what does not
 *
 * Anything a person reads. Not: coded values that come from the API and are
 * already coded (a LOINC display, an ICD-10 title), because translating those
 * in the interface would put a second, diverging name on a code that already
 * has one.
 */
export const en: Messages = {
  /* ------------------------------------------------------------------ shell */
  'shell.skipToContent': 'Skip to content',
  'shell.mainNavigation': 'Main navigation',
  'shell.breadcrumb': 'Breadcrumb',
  'shell.signOut': 'Sign out',
  'shell.signedInAs': 'Signed in as {name}',
  'shell.commandPalette': 'Search or run a command',
  'shell.pageContext': 'Page context',

  /* The rail, the command palette, and the search words a tired person types
     instead of the label. Keywords are per-language and not transliterations:
     a Spanish speaker looking for the flow board does not type "flow". */
  'nav.schedule': 'Schedule',
  'nav.schedule.keywords': 'calendar, day view, appointments, book, front desk',
  'nav.flowBoard': 'Flow Board',
  'nav.flowBoard.keywords': 'flow, board, waiting, rooms, check in, arrived, wait time',
  'nav.patients': 'Patients',
  'nav.patients.keywords': 'chart, register, search, demographics, mrn',
  'nav.inbox': 'Inbox',
  'nav.inbox.keywords': 'tasks, messages, refills, cosign, worklist',
  'nav.orders': 'Orders',
  'nav.orders.keywords': 'labs, imaging, prescriptions, erx, requisition',
  'nav.billing': 'Billing',
  'nav.billing.keywords': 'fee sheet, charges, claims, era, payments, aging',
  'nav.reports': 'Reports',
  'nav.reports.keywords': 'dashboard, kpi, exports, analytics',
  'nav.admin': 'Admin',
  'nav.admin.keywords': 'users, roles, facilities, form builder, settings, audit',
  'nav.results': 'Results',
  'nav.results.keywords': 'labs, flowsheet, sign off, abnormal, pending review',
  'nav.newPatient': 'New patient',
  'nav.newPatient.keywords': 'register, registration, walk-in, add patient, new record',
  'nav.newOrder': 'New order',
  'nav.newOrder.keywords': 'order labs, order imaging, requisition, composer, procedure',

  /* Billing is one rail row and five workbenches; admin is one and six. Each is
     named so somebody reaches the screen they mean by typing the word they use
     for it, rather than landing on the section and hunting. */
  'nav.feeSheet': 'Fee sheet',
  'nav.feeSheet.keywords': 'charges, charge capture, superbill, cpt, justify, dx link',
  'nav.claimWorkbench': 'Claim workbench',
  'nav.claimWorkbench.keywords': 'claims, scrub, submit, denied, ageing, aging, 837',
  'nav.remittance': 'Remittance',
  'nav.remittance.keywords': 'era, 835, eob, auto-post, posting, exceptions',
  'nav.statements': 'Statements and AR',
  'nav.statements.keywords': 'statements, ar, aging, ageing, dunning, balances, text to pay',
  'nav.payments': 'Payments',
  'nav.payments.keywords': 'payment, copay, collect, receipt, card on file, allocation',
  'nav.usersAndRoles': 'Users and roles',
  'nav.usersAndRoles.keywords': 'staff, accounts, permissions, acl, invite, mfa, deactivate',
  'nav.facilities': 'Facilities',
  'nav.facilities.keywords': 'locations, sites, pos code, hours, rooms, npi',
  'nav.formBuilder': 'Form builder',
  'nav.formBuilder.keywords': 'forms, layout, lbf, intake, questionnaire, fields, publish',
  'nav.auditTrail': 'Audit trail',
  'nav.auditTrail.keywords': 'audit, access log, phi, breakglass, compliance, export',
  'nav.integrations': 'Integrations',
  'nav.integrations.keywords': 'adapters, erx, clearinghouse, labs, payments, fax, connections',
  'nav.developerPlatform': 'Developer platform',
  'nav.developerPlatform.keywords': 'api, keys, smart, fhir, oauth, webhooks, subscriptions',

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

  /* -------------------------------------------------------------- marketing */
  'marketing.tagline': 'Open-source operating system for human health',
  'marketing.readTheCode': 'Read the code',
  'marketing.licence': 'AGPL-3.0. Yours to run, read and change.',
};
