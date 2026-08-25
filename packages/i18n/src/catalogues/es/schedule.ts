import type { Messages } from '../../catalogue.js';

/**
 * The day view and the flow board. Operational: safe to translate.
 *
 * Nothing here names a diagnosis, a medication or a coded finding. These are
 * the words a front desk uses about the shape of its day - who is booked, who
 * has arrived, which room somebody is in - so they can be translated correctly
 * by anyone who speaks the language, which is the line `es/index.ts` draws.
 *
 * The visit type on an appointment is deliberately absent. It travels with the
 * booking as the practice's own catalogue entry and is written into the record,
 * so it is data the screen interpolates rather than copy this file owns.
 */
export const schedule: Messages = {
  'schedule.status.proposed': 'Propuesto',
  'schedule.status.pending': 'Pendiente',
  'schedule.status.booked': 'Reservado',
  /* A noun and not the conjugated "Llegó": this word is a flow board column
     heading standing beside "Admitido" and "En sala", and it is a badge under a
     patient's name, where a verb in the third person reads as a sentence that
     was cut off. It also agrees with nobody, which "Llegado" would have to. */
  'schedule.status.arrived': 'Llegada',
  'schedule.status.checkedIn': 'Admitido',
  'schedule.status.roomed': 'En sala',
  'schedule.status.inProgress': 'En consulta',
  'schedule.status.checkedOut': 'Salida registrada',
  'schedule.status.fulfilled': 'Completado',
  'schedule.status.cancelled': 'Cancelado',
  'schedule.status.noShow': 'No asistió',
  'schedule.status.enteredInError': 'Registrado por error',

  'schedule.status.inline.proposed': 'propuesto',
  'schedule.status.inline.pending': 'pendiente',
  'schedule.status.inline.booked': 'reservado',
  'schedule.status.inline.arrived': 'llegada',
  'schedule.status.inline.checkedIn': 'admitido',
  'schedule.status.inline.roomed': 'en sala',
  'schedule.status.inline.inProgress': 'en consulta',
  'schedule.status.inline.checkedOut': 'salida registrada',
  'schedule.status.inline.fulfilled': 'completado',
  'schedule.status.inline.cancelled': 'cancelado',
  'schedule.status.inline.noShow': 'no asistió',
  'schedule.status.inline.enteredInError': 'registrado por error',

  'schedule.action.addWalkIn': 'Agregar sin cita',
  'schedule.action.findAvailable': 'Buscar disponibilidad',
  'schedule.action.cancel': 'Cancelar',
  'schedule.provider.unassigned': 'Sin asignar',
  'schedule.visit.unassignedSlot': 'Espacio sin asignar',

  'schedule.filter.facility': 'Centro',
  'schedule.filter.provider': 'Profesional',
  'schedule.filter.allProviders': 'Todos los profesionales',
  'schedule.filter.room': 'Sala',
  'schedule.filter.allRooms': 'Todas las salas',

  'schedule.day.title': 'Agenda',
  'schedule.day.description':
    '{date}. El día de la clínica, por profesional, con el estado a la vista.',
  'schedule.day.descriptionAtFacility':
    '{date} en {facility}. El día de la clínica, por profesional, con el estado a la vista.',
  'schedule.day.subject': 'la agenda de hoy',
  'schedule.day.previousDay': 'Día anterior',
  'schedule.day.today': 'Hoy',
  'schedule.day.nextDay': 'Día siguiente',
  'schedule.day.empty.title': 'No hay citas este día',
  'schedule.day.empty.message':
    'No hay nada reservado para esta fecha. Busque un espacio libre para reservar la primera visita.',
  'schedule.day.blocked.title': 'No se puede reservar en este día',
  'schedule.day.blocked.noFacility':
    'No se encontró ningún centro activo para esta organización, y una reserva tiene que nombrar el centro donde ocurre. Agregue uno en Administración, Centros antes de reservar.',
  'schedule.day.blocked.noProvider':
    'No se encontró ningún profesional activo en {facility}, y una reserva tiene que nombrar al profesional con quien es. Agregue uno en Administración, Usuarios y roles antes de reservar.',

  'schedule.day.command.today': 'Ir a hoy',
  'schedule.day.command.today.keywords': 'ahora, día actual, restablecer fecha',
  'schedule.day.command.previousDay': 'Ir al día anterior',
  'schedule.day.command.nextDay': 'Ir al día siguiente',
  'schedule.day.command.findAvailable': 'Buscar espacios libres',
  'schedule.day.command.findAvailable.keywords':
    'reservar, espacio libre, próxima disponibilidad, cita',
  'schedule.day.command.walkIn.keywords': 'sin cita, no programado, encajar',
  'schedule.day.command.checkIn.keywords': 'llegada, llegó, recepción',
  'schedule.day.command.checkInSelected': 'Registrar la llegada de la visita seleccionada',

  'schedule.grid.label': 'Cuadrícula de la vista diaria',
  'schedule.grid.timeColumn': 'Hora',
  'schedule.grid.timeRange': 'De {start} a {end}',
  'schedule.grid.doubleBooked': 'Doble reserva',
  'schedule.grid.now': 'Ahora {time}',

  'schedule.dayRail.overline': 'Hoy',
  'schedule.dayRail.title': 'El día de un vistazo',
  'schedule.dayRail.counter.booked': 'Reservadas',
  'schedule.dayRail.counter.inTheBuilding': 'En el centro',
  'schedule.dayRail.counter.checkedOut': 'Con salida registrada',
  /* Counters, so plural nouns beside a number: "No asistió 3" reads as a
     sentence with a stray digit, "Inasistencias 3" reads as a count. */
  'schedule.dayRail.counter.noShow': 'Inasistencias',
  'schedule.dayRail.counter.cancelled': 'Canceladas',
  'schedule.dayRail.selectedOverline': 'Visita seleccionada',
  'schedule.dayRail.noVisitSelected': 'Ninguna visita seleccionada',
  'schedule.dayRail.selectPrompt':
    'Seleccione una visita en la cuadrícula para registrar la llegada del paciente, abrir su historial o verificar la cobertura.',
  'schedule.dayRail.openChart': 'Abrir historial',
  'schedule.dayRail.insurance': 'Seguro y elegibilidad',
  'schedule.dayRail.noRoomAssigned': 'Sin sala asignada',

  'schedule.checkIn.title': 'Registrar la llegada del paciente',
  'schedule.checkIn.describe':
    'Registrar la llegada de {name} para su cita de las {time}, {visitType}. Esto lo pasa al Panel de flujo.',
  'schedule.checkIn.describeUnassigned':
    'Registrar la llegada de esta visita. Esto la pasa al Panel de flujo.',
  'schedule.checkIn.named': 'Registrar la llegada de {name}',
  'schedule.checkIn.generic': 'Registrar llegada',
  'schedule.checkIn.visit': 'Registrar la llegada de la visita',
  'schedule.checkIn.already': 'Llegada ya registrada',
  'schedule.checkIn.submitting': 'Registrando la llegada...',
  'schedule.checkIn.toast.title': 'Llegada registrada',
  'schedule.checkIn.toast.message': '{name} está en el Panel de flujo.',
  'schedule.checkIn.toast.messageUnassigned': 'La visita está en el Panel de flujo.',
  'schedule.checkIn.toast.openFlowBoard': 'Abrir el Panel de flujo',

  'schedule.booking.title': 'Reservar cita',
  'schedule.booking.description':
    'De {start} a {end} con {provider}. La reserva aparta el espacio de inmediato.',
  'schedule.booking.patient': 'Paciente',
  'schedule.booking.visitType': 'Tipo de visita',
  'schedule.booking.visitTypeHint': 'Determina la duración del espacio.',
  'schedule.booking.reason': 'Motivo de la visita',
  'schedule.booking.reasonHint': 'Opcional. Una línea que el profesional lee antes de entrar.',
  'schedule.booking.submitNamed': 'Reservar para {name}',
  'schedule.booking.submitting': 'Reservando...',
  'schedule.booking.toast.title': 'Cita reservada',
  'schedule.booking.toast.message': '{name} tiene cita a las {time} para {visitType}.',
  'schedule.booking.toast.messageUnassigned':
    'El paciente tiene cita a las {time} para {visitType}.',

  'schedule.findAvailable.overline': 'Buscar disponibilidad',
  'schedule.findAvailable.title': 'Próximos espacios libres de {minutes} minutos',
  'schedule.findAvailable.hide': 'Ocultar los espacios libres',
  'schedule.findAvailable.none':
    'Ningún espacio de {minutes} minutos entra en este día. Agregue al paciente a la lista de espera o revise mañana con el paginador de días.',
  'schedule.findAvailable.book': 'Reservar las {time} con {provider}',

  'schedule.flowBoard.title': 'Panel de flujo',
  'schedule.flowBoard.description':
    'Dónde está cada paciente en este momento y cuánto tiempo lleva ahí.',
  'schedule.flowBoard.subject': 'el panel de flujo',
  'schedule.flowBoard.lastRead': 'Última lectura a las',
  'schedule.flowBoard.backToSchedule': 'Volver a la agenda',
  'schedule.flowBoard.goToSchedule': 'Ir a la agenda',
  'schedule.flowBoard.filtersOverline': 'Filtros',
  'schedule.flowBoard.filtersTitle': 'Acotar el panel',
  'schedule.flowBoard.delayedOnly': 'Solo pacientes demorados',
  'schedule.flowBoard.delayedOnlyHint':
    'Esperando 15 minutos o más en un estado previo a la consulta.',
  'schedule.flowBoard.columnLabelOne': '{column}, {count} paciente',
  'schedule.flowBoard.columnLabelOther': '{column}, {count} pacientes',
  'schedule.flowBoard.columnEmpty': 'Nadie aquí en este momento.',
  'schedule.flowBoard.empty.title': 'Todavía no hay pacientes en el panel',
  'schedule.flowBoard.empty.message':
    'Los pacientes aparecen aquí en cuanto se registra su llegada. Registre la primera llegada desde la agenda.',
  'schedule.flowBoard.undo': 'Deshacer',
  'schedule.flowBoard.refused': 'Ese movimiento fue rechazado',
  /* "del estado {from} al estado {to}" and not "de {from} a {to}": two of the
     states this sentence names are themselves prepositional phrases, "en sala"
     and "en consulta", so the shorter frame produces "pasó de en sala a en
     consulta". The noun carries the preposition and every state then reads
     after it. */
  'schedule.flowBoard.moved': '{name} pasó del estado {from} al estado {to}.',
  'schedule.flowBoard.movedUnassigned': 'Esta visita pasó del estado {from} al estado {to}.',
  'schedule.flowBoard.movedBack': 'Se volvió al estado {status}.',
  'schedule.flowBoard.roomAssigned': 'Sala asignada',
  'schedule.flowBoard.roomMessage': '{name} está en {room}.',
  'schedule.flowBoard.roomMessageUnassigned': 'Esta visita está en {room}.',
  'schedule.flowBoard.roomUndoMessage': '{name} volvió a {room}.',
  'schedule.flowBoard.roomUndoMessageUnassigned': 'Esta visita volvió a {room}.',
  'schedule.flowBoard.command.showAll': 'Mostrar a todos los pacientes del panel',
  'schedule.flowBoard.command.showDelayed': 'Mostrar solo a los pacientes demorados',
  'schedule.flowBoard.command.delayed.keywords': 'demora, espera, tarde, filtro',
  'schedule.flowBoard.command.clearFilters': 'Limpiar los filtros del panel',
  'schedule.flowBoard.command.clearFilters.keywords':
    'restablecer, todos los profesionales, todas las salas',
  'schedule.flowBoard.command.refresh': 'Volver a leer el panel',
  'schedule.flowBoard.command.refresh.keywords': 'actualizar, sincronizar, recargar',

  'schedule.flowCard.unassignedVisit': 'Visita sin asignar',
  'schedule.flowCard.waiting': 'Esperando {elapsed}',
  'schedule.flowCard.delayed': 'Demorado {elapsed}',
  'schedule.flowCard.noRoom': 'Sin sala',
  'schedule.flowCard.inThisStatus': 'En este estado',
  'schedule.flowCard.inTheBuilding': 'En el centro',
  'schedule.flowCard.roomFor': 'Sala para {name}',
  'schedule.flowCard.assignRoom': 'Asignar una sala',
  /* Same reason as the board's toast, plus one of its own: "Pasar a {name} a
     {status}" puts two unrelated `a` in one short label even when the state is
     a single word. */
  'schedule.flowCard.advance': 'Cambiar a {name} al estado {status}',
  'schedule.flowCard.advanceUnassigned': 'Cambiar esta visita al estado {status}',
  'schedule.flowCard.complete': 'Visita finalizada',

  /* ------------------------------------------------------- the browser tab */
  'schedule.page.title': 'Agenda',
  'schedule.flowBoard.page.title': 'Panel de flujo',
};
