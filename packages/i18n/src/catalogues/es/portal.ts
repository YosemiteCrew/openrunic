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
  'portal.home.subject': 'su resumen de inicio',
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
};
