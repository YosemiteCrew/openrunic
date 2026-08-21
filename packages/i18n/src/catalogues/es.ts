import type { Messages } from '../catalogue.js';

/**
 * SPANISH.
 *
 * Deliberately not complete, and the gap is the point rather than a backlog
 * nobody got to.
 *
 * What is translated here is the shell, the connection notices, sign-in and the
 * public pages: navigation, plain statements about the state of the system, and
 * marketing copy. Those can be translated correctly by anyone who speaks the
 * language.
 *
 * What is NOT translated here is anything clinical. A wrong clinical term is
 * more dangerous than English text a reader has to work through: `lookup` falls
 * back to the source language and says it fell back, so an untranslated
 * medication label reads as obviously English rather than as confidently wrong
 * Spanish. Those strings need a Spanish-speaking clinician, not a developer with
 * a dictionary, and the coverage report names exactly which ones are waiting.
 */
export const es: Messages = {
  'shell.skipToContent': 'Saltar al contenido',
  'shell.mainNavigation': 'Navegación principal',
  'shell.breadcrumb': 'Ruta de navegación',
  'shell.signOut': 'Cerrar sesión',
  'shell.signedInAs': 'Sesión iniciada como {name}',
  'shell.commandPalette': 'Buscar o ejecutar un comando',
  'shell.pageContext': 'Contexto de la página',

  'nav.schedule': 'Agenda',
  'nav.schedule.keywords': 'calendario, vista diaria, citas, reservar, recepción',
  'nav.flowBoard': 'Panel de flujo',
  'nav.flowBoard.keywords': 'flujo, panel, espera, salas, admisión, llegado, tiempo de espera',
  'nav.patients': 'Pacientes',
  'nav.patients.keywords': 'historial, registrar, buscar, datos, expediente',
  'nav.inbox': 'Bandeja de entrada',
  'nav.inbox.keywords': 'tareas, mensajes, recetas, cofirma, lista de trabajo',
  'nav.orders': 'Órdenes',
  'nav.orders.keywords': 'laboratorio, imagen, recetas, solicitud',
  'nav.billing': 'Facturación',
  'nav.billing.keywords': 'cargos, reclamaciones, pagos, antigüedad',
  'nav.reports': 'Informes',
  'nav.reports.keywords': 'panel, indicadores, exportaciones, análisis',
  'nav.admin': 'Administración',
  'nav.admin.keywords': 'usuarios, roles, centros, formularios, ajustes, auditoría',
  'nav.results': 'Resultados',
  'nav.results.keywords': 'laboratorio, revisión, anormal, pendiente',
  'nav.newPatient': 'Nuevo paciente',
  'nav.newPatient.keywords': 'registrar, alta, sin cita, añadir paciente',
  'nav.newOrder': 'Nueva orden',
  'nav.newOrder.keywords': 'pedir laboratorio, pedir imagen, solicitud, procedimiento',

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
  'auth.signIn.submit': 'Continuar',
  'auth.signIn.provider': 'Inicie sesión con la cuenta de su organización',
  'auth.signIn.failed': 'No se completó el inicio de sesión. Inténtelo de nuevo.',
  'auth.holding': 'Comprobando su sesión',
  'auth.signedOut.title': 'Se ha cerrado su sesión',
  'auth.signedOut.body':
    'Esta estación de trabajo estuvo inactiva. Inicie sesión de nuevo para continuar.',

  'marketing.tagline': 'Sistema operativo de código abierto para la salud humana',
  'marketing.readTheCode': 'Lea el código',
  'marketing.licence': 'AGPL-3.0. Suyo para ejecutar, leer y modificar.',
};
