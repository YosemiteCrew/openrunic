import type { Messages } from '../../catalogue.js';
import { compose } from '../compose.js';

import { admin } from './admin.js';
import { auth } from './auth.js';
import { billing } from './billing.js';
import { common } from './common.js';
import { downtime } from './downtime.js';
import { inbox } from './inbox.js';
import { marketing } from './marketing.js';
import { nav } from './nav.js';
import { portal } from './portal.js';
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
 * ## Adding one of those areas later
 *
 * Writing `es/chart.ts` is not enough, and the compiler will not say so: an
 * area file nothing imports type-checks perfectly and every clinical string
 * goes on quietly falling back to English, which is the failure this package
 * exists to make visible rather than one to introduce.
 *
 * Two more lines are needed here and they are the same two for every area: the
 * import, and the entry in `esAreas`. The catalogue is derived from that
 * registry, so there is no spread to keep in step with it.
 * `catalogues.test.ts` reads this directory and refuses a file that has not
 * been registered, so the mistake is a red build rather than a language that
 * never arrives.
 */

/**
 * The areas, and the only place a new one is registered.
 *
 * `es` below is derived from this rather than written beside it. A second
 * hand-maintained list is a second place to forget, and forgetting it fails a
 * test that points at the area file - which is the one thing the contributor
 * got right.
 */
export const esAreas: Readonly<Record<string, Messages>> = {
  shell,
  nav,
  downtime,
  auth,
  marketing,
  schedule,
  billing,
  admin,
  inbox,
  reports,
  portal,
  common,
};

export const es: Messages = compose(esAreas);
