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
};
