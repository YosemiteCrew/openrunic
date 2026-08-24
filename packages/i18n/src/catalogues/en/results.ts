import type { Messages } from '../../catalogue.js';

/**
 * The result list, the reading view and sign-off. Clinical.
 *
 * Empty until the slice that fills it lands. The file exists ahead of its
 * strings on purpose: the layout is what lets several screens be converted at
 * once without every one of them editing the same file. See `./index.ts`.
 */
export const results: Messages = {};
