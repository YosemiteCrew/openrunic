import type { Messages } from '../../catalogue.js';

/**
 * NAVEGACION.
 *
 * The keywords are the words a Spanish-speaking receptionist types, not a
 * translation of the English ones. "flow" is not among them, and "admision" is.
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

  'nav.feeSheet': 'Hoja de cargos',
  'nav.feeSheet.keywords': 'cargos, captura de cargos, superbill, cpt, justificar, diagnóstico',
  'nav.claimWorkbench': 'Mesa de reclamaciones',
  'nav.claimWorkbench.keywords': 'reclamaciones, revisar, enviar, denegada, antigüedad, 837',
  'nav.remittance': 'Remesas',
  'nav.remittance.keywords': 'era, 835, explicación de pago, contabilizar, excepciones',
  'nav.statements': 'Estados de cuenta y cobros',
  'nav.statements.keywords': 'estados de cuenta, cobros, antigüedad, avisos, saldos',
  'nav.payments': 'Pagos',
  'nav.payments.keywords': 'pago, copago, cobrar, recibo, tarjeta guardada, asignación',
  'nav.usersAndRoles': 'Usuarios y roles',
  'nav.usersAndRoles.keywords': 'personal, cuentas, permisos, invitar, mfa, desactivar',
  'nav.facilities': 'Centros',
  'nav.facilities.keywords': 'ubicaciones, sedes, código de lugar, horarios, salas, npi',
  'nav.formBuilder': 'Constructor de formularios',
  'nav.formBuilder.keywords': 'formularios, diseño, admisión, cuestionario, campos, publicar',
  'nav.auditTrail': 'Registro de auditoría',
  'nav.auditTrail.keywords': 'auditoría, registro de accesos, phi, cumplimiento, exportar',
  'nav.integrations': 'Integraciones',
  'nav.integrations.keywords': 'adaptadores, receta electrónica, laboratorios, pagos, conexiones',
  'nav.developerPlatform': 'Plataforma para desarrolladores',
  'nav.developerPlatform.keywords': 'api, claves, smart, fhir, oauth, webhooks, suscripciones',
};
