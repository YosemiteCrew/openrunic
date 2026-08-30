import type { Messages } from '../../catalogue.js';

/**
 * The connection notices, in Spanish. Plain statements about the state of the
 * system, which anyone who speaks the language can translate correctly.
 *
 * See `./index.ts` for what is deliberately absent from this language and why.
 */
export const downtime: Messages = {
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
};
