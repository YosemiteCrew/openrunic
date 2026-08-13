import { IS_MOCK_MODE } from '../config';
import { MOCK_NOW } from '../mock/fixtures';

/**
 * "Now", as the chart reads it.
 *
 * In mock mode it is the fixtures' fixed instant, so an age, a wait timer and a
 * "next appointment" render identically on every machine and in every test run.
 * In live mode it is the wall clock. Screens call this instead of `new Date()`
 * so nothing on a chart moves because a screenshot was taken an hour later.
 */
export function clinicNow(): string {
  return IS_MOCK_MODE ? MOCK_NOW : new Date().toISOString();
}
