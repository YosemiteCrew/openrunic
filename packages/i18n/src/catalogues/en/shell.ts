import type { Messages } from '../../catalogue.js';

/**
 * The frame every screen sits in: the skip link, the rail, the breadcrumb.
 *
 * See `../en/index.ts` for how the areas compose and why they are separate
 * files.
 */
export const shell: Messages = {
  'shell.skipToContent': 'Skip to content',
  'shell.mainNavigation': 'Main navigation',
  'shell.breadcrumb': 'Breadcrumb',
  'shell.signOut': 'Sign out',
  'shell.signedInAs': 'Signed in as {name}',
  'shell.commandPalette': 'Search or run a command',
  'shell.pageContext': 'Page context',
};
