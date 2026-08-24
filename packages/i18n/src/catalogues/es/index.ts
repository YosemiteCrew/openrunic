import type { Messages } from '../../catalogue.js';

import { admin } from './admin.js';
import { auth } from './auth.js';
import { billing } from './billing.js';
import { common } from './common.js';
import { downtime } from './downtime.js';
import { inbox } from './inbox.js';
import { marketing } from './marketing.js';
import { nav } from './nav.js';
import { reports } from './reports.js';
import { schedule } from './schedule.js';
import { shell } from './shell.js';

/**
 * SPANISH.
 *
 * Deliberately not complete, and the gap is the point rather than a backlog
 * nobody got to.
 *
 * What is translated here is the shell, the connection notices, sign-in, the
 * public pages, and the operational screens: navigation, plain statements about
 * the state of the system, money, and marketing copy. Those can be translated
 * correctly by anyone who speaks the language.
 *
 * What is NOT translated here is anything clinical, and the file list says so
 * rather than a comment having to: there is no `chart.ts`, no `encounter.ts`,
 * no `orders.ts`, no `results.ts`, no `insurance.ts`, no `assistant.ts`. A
 * wrong clinical term is more dangerous than English text a reader has to work
 * through - `lookup` falls back to the source language and says it fell back,
 * so an untranslated medication label reads as obviously English rather than as
 * confidently wrong Spanish. Those strings need a Spanish-speaking clinician,
 * not a developer with a dictionary, and the coverage report names exactly
 * which ones are waiting.
 *
 * Adding one of those files later is how that gap closes. Nothing here has to
 * change for it to.
 */
export const es: Messages = {
  ...shell,
  ...nav,
  ...downtime,
  ...auth,
  ...marketing,
  ...schedule,
  ...billing,
  ...admin,
  ...inbox,
  ...reports,
  ...common,
};
