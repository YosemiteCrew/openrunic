import type { Messages } from '../../catalogue.js';

/**
 * The rail and the palette, in Spanish. The keywords are the words a Spanish
 * speaker actually types, not transliterations of the English ones.
 *
 * See `./index.ts` for what is deliberately absent from this language and why.
 */
export const nav: Messages = {
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
};
