import type { Messages } from '../../catalogue.js';

/**
 * El portal del paciente.
 *
 * Traducido, a diferencia de las áreas clínicas: quien lee esto es el paciente,
 * y no se puede dar por supuesto que pueda leer inglés para consultar su propio
 * historial. Lo que no se traduce es lo que ya llega con nombre - el analito que
 * envía el laboratorio, el nombre que la aseguradora se da a sí misma.
 */
export const portal: Messages = {
  'portal.duration.minutes': '{count} minutos',
  'portal.duration.minute': '{count} minuto',
  'portal.duration.hours': '{count} horas',
  'portal.duration.hour': '{count} hora',
  'portal.duration.hoursAndMinutes': '{hours} y {minutes}',

  'portal.dateTime': '{date} a las {time}',

  'portal.progress': '{done} de {total} respondidas',

  'portal.home.unread.one': 'Tiene {count} mensaje sin leer.',
  'portal.home.unread.other': 'Tiene {count} mensajes sin leer.',

  'portal.skipToContent': 'Saltar al contenido',
  'portal.eyebrow': 'Portal del paciente',
  'portal.recordNumber': 'Número de historia {mrn}',
  'portal.navLabel': 'Secciones del portal',
  'portal.nav.home': 'Inicio',
  'portal.nav.healthRecord': 'Historial',
  'portal.nav.messages': 'Mensajes',
  'portal.nav.appointments': 'Citas',
  'portal.nav.forms': 'Formularios',
  'portal.nav.bills': 'Facturas',
  'portal.nav.assistant': 'Asistente',
  'portal.footer.whatThisIs':
    'Este portal muestra el historial que guarda su equipo asistencial. Si algo parece incorrecto, escríbales y pida que lo revisen.',
  'portal.footer.emergency':
    'Si se trata de una urgencia médica, llame a los servicios de emergencia de su zona.',

  'portal.home.overline': 'Su atención',
  'portal.home.title': 'Inicio',
  'portal.home.lede':
    'Lo que necesita su atención hoy. Todo lo demás está en las secciones alrededor de esta página.',
  'portal.home.empty.title': 'No hay nada que necesite su atención.',
  'portal.home.empty.message':
    'Sus citas, su historial, sus mensajes y sus facturas siguen aquí cuando los quiera.',
  'portal.home.balance.overline': 'Saldo',
  'portal.home.balance.title': 'Lo que debe',
  'portal.home.balance.nothing': 'No hay nada que pagar.',
  'portal.home.balance.dueUnknown':
    'Pregunte a la consulta cuándo vence. Puede pagar en línea, o preguntar a la consulta por el pago a plazos.',
  'portal.home.balance.dueBy':
    'Vence el {date}. Puede pagar en línea, o preguntar a la consulta por el pago a plazos.',
  'portal.home.balance.seeBills': 'Ver sus facturas',
  'portal.home.balance.pay': 'Pagar una factura',
  'portal.home.messages.overline': 'Mensajes',
  'portal.home.messages.title': 'De su equipo asistencial',
  'portal.home.messages.open': 'Abrir los mensajes',
  'portal.home.actions.overline': 'Requiere acción',
  'portal.home.actions.title': 'Cosas que solo puede hacer usted',
  'portal.home.actions.none': 'No hay nada pendiente de usted.',
  'portal.home.actions.badge': 'Pendiente',
  'portal.home.appointment.overline': 'Próxima cita',
  'portal.home.appointment.none': 'No tiene ninguna cita reservada',
  'portal.home.appointment.noneMessage':
    'Pida una hora a la consulta y se la confirmarán por mensaje.',
  'portal.home.appointment.request': 'Pedir una cita',
  'portal.home.appointment.videoLocation': 'Una videollamada. El enlace se abre en este navegador.',
  'portal.home.page.title': 'Inicio',
  'portal.home.page.description':
    'Su próxima cita, su saldo, sus mensajes y todo lo que está pendiente de usted.',
  'portal.app.title': 'Portal del paciente',
  'portal.app.titleTemplate': '{page} - portal del paciente',
  'portal.app.description':
    'Consulte sus citas, su historia clínica, sus mensajes, sus formularios y sus facturas.',
  'portal.appointments.page.title': 'Citas',
  'portal.appointments.page.description':
    'Sus citas próximas y pasadas, y cómo pedir, cambiar o anular una.',
  'portal.bills.page.title': 'Facturas',
  'portal.bills.page.description': 'Sus facturas, el motivo de cada cargo y cómo pagarlas.',
  'portal.forms.page.title': 'Formularios',
  'portal.forms.page.description':
    'Cuestionarios para rellenar antes de sus citas. Guarde a medida que avanza y termine más tarde.',
  'portal.healthRecord.page.title': 'Historia clínica',
  'portal.healthRecord.page.description':
    'Sus resultados, sus diagnósticos, sus medicamentos, sus alergias, sus vacunas y sus documentos, cada uno con una explicación en lenguaje claro.',
  'portal.messages.page.title': 'Mensajes',
  'portal.messages.page.description': 'Lea lo que ha escrito su equipo asistencial y respóndales.',
  'portal.assistant.page.title': 'Asistente',
  'portal.assistant.page.description':
    'Pregunte por lo que ha anotado su equipo asistencial y vea los registros de los que sale cada respuesta.',
  'portal.async.error.message':
    'Compruebe su conexión y vuelva a intentarlo. Si sigue fallando, escriba a su equipo asistencial.',
  'portal.async.retry': 'Volver a intentarlo',
  'portal.home.async.loading': 'Cargando su resumen.',
  'portal.home.async.error': 'Su resumen no se ha cargado.',
  'portal.appointments.async.loading': 'Cargando sus citas.',
  'portal.appointments.async.error': 'Sus citas no se han cargado.',
  'portal.healthRecord.async.loading': 'Cargando su historia clínica.',
  'portal.healthRecord.async.error': 'Su historia clínica no se ha cargado.',
  'portal.messages.async.loading': 'Cargando sus mensajes.',
  'portal.messages.async.error': 'Sus mensajes no se han cargado.',
  'portal.forms.async.loading': 'Cargando sus formularios.',
  'portal.forms.async.error': 'Sus formularios no se han cargado.',
  'portal.bills.async.loading': 'Cargando sus facturas.',
  'portal.bills.async.error': 'Sus facturas no se han cargado.',
  'portal.assistant.async.loading': 'Cargando su historia clínica.',
  'portal.assistant.async.error': 'Su historia clínica no se ha cargado.',
  'portal.money.credit': 'a su favor',
  'portal.appointment.when': 'Cuándo',
  'portal.appointment.whenValue': '{dateTime}, {duration}',
  'portal.appointment.whoWith': 'Con quién',
  'portal.appointment.whoWithValue': '{clinician}, {department}',
  'portal.appointment.where': 'Dónde',
  'portal.appointment.videoDefault': 'Una videollamada',
  'portal.appointment.roomUnconfirmed': 'La consulta le confirmará la sala.',
  'portal.appointments.overline': 'Sus visitas',
  'portal.appointments.title': 'Citas',
  'portal.appointments.lede': 'Lo que tiene reservado, lo que ya ha pasado y cómo pedir un cambio.',
  'portal.appointments.request': 'Pedir una cita',
  'portal.appointments.requested':
    'Su solicitud ha llegado a la consulta. Se lo confirmarán por mensaje. No hay nada reservado hasta que lo hagan.',
  'portal.appointments.cancelFailed':
    'La cita no se ha anulado y sigue reservada. Compruebe su conexión y vuelva a intentarlo.',
  'portal.appointments.empty.title': 'No tiene ninguna cita.',
  'portal.appointments.empty.message': 'Pida una y la consulta le confirmará una hora por mensaje.',
  'portal.appointments.upcoming.label': 'Próximas citas',
  'portal.appointments.upcoming.heading': 'Próximas',
  'portal.appointments.upcoming.none': 'No tiene nada reservado.',
  'portal.appointments.past.label': 'Citas pasadas',
  'portal.appointments.past.heading': 'Pasadas',
  'portal.appointments.past.none': 'No consta ninguna cita pasada.',
  'portal.appointments.mode.video': 'Videollamada',
  'portal.appointments.mode.inPerson': 'Presencial',
  'portal.appointments.mode.past': 'Pasada',
  'portal.appointments.join': 'Entrar en la videollamada',
  'portal.appointments.directions': 'Cómo llegar',
  'portal.appointments.move': 'Pedir un cambio de hora',
  'portal.appointments.cancel': 'Anular',
  'portal.appointments.cancelledBadge': 'Anulada',
  'portal.appointments.cancelDialog.title': '¿Anular esta cita?',
  'portal.appointments.cancelDialog.description':
    'Esto anularía {reason} con {clinician} el {when}. La hora pasa a otra persona y, para que le vean, tendría que pedir una cita nueva. Puede que la siguiente hora libre tarde semanas.',
  'portal.appointments.cancelDialog.keep': 'Mantener la cita',
  'portal.appointments.cancelDialog.confirm': 'Anular la cita',
  'portal.appointments.requestDialog.title': 'Pedir una cita',
  'portal.appointments.requestDialog.rescheduleTitle': 'Pedir un cambio de hora',
  'portal.appointments.requestDialog.description':
    'Esto llega a la consulta como una solicitud. Le confirmarán una hora por mensaje. No hay nada reservado hasta que lo hagan.',
  'portal.appointments.requestDialog.close': 'Cerrar sin enviar',
  'portal.appointments.requestDialog.send': 'Enviar la solicitud',
  'portal.appointments.requestDialog.reason.label': '¿Por qué necesita que le vean?',
  'portal.appointments.requestDialog.reason.hint': 'Con una línea basta.',
  'portal.appointments.requestDialog.times.label': '¿Cuándo puede venir?',
  'portal.appointments.requestDialog.times.hint': 'Por ejemplo, las mañanas entre semana.',
  'portal.appointments.requestDialog.failed':
    'Su solicitud no se ha enviado y lo que escribió sigue aquí. Compruebe su conexión y vuelva a enviarla.',
};
