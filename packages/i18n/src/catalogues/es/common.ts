import type { Messages } from '../../catalogue.js';

/**
 * The words shared across screens: Try again, Request id, and the like.
 *
 * The error explanations are here for the same reason they are in the English
 * file: there is one error surface in this product and every screen reaches it.
 * `{subject}` is the noun phrase the screen supplies - "el panel de la
 * consulta", "el informe de consultas" - and the Spanish sentence is written
 * around it rather than translated fragment by fragment, so the article and the
 * word order stay the translator's decision.
 *
 * See `./index.ts` for what is deliberately absent from this language and why.
 */
export const common: Messages = {
  'common.tryAgain': 'Reintentar',
  'common.requestId': 'Identificador de la solicitud',
  'common.loading': 'Cargando {subject}',

  'common.notRecorded': 'No registrado',

  // The unit abbreviations are CLDR's own short forms for Spanish, taken from
  // `Intl.NumberFormat(locale, { style: 'unit', unitDisplay: 'short' })` rather
  // than picked by whoever wrote this file. A developer with a dictionary
  // guessing at a clinical abbreviation is the failure this catalogue is
  // organised to avoid, and CLDR is the one source here that is not a guess.
  'common.age.days': '{count} d',
  'common.age.months': '{count} m.',
  'common.age.years': '{count} a',

  'common.elapsed.justNow': 'ahora mismo',
  'common.elapsed.minutes': '{count} min',
  'common.elapsed.hours': '{count} h',
  'common.elapsed.hoursMinutes': '{count} h {minutes} min',
  'common.elapsed.days': '{count} d',

  'common.error.network.title': 'Sin conexión con el servidor',
  'common.error.network.message':
    'openrunic no pudo comunicarse con el servidor, así que {subject} no se cargó. Revise la conexión y vuelva a intentarlo.',
  'common.error.session.title': 'Su sesión terminó',
  'common.error.session.message':
    'Inicie sesión de nuevo para continuar. No se perdió nada de lo que escribió.',
  'common.error.forbidden.title': 'Su rol no puede abrir esto',
  'common.error.forbidden.message':
    'Su rol no incluye acceso a {subject}. Pídale a un administrador de la consulta que se lo otorgue.',
  'common.error.notFound.title': 'No se encontró',
  'common.error.notFound.message':
    'openrunic no pudo encontrar {subject}. Es posible que se haya fusionado o eliminado. Revise el identificador y busque de nuevo.',
  'common.error.notBuilt.title': 'Todavía no está construido',
  'common.error.notBuilt.message':
    'Esta parte de openrunic todavía no está implementada, así que {subject} no tiene nada que mostrar.',
  'common.error.server.title': 'El servidor no pudo responder',
  'common.error.server.message':
    'El servidor falló al cargar {subject}. Vuelva a intentarlo; si sigue fallando, reporte el identificador de la solicitud que aparece abajo.',
  'common.error.refused.title': 'Esa solicitud fue rechazada',
  'common.error.refused.message': 'El servidor rechazó la solicitud de {subject}.',
  'common.error.unknown.title': 'Esto no se cargó',
  'common.error.unknown.message': 'openrunic no pudo cargar {subject}. Vuelva a intentarlo.',

  'common.dismiss': 'Descartar',
};
