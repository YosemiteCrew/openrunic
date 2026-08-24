import type { Messages } from '../catalogue.js';

/**
 * One locale's areas, flattened into the catalogue it renders from.
 *
 * The areas are the thing maintained and this is derived, deliberately in that
 * direction. The reverse - a hand-written spread beside a hand-written registry
 * - was the shape review found first: a contributor adding an area had three
 * places to remember, got two of them, and the composition test failed pointing
 * at the file they had just written correctly.
 *
 * Order is insertion order and does not decide anything. Two areas claiming one
 * key is refused by `catalogues.test.ts` rather than resolved by whichever
 * spread came last, so this never has to be read for precedence.
 */
export function compose(areas: Readonly<Record<string, Messages>>): Messages {
  return Object.assign({}, ...Object.values(areas)) as Messages;
}
