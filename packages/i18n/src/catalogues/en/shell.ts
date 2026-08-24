import type { Messages } from '../../catalogue.js';

/**
 * THE STAFF SHELL: THE FRAME EVERY CLINICAL SCREEN RENDERS INSIDE.
 *
 * The rail, the top bar, the breadcrumb and the command palette. None of it is
 * clinical content - it is the furniture a person navigates by - so all of it
 * can be translated by anybody who speaks the language.
 *
 * The palette lives here rather than in an area of its own because it is part
 * of the shell: it is registered once, by `AppShell`, and it is the primary
 * navigation for anyone driving this application from the keyboard.
 */
export const shell: Messages = {
  'shell.skipToContent': 'Skip to content',
  'shell.mainNavigation': 'Main navigation',
  'shell.breadcrumb': 'Breadcrumb',
  'shell.signOut': 'Sign out',
  'shell.signedInAs': 'Signed in as {name}',
  'shell.commandPalette': 'Search or run a command',
  'shell.pageContext': 'Page context',
  /* Demo data is never silent: every screen says so, in the same place. */
  'shell.demoData': 'Demo data',

  /* The command palette. The dialog's own name comes first because it is the
     accessible name of the dialog, which is what a screen reader announces
     before anything inside it. */
  'shell.palette.title': 'Command palette',
  'shell.palette.searchLabel': 'Search patients, screens and actions',
  'shell.palette.searchPlaceholder': 'Type a patient, a screen, or an action',
  'shell.palette.results': 'Results',
  'shell.palette.empty': 'Nothing matches "{query}". Try a patient name, an MRN, or a screen.',
  'shell.palette.keys': 'Arrow keys move, Enter opens, Escape closes.',
  /* Beside a patient result, so two people with the same name are separable. */
  'shell.palette.born': 'Born {date}',
  'shell.palette.group.patients': 'Patients',
  'shell.palette.group.navigate': 'Go to',
  'shell.palette.group.actions': 'Actions',
};
