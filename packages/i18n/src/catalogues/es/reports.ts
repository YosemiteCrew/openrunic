import type { Messages } from '../../catalogue.js';

/**
 * The dashboard. Operational.
 *
 * Safe to translate for the same reason the English file says it is: nothing
 * here names a code, a diagnosis or a medicine. The words that would be
 * clinical - a visit's type, a claim's state, the funnel stages - never reach
 * this file, because they arrive from the API already named.
 *
 * Latin American Spanish. "Informes" rather than "Reportes", and "facturación"
 * for the billing side, which is the wording the rest of this catalogue uses.
 *
 * See `./index.ts` for what is deliberately absent from this language and why.
 */
export const reports: Messages = {
  /* Los propios textos del panel. La etiqueta, el detalle y el estado llegan de
     la API ya nombrados y no se traducen aquí. */
  'reports.tile.open': 'Abrir {label}',
  'reports.tile.trend': 'Últimos {days} días, {trend}',

  'reports.trend.rising': 'en aumento',
  'reports.trend.falling': 'a la baja',
  'reports.trend.steady': 'sin cambios',

  'reports.title': 'Informes',
  'reports.description': '¿Está sana la consulta hoy? Y los números detrás de la respuesta.',

  'reports.dashboardSubject': 'el panel de la consulta',
  'reports.visitsSubject': 'el informe de consultas',

  'reports.export': 'Exportar el informe de consultas',
  'reports.export.keywords': 'csv, descargar, consultas, exportar',
  'reports.exportCsv': 'Exportar CSV',
  'reports.exported.one': 'Se exportó {count} consulta del {from} al {to}.',
  'reports.exported.other': 'Se exportaron {count} consultas del {from} al {to}.',
  'reports.exportUnsupported':
    'Este navegador no puede descargar archivos. Copie la tabla en su lugar.',
  'reports.thisWeek': 'Informe de esta semana',
  'reports.thisWeek.keywords': 'rango de fechas, limpiar filtros, restablecer',

  'reports.dashboard.empty.title': 'Todavía no hay nada que informar',
  'reports.dashboard.empty.message':
    'El panel se va llenando a medida que la consulta trabaja: citas agendadas, notas firmadas, reclamaciones enviadas. Agende la primera cita y empieza aquí.',
  'reports.dashboard.empty.action': 'Ir a la agenda',
  'reports.asOf': 'Al {when}. Cada número abre el módulo al que pertenece.',

  'reports.claims.title': 'Reclamaciones, del cargo al cobro',
  'reports.claims.lead':
    'Conteos de este mes. La diferencia entre dos etapas es donde se queda detenido el dinero.',
  'reports.claims.link': 'Abrir el módulo de reclamaciones',
  'reports.funnel.label': 'Embudo de reclamaciones por etapa',
  'reports.funnel.claims.one': '{count} reclamación',
  'reports.funnel.claims.other': '{count} reclamaciones',
  'reports.funnel.needsBiller': 'Requiere un facturador',

  'reports.aging.title': 'Cuentas por cobrar por antigüedad',
  'reports.aging.lead':
    'Responsabilidad del pagador y del paciente, por separado. Más de 90 días es el número a vigilar.',
  'reports.aging.split': 'Pagador {payer}, paciente {patient}',
  'reports.aging.link': 'Abrir cobranza',

  'reports.unsigned.title': 'Notas sin firmar por profesional',
  'reports.unsigned.column.provider': 'Profesional',
  'reports.unsigned.column.unsigned': 'Sin firmar',
  'reports.unsigned.column.oldest': 'Más antigua',
  'reports.unsigned.column.state': 'Estado',
  'reports.unsigned.days.one': '{count} día',
  'reports.unsigned.days.other': '{count} días',
  'reports.unsigned.late': 'Fuera del objetivo de 48 horas',
  'reports.unsigned.onTarget': 'Dentro del objetivo',

  'reports.visits.title': 'Consultas',
  'reports.visits.description':
    'Cada consulta del rango con su duración, sus cargos y el estado de su reclamación. La misma estructura sostiene todos los demás informes de openrunic; solo cambian los filtros y las columnas.',
  'reports.visits.filterLabel': 'Filtrar el informe de consultas',
  'reports.visits.summary': '{visits} consultas, {minutes} minutos, {charges}',
  'reports.visits.caption': 'Consultas del {from} al {to}',
  'reports.visits.empty.title': 'Ninguna consulta coincide con estos filtros',
  'reports.visits.empty.message':
    'No ocurrió nada en este rango para el profesional y el estado elegidos. Amplíe las fechas, o borre el profesional para ver toda la consulta.',
  'reports.visits.empty.action': 'Volver a esta semana',

  'reports.filter.from': 'Desde',
  'reports.filter.to': 'Hasta',
  'reports.filter.provider': 'Profesional',
  'reports.filter.status': 'Estado',
  'reports.filter.allProviders': 'Todos los profesionales',
  'reports.filter.allStatuses': 'Todos los estados',

  'reports.status.fulfilled': 'Completada',
  'reports.status.checkedOut': 'Dada de alta',
  'reports.status.inProgress': 'En curso',
  'reports.status.roomed': 'En consultorio',
  'reports.status.checkedIn': 'Registrada',
  'reports.status.noShow': 'No se presentó',

  'reports.visits.column.date': 'Fecha',
  'reports.visits.column.patient': 'Paciente',
  'reports.visits.column.provider': 'Profesional',
  'reports.visits.column.visitType': 'Tipo de consulta',
  'reports.visits.column.status': 'Estado',
  'reports.visits.column.duration': 'Minutos',
  'reports.visits.column.charge': 'Cargos',
  'reports.visits.column.claim': 'Reclamación',

  'reports.totals.visits': 'Consultas',
  'reports.totals.minutes': 'Minutos',
  'reports.totals.charges': 'Cargos',

  'reports.csv.date': 'Fecha',
  'reports.csv.time': 'Hora',
  'reports.csv.patient': 'Paciente',
  'reports.csv.mrn': 'Expediente',
  'reports.csv.provider': 'Profesional',
  'reports.csv.facility': 'Centro',
  'reports.csv.visitType': 'Tipo de consulta',
  'reports.csv.status': 'Estado',
  'reports.csv.minutes': 'Minutos',
  'reports.csv.charges': 'Cargos',
  'reports.csv.claimState': 'Estado de la reclamación',

  /* ------------------------------------------------------- the browser tab */
  'reports.page.title': 'Informes',
};
