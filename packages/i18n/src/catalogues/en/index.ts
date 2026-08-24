import type { Messages } from '../../catalogue.js';

import { admin } from './admin.js';
import { assistant } from './assistant.js';
import { auth } from './auth.js';
import { billing } from './billing.js';
import { chart } from './chart.js';
import { common } from './common.js';
import { downtime } from './downtime.js';
import { encounter } from './encounter.js';
import { inbox } from './inbox.js';
import { insurance } from './insurance.js';
import { marketing } from './marketing.js';
import { nav } from './nav.js';
import { orders } from './orders.js';
import { patients } from './patients.js';
import { reports } from './reports.js';
import { results } from './results.js';
import { schedule } from './schedule.js';
import { shell } from './shell.js';

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
 * ## One file per area, and the first segment says which
 *
 * The catalogue was one file until the areas it names outgrew it. Splitting it
 * along the line the key names already drew buys three things and costs a
 * barrel file:
 *
 * - a translator opens `billing.ts` rather than scrolling to the billing part
 * - a reviewer sees which screens a diff touches from the file list alone
 * - several screens can be converted at once without every one of them editing
 *   the same file, which is the difference between a queue and a fan-out
 *
 * An area file may be empty. That means its slice has not landed yet, not that
 * the screen has no words.
 *
 * The composition is a spread, so a key defined in two areas would be taken
 * from the later one silently. `catalogues.test.ts` refuses that rather than
 * relying on nobody doing it: two files claiming one key is two people
 * disagreeing about what a screen says, and the answer is to pick an owner
 * rather than an order.
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
  ...downtime,
  ...auth,
  ...marketing,
  ...schedule,
  ...patients,
  ...chart,
  ...encounter,
  ...orders,
  ...results,
  ...billing,
  ...insurance,
  ...inbox,
  ...assistant,
  ...reports,
  ...admin,
  ...common,
};

/** The areas, separately, so a test can ask which file a key came from. */
export const enAreas: Readonly<Record<string, Messages>> = {
  shell,
  nav,
  downtime,
  auth,
  marketing,
  schedule,
  patients,
  chart,
  encounter,
  orders,
  results,
  billing,
  insurance,
  inbox,
  assistant,
  reports,
  admin,
  common,
};
