import type { Messages } from '../../catalogue.js';

/**
 * INFORMES.
 *
 * Contenido operativo: visitas, reclamaciones, dinero y notas sin firmar. Nada
 * de esto es terminología clínica, así que se traduce entero.
 *
 * Los `reports.subject.*` se insertan dentro de las frases de `common`, por eso
 * van en minúscula y sin punto final.
 */
export const reports: Messages = {
  'reports.title': 'Informes',
  'reports.description': 'Si la clínica está sana hoy, y los números detrás de la respuesta.',

  'reports.subject.dashboard': 'el panel de la clínica',
  'reports.subject.visits': 'el informe de visitas',

  'reports.action.export': 'Exportar el informe de visitas',
  'reports.action.exportCsv': 'Exportar CSV',
  'reports.command.export.keywords': 'csv, descargar, visitas, exportar',
  'reports.command.week.label': 'Informe de esta semana',
  'reports.command.week.keywords': 'rango de fechas, limpiar filtros, semana',

  'reports.dashboard.empty.title': 'Todavía no hay nada que informar',
  'reports.dashboard.empty.message':
    'El panel se llena a medida que la clínica trabaja: visitas reservadas, notas firmadas, reclamaciones enviadas. Reserve la primera cita y empieza aquí.',
  'reports.dashboard.empty.action': 'Ir a la agenda',
  'reports.dashboard.asOf': 'Al {when}. Cada número abre la mesa de trabajo que lo maneja.',

  'reports.tile.trend': 'Últimos 7 días, {trend}',
  'reports.tile.open': 'Abrir {label}',
  'reports.trend.rising': 'en aumento',
  'reports.trend.falling': 'en descenso',
  'reports.trend.steady': 'sin cambios',

  'reports.funnel.title': 'Reclamaciones, de la captura al pago',
  'reports.funnel.lede':
    'Conteos de este mes. El hueco entre dos etapas es donde se queda esperando el dinero.',
  'reports.funnel.meterLabel': 'Embudo de reclamaciones por etapa',
  'reports.funnel.claimCount': '{count} reclamaciones',
  'reports.funnel.needsBiller': 'Necesita a alguien de facturación',
  'reports.funnel.link': 'Abrir la mesa de reclamaciones',

  'reports.aging.title': 'Cuentas por cobrar por antigüedad',
  'reports.aging.lede':
    'Responsabilidad del pagador y del paciente, por separado. Más de 90 días es el número a vigilar.',
  'reports.aging.meterLabel': 'Cuentas por cobrar por antigüedad',
  'reports.aging.split': 'Pagador {payer}, paciente {patient}',
  'reports.aging.link': 'Abrir cobranza',

  'reports.unsigned.title': 'Notas sin firmar por profesional',
  'reports.unsigned.caption': 'Notas sin firmar por profesional',
  'reports.unsigned.days': '{days} días',
  'reports.unsigned.late': 'Pasó la meta de 48 horas',
  'reports.unsigned.onTarget': 'Dentro de la meta',

  'reports.visits.title': 'Visitas',
  'reports.visits.description':
    'Cada visita del rango con su duración, sus cargos y el estado de su reclamación. El mismo armazón sostiene todos los demás informes de openrunic; solo cambian los filtros y las columnas.',
  'reports.visits.caption': 'Visitas del {from} al {to}',
  'reports.visits.empty.title': 'Ninguna visita coincide con estos filtros',
  'reports.visits.empty.message':
    'No ocurrió nada en este rango para el profesional y el estado elegidos. Amplíe las fechas, o quite el profesional para ver toda la clínica.',
  'reports.visits.empty.action': 'Volver a esta semana',

  'reports.filter.label': 'Filtrar el informe de visitas',
  'reports.filter.summary': '{visits} visitas, {minutes} minutos, {charges}',
  'reports.filter.from': 'Desde',
  'reports.filter.to': 'Hasta',
  'reports.filter.provider': 'Profesional',
  'reports.filter.status': 'Estado',
  'reports.filter.allProviders': 'Todos los profesionales',
  'reports.filter.allStatuses': 'Todos los estados',

  'reports.column.date': 'Fecha',
  'reports.column.time': 'Hora',
  'reports.column.patient': 'Paciente',
  'reports.column.mrn': 'Expediente',
  'reports.column.provider': 'Profesional',
  'reports.column.facility': 'Centro',
  'reports.column.visitType': 'Tipo de visita',
  'reports.column.status': 'Estado',
  'reports.column.minutes': 'Minutos',
  'reports.column.charges': 'Cargos',
  'reports.column.claim': 'Reclamación',
  'reports.column.claimState': 'Estado de la reclamación',
  'reports.column.unsigned': 'Sin firmar',
  'reports.column.oldest': 'Más antigua',
  'reports.column.state': 'Situación',

  'reports.totals.visits': 'Visitas',
  'reports.totals.minutes': 'Minutos',
  'reports.totals.charges': 'Cargos',

  'reports.export.done': 'Se exportaron {count} visitas del {from} al {to}.',
  'reports.export.unsupported':
    'Este navegador no puede descargar archivos. Copie la tabla en su lugar.',
};
