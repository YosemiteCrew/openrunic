import type { Messages } from '../../catalogue.js';

/**
 * Words that belong to no one screen: a Try again button, a Request id line,
 * an empty-state heading reused in four places. Small on purpose - a key that
 * could live in an area's own file should.
 *
 * Empty until the slice that fills it lands. The file exists ahead of its
 * strings on purpose: the layout is what lets several screens be converted at
 * once without every one of them editing the same file. See `./index.ts`.
 */
export const common: Messages = {};
