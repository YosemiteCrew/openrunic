import type { Messages } from '../../catalogue.js';

/**
 * The order composer, the picker and the draft tray. Clinical.
 *
 * Empty until the slice that fills it lands. The file exists ahead of its
 * strings on purpose: the layout is what lets several screens be converted at
 * once without every one of them editing the same file. See `./index.ts`.
 */
export const orders: Messages = {};
