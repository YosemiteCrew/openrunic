import type { Messages } from '../../catalogue.js';

/**
 * The worklist. Operational.
 *
 * The five stream names, the SLA phrases, the verb each stream's row offers and
 * the words around a row: how work is queued, when it is due and what finishes
 * it. What an item itself carries - its summary and its detail, which are a
 * task's title and description as somebody typed them - arrives from the API
 * and is left in whatever language the deployment wrote it in.
 */
export const inbox: Messages = {
  'inbox.title': 'Bandeja de entrada',
  'inbox.description': 'Resultados, mensajes, recetas y cofirmas, en una sola cola tipificada.',
  'inbox.subject': 'la bandeja de entrada',

  'inbox.stream.results': 'Resultados',
  'inbox.stream.messages': 'Mensajes',
  'inbox.stream.refills': 'Recetas',
  'inbox.stream.cosign': 'Cofirmas',
  'inbox.stream.tasks': 'Tareas',

  'inbox.stream.inline.results': 'resultados',
  'inbox.stream.inline.messages': 'mensajes',
  'inbox.stream.inline.refills': 'recetas',
  'inbox.stream.inline.cosign': 'cofirmas',
  'inbox.stream.inline.tasks': 'tareas',

  'inbox.streamTitle': 'Flujo de {stream}',

  'inbox.filter.label': 'Filtrar por flujo',
  'inbox.filter.everything': 'Todo',
  'inbox.filter.mine': 'Míos',
  'inbox.filter.teamPool': 'Grupo del equipo',
  'inbox.filter.assignment': 'Asignación',

  'inbox.sla.overdue': 'Vencido hace {elapsed}',
  'inbox.sla.dueSoon': 'Vence en {elapsed}',
  'inbox.sla.onTime': 'Vence {when}',

  'inbox.sla.inline.overdue': 'vencido hace {elapsed}',
  'inbox.sla.inline.dueSoon': 'vence en {elapsed}',
  'inbox.sla.inline.onTime': 'vence {when}',

  'inbox.rail.overline': 'Hoy',
  'inbox.rail.openItemsOne': '{count} elemento abierto',
  'inbox.rail.openItemsOther': '{count} elementos abiertos',
  'inbox.rail.overdueSummaryOne':
    '{count} pasó su hora de vencimiento. El más antiguo está {oldest}.',
  'inbox.rail.overdueSummaryOther':
    '{count} pasaron su hora de vencimiento. El más antiguo está {oldest}.',
  'inbox.rail.windowOne':
    '{count} de {total} elementos. El resto está en páginas que esta pantalla no alcanza.',
  'inbox.rail.windowOther':
    '{count} de {total} elementos. El resto está en páginas que esta pantalla no alcanza.',
  'inbox.rail.notShownOne':
    '{count} de los elementos de esta página no aparece, porque pertenece a una bandeja administrativa y no a esta.',
  'inbox.rail.notShownOther':
    '{count} de los elementos de esta página no aparecen, porque pertenecen a una bandeja administrativa y no a esta.',
  'inbox.rail.nothingOverdue':
    'No hay nada vencido. El elemento más antiguo sigue dentro de su plazo.',
  'inbox.rail.auditNote':
    'Cada acción aquí queda auditada, y una aprobación se puede deshacer desde el aviso mientras siga en pantalla.',

  'inbox.stream.action.results': 'Revisar resultado',
  'inbox.stream.action.messages': 'Responder',
  'inbox.stream.action.refills': 'Aprobar receta',
  'inbox.stream.action.cosign': 'Cofirmar nota',
  'inbox.stream.action.tasks': 'Marcar como hecha',

  'inbox.stream.done.results': 'Resultado abierto',
  'inbox.stream.done.messages': 'Respuesta enviada',
  'inbox.stream.done.refills': 'Receta aprobada',
  'inbox.stream.done.cosign': 'Nota cofirmada',
  'inbox.stream.done.tasks': 'Tarea cerrada',

  'inbox.list.label': 'Elementos de la bandeja de entrada',
  'inbox.list.practiceWide': 'De toda la clínica',
  'inbox.list.unnamedPatient': 'Ficha de paciente',
  'inbox.list.received': 'Recibido {when}',
  'inbox.list.unread': 'Sin leer',
  'inbox.list.assignToMe': 'Asignármelo',
  'inbox.list.open': 'Abrir',
  'inbox.list.assigned': 'Asignado a usted',
  'inbox.list.undo': 'Deshacer',

  'inbox.empty.streamTitle': 'No hay {stream} en espera',
  'inbox.empty.streamMessage':
    'Nada en este flujo lo necesita. Quite el filtro para ver el resto de la cola.',
  'inbox.empty.allTitle': 'Bandeja vacía, por ahora',
  'inbox.empty.allMessage':
    'Los nuevos resultados, mensajes, recetas y cofirmas llegan aquí a medida que aparecen.',
  'inbox.empty.goToSchedule': 'Ir a la agenda',

  'inbox.command.showStream': 'Mostrar {stream} en la bandeja de entrada',
  'inbox.command.showStream.keywords': 'filtrar bandeja',
  'inbox.command.showAll': 'Mostrar todos los flujos de la bandeja',
  'inbox.command.showAll.keywords': 'quitar filtro',
  'inbox.command.mine': 'Mostrar solo mis elementos',
  'inbox.command.mine.keywords': 'asignados a mí',
  'inbox.command.team': 'Mostrar el grupo del equipo',
  'inbox.command.team.keywords': 'cola compartida, sin asignar',

  /* ------------------------------------------------------- the browser tab */
  'inbox.page.title': 'Bandeja de entrada',
};
