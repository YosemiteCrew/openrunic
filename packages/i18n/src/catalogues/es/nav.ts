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
  /* ---------------------------------------------------- billing and admin
     These are the rail's children for two areas whose screens are already
     Spanish, so the labels are the ones those screens use rather than a second
     translation of the same word: a link that reads "Claim workbench" onto a
     page headed "Mesa de reclamaciones" is worse than either language alone.
     The billing labels come from `billing.*.title`, the admin ones from
     `admin.areas.*.label`. */
  'nav.feeSheet': 'Hoja de cargos',
  'nav.feeSheet.keywords': 'cargos, captura de cargos, superbill, cpt, justificar, diagnóstico',
  'nav.claimWorkbench': 'Mesa de reclamaciones',
  'nav.claimWorkbench.keywords': 'reclamaciones, depurar, enviar, denegada, antigüedad, 837',
  'nav.remittance': 'Remesas',
  'nav.remittance.keywords': 'era, 835, eob, contabilización automática, contabilizar, excepciones',
  'nav.statements': 'Estados de cuenta y cobros',
  'nav.statements.keywords':
    'estados de cuenta, saldos, antigüedad, cobros, avisos, pago por mensaje',
  'nav.payments': 'Pagos',
  'nav.payments.keywords': 'pago, copago, cobrar, recibo, tarjeta guardada, asignación',
  'nav.usersAndRoles': 'Usuarios y roles',
  'nav.usersAndRoles.keywords': 'personal, cuentas, permisos, acl, invitar, mfa, desactivar',
  'nav.facilities': 'Sedes',
  'nav.facilities.keywords': 'ubicaciones, sedes, código pos, horarios, salas, npi',
  'nav.formBuilder': 'Constructor de formularios',
  'nav.formBuilder.keywords': 'formularios, diseño, lbf, admisión, cuestionario, campos, publicar',
  'nav.auditTrail': 'Pista de auditoría',
  'nav.auditTrail.keywords':
    'auditoría, registro de acceso, phi, acceso de emergencia, cumplimiento, exportar',
  'nav.integrations': 'Integraciones',
  'nav.integrations.keywords':
    'adaptadores, recetas electrónicas, cámara de compensación, laboratorios, pagos, fax, conexiones',
  'nav.developerPlatform': 'Plataforma para desarrolladores',
  'nav.developerPlatform.keywords': 'api, claves, smart, fhir, oauth, webhooks, suscripciones',
};
