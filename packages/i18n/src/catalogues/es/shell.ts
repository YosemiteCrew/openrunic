import type { Messages } from '../../catalogue.js';

/**
 * The frame, in Spanish. Navigation and chrome: safe to translate.
 *
 * The palette's own words are here rather than in `nav` for the same reason
 * they are in the English file: `nav` owns the rows a reader navigates to, and
 * these are the words wrapped around them.
 *
 * See `./index.ts` for what is deliberately absent from this language and why.
 */
export const shell: Messages = {
  'shell.skipToContent': 'Saltar al contenido',
  'shell.breadcrumb': 'Ruta de navegación',
  'shell.signOut': 'Cerrar sesión',
  'shell.signedInAs': 'Sesión iniciada como {name}',
  'shell.commandPalette': 'Buscar o ejecutar un comando',
  'shell.pageContext': 'Contexto de la página',

  'shell.demoData': 'Datos de demostración',

  'shell.palette.title': 'Paleta de comandos',
  'shell.palette.searchLabel': 'Buscar pacientes, pantallas y acciones',
  'shell.palette.searchPlaceholder': 'Escriba un paciente, una pantalla o una acción',
  'shell.palette.results': 'Resultados',
  'shell.palette.empty':
    'Nada coincide con "{query}". Pruebe con el nombre de un paciente, un número de expediente o una pantalla.',
  'shell.palette.footer': 'Las flechas mueven, Enter abre, Escape cierra.',
  'shell.palette.born': 'Nacido el {date}',
  'shell.palette.group.patients': 'Pacientes',
  'shell.palette.group.navigate': 'Ir a',
  'shell.palette.group.actions': 'Acciones',

  'shell.metaDescription': 'Sistema operativo de código abierto para la salud humana',

  'shell.mainNavigation': 'Navegación principal',
  'shell.menu': 'Menú',
  'shell.closeMenu': 'Cerrar el menú',
};
