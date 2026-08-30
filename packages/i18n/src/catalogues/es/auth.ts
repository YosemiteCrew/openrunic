import type { Messages } from '../../catalogue.js';

/**
 * Sign-in, in Spanish. Operational rather than clinical.
 *
 * See `./index.ts` for what is deliberately absent from this language and why.
 */
export const auth: Messages = {
  'auth.signIn.title': 'Iniciar sesión',
  'auth.signIn.lede':
    'Acceso para personal de openrunic. La sesión se cierra tras {minutes} minutos sin actividad, de modo que una estación de trabajo desatendida no queda abierta en un historial.',
  'auth.signIn.tokenLabel': 'Token de acceso',
  'auth.signIn.tokenHint': 'El token que le facilitó su instalación.',
  'auth.signIn.tokenRejected': 'No se reconoció ese token de acceso.',
  'auth.signIn.submit': 'Iniciar sesión',
  'auth.signIn.submitting': 'Iniciando sesión',
  'auth.signIn.provider': 'Inicie sesión con su organización',
  'auth.signIn.developmentHeading': 'Inicio de sesión de desarrollo',
  'auth.signIn.unavailable.title': 'No se pudo contactar con el servicio de inicio de sesión.',
  'auth.signIn.unavailable.body':
    'Compruebe que la aplicación sigue funcionando e inténtelo de nuevo.',
  'auth.signedOut.idle.title': 'Se cerró su sesión tras {minutes} minutos sin actividad.',
  'auth.signedOut.idle.body': 'Inicie sesión de nuevo para continuar donde lo dejó.',
  'auth.signedOut.expired.title': 'Su sesión ha terminado.',
  'auth.signedOut.expired.body': 'Inicie sesión de nuevo para continuar.',
  'auth.holding': 'Restaurando su sesión',

  /* ------------------------------------------------------- the browser tab */
  'auth.page.title': 'Iniciar sesión',

  'auth.signIn.providerLede':
    'Se le enviará a su proveedor de identidad y volverá aquí en cuanto haya confirmado quién es.',
  'auth.signIn.developmentLede':
    'Estos son los perfiles públicos de desarrollo de la API: datos de prueba, no credenciales. La API se niega a arrancar con ellos en producción, así que nada de lo que abren llega a una instalación real.',
  'auth.signIn.demoHeading': 'Demostración',
  'auth.signIn.demoLede':
    'Esto es una demostración de openrunic. Todos los registros son inventados, no se guarda nada, y cada inicio de sesión de abajo es un dato de prueba público. Entre como quien quiera y eche un vistazo.',
};
