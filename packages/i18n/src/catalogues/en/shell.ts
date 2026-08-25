import type { Messages } from '../../catalogue.js';

/**
 * The frame every screen sits in: the skip link, the rail, the breadcrumb, the
 * top bar and the command palette.
 *
 * The palette lives here rather than in `nav` because it is chrome: `nav` owns
 * the rows a reader navigates to, and these are the words wrapped around them.
 * Its group headings are the same distinction - "Go to" names a category of
 * command, not a screen.
 *
 * See `../en/index.ts` for how the areas compose and why they are separate
 * files.
 */
export const shell: Messages = {
  'shell.skipToContent': 'Skip to content',
  /*
   * There is no `shell.mainNavigation`. It was written for the `<nav>` in
   * `SideNav`, which hardcodes `aria-label="Primary"` - and which also hardcodes
   * "Menu", "Close" and the brand's alt text. Translating one of four English
   * strings in a component reads as finished and is not, so the whole of that
   * component is one job rather than a corner of this catalogue, filed as #196.
   * `shell.breadcrumb` below is here because that `<nav>` is in `apps/web` and
   * does take a label.
   */
  'shell.breadcrumb': 'Breadcrumb',
  'shell.signOut': 'Sign out',
  'shell.signedInAs': 'Signed in as {name}',
  'shell.commandPalette': 'Search or run a command',
  'shell.pageContext': 'Page context',

  /* Mock mode says so, in the same place on every screen. */
  'shell.demoData': 'Demo data',

  'shell.palette.title': 'Command palette',
  'shell.palette.searchLabel': 'Search patients, screens and actions',
  'shell.palette.searchPlaceholder': 'Type a patient, a screen, or an action',
  'shell.palette.results': 'Results',
  'shell.palette.empty': 'Nothing matches "{query}". Try a patient name, an MRN, or a screen.',
  'shell.palette.footer': 'Arrow keys move, Enter opens, Escape closes.',
  /* The right-aligned line under a patient result. A date of birth is what
     separates two people with the same name, so it is worded rather than left
     as a bare date. */
  'shell.palette.born': 'Born {date}',
  'shell.palette.group.patients': 'Patients',
  'shell.palette.group.navigate': 'Go to',
  'shell.palette.group.actions': 'Actions',

  /*
   * The application's own one-line description, used by any route that does
   * not write its own. It sits in `shell` rather than `marketing` because both
   * root layouts read it, and the staff one is not marketing.
   */
  'shell.metaDescription': 'Open-source operating system for human health',
};
