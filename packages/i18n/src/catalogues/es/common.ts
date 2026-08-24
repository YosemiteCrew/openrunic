import type { Messages } from '../../catalogue.js';

/**
 * LAS PALABRAS QUE COMPARTEN TODAS LAS PANTALLAS.
 *
 * `{subject}` llega ya traducido por la pantalla que lo pide, de modo que la
 * frase se arma una sola vez y en el orden que el español necesita.
 */
export const common: Messages = {
  'common.tryAgain': 'Intentar de nuevo',
  'common.requestId': 'Identificador de solicitud',
  'common.loading': 'Cargando {subject}',

  'common.error.network.title': 'Sin conexión con el servidor',
  'common.error.network.message':
    'openrunic no pudo conectar con el servidor, así que no se cargó {subject}. Revise la conexión e inténtelo de nuevo.',
  'common.error.sessionEnded.title': 'Su sesión ha terminado',
  'common.error.sessionEnded.message':
    'Inicie sesión de nuevo para continuar. No se ha perdido nada de lo que escribió.',
  'common.error.forbidden.title': 'Su rol no puede abrir esto',
  'common.error.forbidden.message':
    'Su rol no incluye acceso a {subject}. Pida a un administrador de la clínica que se lo conceda.',
  'common.error.notFound.title': 'No se encontró',
  'common.error.notFound.message':
    'openrunic no pudo encontrar {subject}. Es posible que se haya fusionado o eliminado. Revise el identificador y busque de nuevo.',
  'common.error.notBuilt.title': 'Todavía sin construir',
  'common.error.notBuilt.message':
    'Esta parte de openrunic aún no está implementada, así que {subject} no tiene nada que mostrar.',
  'common.error.server.title': 'El servidor no pudo responder',
  'common.error.server.message':
    'El servidor falló al cargar {subject}. Inténtelo de nuevo; si sigue fallando, informe el identificador de solicitud que aparece abajo.',
  'common.error.refused.title': 'Esa solicitud fue rechazada',
  'common.error.refused.message': 'El servidor rechazó la solicitud de {subject}.',
  'common.error.unknown.title': 'Esto no se cargó',
  'common.error.unknown.message': 'openrunic no pudo cargar {subject}. Inténtelo de nuevo.',
};
