import type { Messages } from '../../catalogue.js';

/** EL MARCO DE LA APLICACION: barra superior, riel, ruta y paleta de comandos. */
export const shell: Messages = {
  'shell.skipToContent': 'Saltar al contenido',
  'shell.mainNavigation': 'Navegación principal',
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
    'Nada coincide con "{query}". Pruebe con el nombre de un paciente, un expediente o una pantalla.',
  'shell.palette.keys': 'Las flechas mueven, Entrar abre, Escape cierra.',
  'shell.palette.born': 'Nacimiento {date}',
  'shell.palette.group.patients': 'Pacientes',
  'shell.palette.group.navigate': 'Ir a',
  'shell.palette.group.actions': 'Acciones',
};
