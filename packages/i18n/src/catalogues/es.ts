import type { Messages } from '../catalogue.js';

import { common } from './es/common.js';
import { marketing } from './es/marketing.js';
import { nav } from './es/nav.js';
import { reports } from './es/reports.js';
import { shell } from './es/shell.js';

/**
 * SPANISH.
 *
 * Deliberately not complete, and the gap is the point rather than a backlog
 * nobody got to.
 *
 * What is translated here is the shell, the navigation, the shared error
 * sentences, the reports area, the connection notices, sign-in and the public
 * pages: furniture, plain statements about the state of the system, operational
 * counting, and marketing copy. Those can be translated correctly by anyone who
 * speaks the language.
 *
 * What is NOT translated here is anything clinical. A wrong clinical term is
 * more dangerous than English text a reader has to work through: `lookup` falls
 * back to the source language and says it fell back, so an untranslated
 * medication label reads as obviously English rather than as confidently wrong
 * Spanish. Those strings need a Spanish-speaking clinician, not a developer with
 * a dictionary, and the coverage report names exactly which ones are waiting.
 *
 * The areas large enough to review on their own live in `es/`, one file per
 * first segment, mirroring `en/`. The rest are in place below.
 */
export const es: Messages = {
  ...shell,
  ...nav,
  ...common,
  ...reports,
  ...marketing,

  'downtime.online.title': 'Conectado',
  'downtime.online.detail': 'openrunic funciona con normalidad.',
  'downtime.degraded.title': 'Solo lectura: no se pueden guardar los registros',
  'downtime.degraded.detail':
    'La aplicación está funcionando pero no puede acceder a la base de datos de historiales. Lo que ya está en pantalla se puede seguir leyendo. Las notas, órdenes y cambios nuevos no se guardarán.',
  'downtime.degraded.action':
    'Siga trabajando en papel por ahora e introdúzcalo cuando desaparezca este mensaje. Avise a quien gestiona su servidor de que la base de datos no está accesible. Esta página vuelve a comprobarlo cada pocos segundos por su cuenta.',
  'downtime.offline.title': 'No se puede conectar con openrunic',
  'downtime.offline.detail':
    'Este ordenador no puede conectar con el servidor de openrunic. Normalmente significa que el servidor se está reiniciando o que este equipo ha perdido la conexión de red.',
  'downtime.offline.action':
    'Compruebe que este ordenador está en la red de la clínica. Si otros ordenadores muestran el mismo mensaje, el servidor está caído: avise a quien lo gestiona. Esta página sigue intentándolo por su cuenta; no la cierre.',
  'downtime.checkAgain': 'Comprobar de nuevo',

  'downtime.failed.title': 'No se pudo mostrar {area}',
  'downtime.failed.reassurance':
    'Algo falló al cargar esta página. No se ha modificado ni perdido ninguna información del paciente: todo lo que guardó antes está a salvo.',
  'downtime.failed.next':
    'Pruebe a recargar la página. Si vuelve a ocurrir, use otra pantalla por ahora y avise a quien gestiona su servidor, indicando la referencia siguiente.',
  'downtime.failed.reference': 'Referencia {reference}',
  'downtime.failed.thisScreen': 'esta pantalla',

  'auth.signIn.title': 'Iniciar sesión',
  'auth.signIn.lede':
    'Acceso para personal de openrunic. La sesión se cierra tras {minutes} minutos sin actividad, de modo que una estación de trabajo desatendida no queda abierta en un historial.',
  'auth.signIn.tokenLabel': 'Token de acceso',
  'auth.signIn.tokenHint': 'El token que le facilitó su instalación.',
  'auth.signIn.tokenRejected': 'No se reconoció ese token de acceso.',
  'auth.signIn.submit': 'Iniciar sesión',
  'auth.signIn.submitting': 'Iniciando sesión',
  'auth.signIn.provider': 'Inicie sesión con su organización',
  'auth.signIn.developmentHeading': 'Inicio de sesión de desarrollo',
  'auth.signIn.unavailable.title': 'No se pudo contactar con el servicio de inicio de sesión.',
  'auth.signIn.unavailable.body':
    'Compruebe que la aplicación sigue funcionando e inténtelo de nuevo.',
  'auth.signedOut.idle.title': 'Se cerró su sesión tras {minutes} minutos sin actividad.',
  'auth.signedOut.idle.body': 'Inicie sesión de nuevo para continuar donde lo dejó.',
  'auth.signedOut.expired.title': 'Su sesión ha terminado.',
  'auth.signedOut.expired.body': 'Inicie sesión de nuevo para continuar.',
  'auth.holding': 'Restaurando su sesión',
};
