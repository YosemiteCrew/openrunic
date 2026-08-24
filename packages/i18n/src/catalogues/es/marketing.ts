import type { Messages } from '../../catalogue.js';

/**
 * LAS PAGINAS PUBLICAS.
 *
 * Texto público, no clínico: lo que el proyecto es, para quién y qué no
 * pretende ser. Cada afirmación corresponde a la versión en inglés y se tradujo
 * sin suavizarla, porque la parte que más importa aquí es la que dice lo que
 * openrunic NO garantiza.
 *
 * Los nombres propios que no se traducen, a propósito: openrunic, Yosemite
 * Crew, FHIR R4, PostgreSQL, Prisma, AGPL-3.0-only, ADR.
 */
export const marketing: Messages = {
  'marketing.tagline': 'Sistema operativo de código abierto para la salud humana',
  'marketing.readTheCode': 'Lea el código',
  'marketing.licence': 'AGPL-3.0. Suyo para ejecutar, leer y modificar.',

  'marketing.header.home': 'Inicio de openrunic',
  'marketing.header.nav': 'Sitio',
  'marketing.nav.hospitals': 'Hospitales',
  'marketing.nav.patients': 'Pacientes',
  'marketing.nav.developers': 'Desarrolladores',

  'marketing.link.source': 'Código fuente',
  'marketing.link.documentation': 'Documentación',
  'marketing.link.architecture': 'Arquitectura',
  'marketing.link.roadmap': 'Hoja de ruta',
  'marketing.link.contributing': 'Guía para contribuir',
  'marketing.link.goodFirstIssues': 'Tareas para empezar',
  'marketing.link.discussions': 'Discusiones',
  'marketing.link.conduct': 'Código de conducta',
  'marketing.link.licence': 'Licencia: AGPL-3.0-only',
  'marketing.link.compliance': 'Postura regulatoria',
  'marketing.link.security': 'Política de seguridad',
  'marketing.link.decisions': 'Decisiones de arquitectura',
  'marketing.link.readTheSource': 'Lea el código fuente',
  'marketing.link.gettingStarted': 'Primeros pasos',
  'marketing.link.apiDesign': 'Diseño de la API',
  'marketing.link.selfHosting': 'Cómo funcionará la instalación propia',
  'marketing.link.patientPortal': 'Cómo funciona el portal',
  'marketing.link.readDecisions': 'Lea los registros de decisiones de arquitectura',
  'marketing.link.readCompliance': 'Lea la postura regulatoria completa',
  'marketing.link.readArchitecture': 'Lea el resumen de arquitectura',
  'marketing.link.readAgentDecisions':
    'Lea los ADR-0004 y ADR-0005, que fijan y luego acotan estas reglas',

  'marketing.footer.note':
    'Un sistema operativo de código abierto para la salud humana, hecho por Yosemite Crew. Prealfa: todavía no hay versiones publicadas.',
  'marketing.footer.column.project': 'Proyecto',
  'marketing.footer.column.contribute': 'Contribuir',
  'marketing.footer.column.governance': 'Gobernanza',
  'marketing.footer.notCertified':
    'openrunic es software de código abierto, no un dispositivo médico certificado.',
  'marketing.footer.copyright':
    'Copyright (C) 2026 colaboradores de openrunic. Bajo licencia AGPL-3.0-only.',

  'marketing.pillar.link': 'openrunic para {audience}',
  'marketing.pillar.hospitals.title': 'Hospitales y clínicas',
  'marketing.pillar.hospitals.summary':
    'Maneje agenda, historiales, órdenes, resultados y facturación en software que su clínica controla, sobre una base de datos que usted puede leer.',
  'marketing.pillar.hospitals.point1':
    'Una aplicación para el personal que cubre el día clínico, de la agenda a la reclamación',
  'marketing.pillar.hospitals.point2':
    'Postgres que es suyo, sin licencia por usuario y sin un proveedor que retenga la exportación',
  'marketing.pillar.hospitals.point3':
    'Un registro de auditoría sin el cual los repositorios no pueden entregar un registro',
  'marketing.pillar.patients.title': 'Pacientes',
  'marketing.pillar.patients.summary':
    'Su expediente le pertenece. openrunic lo guarda en un estándar abierto para que pueda viajar con usted entre proveedores.',
  'marketing.pillar.patients.point1':
    'Un portal para citas, resultados, mensajes, formularios y cuentas',
  'marketing.pillar.patients.point2':
    'FHIR R4 en la frontera, de modo que el expediente no queda atrapado en un formato privado',
  'marketing.pillar.patients.point3':
    'Ninguna interpretación de sus resultados por software, por diseño',
  'marketing.pillar.developers.title': 'Desarrolladores',
  'marketing.pillar.developers.summary':
    'Una plataforma abierta con un monorepo tipado, una declaración de conformidad FHIR generada y ninguna edición que retenga funciones.',
  'marketing.pillar.developers.point1':
    'FHIR R4 en la frontera del servicio, anunciando solo lo que puede responder',
  'marketing.pillar.developers.point2':
    'Paquetes tipados para el mapeo FHIR, el modelo de datos y la interfaz',
  'marketing.pillar.developers.point3':
    'AGPL-3.0-only, sin núcleo abierto, con las decisiones registradas como ADR en el repositorio',
  'marketing.otherAudiences.title': 'Las otras audiencias',
  'marketing.otherAudiences.lead':
    'El mismo sistema, descrito para las personas que están del otro lado.',

  'marketing.home.eyebrow': 'Código abierto, AGPL-3.0-only',
  'marketing.home.title': 'Sistema operativo de código abierto para la salud humana',
  'marketing.home.lead':
    'El primer producto es un expediente médico electrónico moderno y ligero: registro, agenda, consultas, órdenes, resultados y el ciclo de ingresos, con FHIR R4 en la frontera de la API y un registro de auditoría que fue el primer modelo del esquema.',
  'marketing.home.status.label': 'Dónde está el proyecto',
  'marketing.home.status.body':
    'Prealfa. No hay versiones publicadas ni imágenes de contenedor, las API y los esquemas cambian sin aviso, y ninguna parte de esto está lista para una clínica en funcionamiento. No cargue datos reales de pacientes.',
  'marketing.home.audiences.title': 'Tres audiencias',
  'marketing.home.audiences.lead':
    'El proyecto se organiza alrededor de tres grupos de personas, y cada superficie pertenece a uno de ellos.',
  'marketing.home.foundations.title': 'Cómo está construido',
  'marketing.home.foundations.lead':
    'Cuatro decisiones que dan forma a todo lo demás. El razonamiento de cada una, incluido lo que se descartó, está escrito en el repositorio.',
  'marketing.home.foundation.relational.title': 'Almacenamiento relacional, FHIR en la frontera',
  'marketing.home.foundation.relational.body':
    'PostgreSQL a través de Prisma es la única fuente de verdad. La serialización FHIR R4 ocurre en la frontera de la API, y cada recurso mapeado lleva pruebas de ida y vuelta. La declaración de conformidad se genera desde el mismo registro que sirve el enrutador, así que el servidor anuncia solo los parámetros de búsqueda que realmente puede responder.',
  'marketing.home.foundation.audit.title': 'La auditoría es estructural, no un añadido',
  'marketing.home.foundation.audit.body':
    'El evento de auditoría fue el primer modelo del esquema y la primera migración del repositorio. Una solicitud llega a un registro a través de un repositorio que no puede funcionar sin un recolector de auditoría, así que dejar rastro no es algo que un manejador pueda olvidar. Los eventos forman una cadena de hashes por organización, lo que hace detectable la manipulación del historial en lugar de solo desaconsejarla.',
  'marketing.home.foundation.telemetry.title': 'Nada se envía a casa',
  'marketing.home.foundation.telemetry.body':
    'openrunic no transmite nada al proyecto, a quienes lo mantienen ni a ningún tercero elegido por el proyecto. Quien lo instala puede configurar un punto de inferencia externo para el asistente opcional; si lo hace, los datos van a un procesador con el que contrató, bajo un acuerdo que es suyo, y el producto lo dice con claridad al configurarlo.',
  'marketing.home.foundation.content.title': 'Sin contenido incorporado, sin modelos empaquetados',
  'marketing.home.foundation.content.body':
    'La terminología clínica tiene licencia restringida y nunca se guarda en el repositorio: cada instalación carga solo aquello para lo que tiene licencia. La misma regla cubre los pesos de los modelos. Ningún entorno de aprendizaje automático se distribuye dentro de la instalación, y el asistente opcional viene apagado, llama a un punto que designa quien lo instala y nunca está en una ruta clínica.',
  'marketing.home.position.title': 'Lo que openrunic no afirma',
  'marketing.home.position.lead':
    'El software de salud atrae lenguaje seguro de sí mismo. Esta es la parte del sitio donde ser exacto importa más que ser persuasivo.',
  'marketing.home.position.certified.title': 'openrunic no está certificado para nada',
  'marketing.home.position.certified.body':
    'No es un dispositivo médico y no es un expediente clínico certificado. No tiene autorización ni aprobación de ningún regulador, y no se insinúa ninguna. No cumple con HIPAA ni con el RGPD de fábrica, porque el cumplimiento es una propiedad de una instalación concreta (su organización, sus acuerdos, su configuración y su jurisdicción) y nunca del código fuente por sí solo.',
  'marketing.home.position.support.title': 'Lo que sí está diseñado para respaldar',
  'marketing.home.position.support.body':
    'El registro de auditoría, el diseño de acceso con el mínimo privilegio y el hecho de que una clínica pueda ejecutar todo el sistema en equipo que ella controla están hechos para que alguien competente pueda construir encima una instalación que cumpla. Respaldan ese trabajo. No lo hacen por usted, y distribuirlos no vuelve conforme a ninguna instalación.',
  'marketing.home.position.advice.title': 'No da consejo médico',
  'marketing.home.position.advice.body':
    'openrunic no está pensado para dar consejo médico, diagnóstico ni recomendaciones de tratamiento, y ninguna parte de él interpreta un valor clínico para un paciente ni clasifica nada por riesgo clínico. Las decisiones clínicas son responsabilidad de profesionales de la salud calificados.',
  'marketing.home.contribute.title': 'Léalo, ejecútelo, modifíquelo',
  'marketing.home.contribute.lead':
    'AGPL-3.0-only, sin una edición de núcleo abierto que retenga funciones. Si ejecuta una versión modificada como servicio en red, la licencia le obliga a ofrecer su código a sus usuarios.',

  'marketing.hospitals.eyebrow': 'Para hospitales y clínicas',
  'marketing.hospitals.title': 'Lleve el día clínico en software que usted controla',
  'marketing.hospitals.lead':
    'Una sola aplicación para el día que una clínica realmente tiene: la agenda y el panel de flujo, el historial, la bandeja de entrada, órdenes y resultados, y el ciclo de ingresos desde la captura de cargos hasta la remesa. No es un conjunto de módulos que se venden por separado.',
  'marketing.hospitals.status.label': 'Qué puede ejecutar hoy',
  'marketing.hospitals.status.body':
    'Una clínica no, siendo honestos. No hay versiones publicadas, ni imágenes de contenedor, ni documentación de instalación; el empaquetado para instalación propia se está construyendo y no está terminado. Lo que existe es código que puede leer y un servidor de desarrollo que ejecuta toda la aplicación del personal contra datos sintéticos deterministas, sin base de datos.',
  'marketing.hospitals.coverage.title': 'Qué cubre la aplicación',
  'marketing.hospitals.coverage.lead':
    'Cinco áreas, todas ellas pantallas que ya están en el repositorio y no puntos de una hoja de ruta.',
  'marketing.hospitals.coverage.frontDesk.title': 'La recepción',
  'marketing.hospitals.coverage.frontDesk.body':
    'Una vista del día con columnas por profesional y una línea de la hora actual, un paginador de días, un buscador de espacios libres, reserva y admisión. Al lado, un panel de flujo con cinco columnas de estado, dos relojes por paciente, avance de estado en un clic, asignación de sala y filtros por profesional, sala y solo retrasados.',
  'marketing.hospitals.coverage.chart.title': 'El historial',
  'marketing.hospitals.coverage.chart.body':
    'Búsqueda de pacientes por nombre de pila, apellido, nombre preferido y número de expediente, con vistas guardadas formuladas como preguntas. El registro detecta duplicados mientras se escribe el nombre y bloquea el guardado ante una coincidencia fuerte, en lugar de dejar que alguien la ignore dos veces. La cobertura y la elegibilidad tienen su propia pantalla, y la nota de la consulta lleva un bloque de firma.',
  'marketing.hospitals.coverage.orders.title': 'Órdenes y resultados',
  'marketing.hospitals.coverage.orders.body':
    'Composición de órdenes con manejo de muestras y avisos que aparecen antes de emitir la orden, una lista de trabajo que muestra las órdenes que dejaron de avanzar, y resultados con marcas, lecturas y firma.',
  'marketing.hospitals.coverage.revenue.title': 'El ciclo de ingresos',
  'marketing.hospitals.coverage.revenue.body':
    'Captura de cargos ligada a diagnósticos, una mesa de reclamaciones que las depura antes de enviarlas, contabilización de remesas con sus excepciones, estados de cuenta y antigüedad, y asignación de pagos con recibos.',
  'marketing.hospitals.coverage.admin.title': 'Administración',
  'marketing.hospitals.coverage.admin.body':
    'Usuarios y roles en una matriz de permisos, centros, un constructor de formularios, integraciones con socios, una superficie de plataforma para desarrolladores, y el registro de auditoría como una pantalla que la clínica puede leer y no una tabla que solo un ingeniero puede consultar.',
  'marketing.hospitals.ownership.title': 'Qué significa ejecutarlo usted mismo',
  'marketing.hospitals.ownership.lead':
    'Las partes que tratan de propiedad y obligaciones, no de funciones.',
  'marketing.hospitals.ownership.database.title':
    'Su base de datos, y ninguna exportación que pedir',
  'marketing.hospitals.ownership.database.body':
    'El esquema relacional es la fuente de verdad y está en el repositorio, así que una clínica puede leer sus propios registros con herramientas comunes. No hay un formato propietario entre la clínica y sus datos, ni nadie a quien pedirle una copia.',
  'marketing.hospitals.ownership.licence.title': 'Sin licencia por usuario y sin edición retenida',
  'marketing.hospitals.ownership.licence.body':
    'AGPL-3.0-only. Sumar un profesional no suma una factura, y no hay un nivel de pago donde vivan las funciones útiles. La licencia sí le obliga en el otro sentido: si ejecuta una versión modificada como servicio en red, debe ofrecer su código a sus usuarios.',
  'marketing.hospitals.ownership.compliance.title':
    'El cumplimiento sigue siendo suyo, y el software está hecho para eso',
  'marketing.hospitals.ownership.compliance.body':
    'openrunic no está certificado y no puede hacer que una instalación cumpla. Lo que hace es volver posible el trabajo: las acciones relevantes para la seguridad se registran como una función central y no como un añadido, el acceso se diseña otorgando el mínimo que un rol necesita, y todo el sistema puede ejecutarse en equipo que la clínica controla.',

  'marketing.patients.eyebrow': 'Para pacientes',
  'marketing.patients.title': 'Su expediente, en un formato que puede salir',
  'marketing.patients.lead':
    'Un expediente de salud vale la pena solo si puede seguirle. openrunic lo guarda en un estándar abierto en lugar de un formato privado, y le da un portal para leerlo en un lenguaje escrito para una persona y no para un historial.',
  'marketing.patients.status.label': 'Qué significa esto hoy',
  'marketing.patients.status.body':
    'Aquí no hay nada a lo que registrarse. openrunic es software prealfa sin versiones publicadas, y que usted llegue a usarlo depende de que una clínica decida ejecutarlo. Esta página describe cómo está construido el proyecto, no un servicio al que pueda unirse.',
  'marketing.patients.portal.title': 'Qué muestra el portal',
  'marketing.patients.portal.lead':
    'Tres cosas, en seis pantallas, todas ellas ya en el repositorio.',
  'marketing.patients.portal.upcoming.title': 'Qué viene y qué le espera a usted',
  'marketing.patients.portal.upcoming.body':
    'La pantalla de inicio responde las dos preguntas con las que un paciente realmente abre un portal: qué sigue y si algo está esperando por mí. Las citas, próximas y pasadas, tienen su propia pantalla.',
  'marketing.patients.portal.record.title': 'Su expediente de salud, en palabras',
  'marketing.patients.portal.record.body':
    'Resultados, condiciones, medicamentos, alergias, vacunas y documentos. Un término codificado nunca aparece solo: la redacción en lenguaje sencillo va al lado, de modo que un código de diagnóstico se lee como aquello que significa. Un valor medido tampoco aparece solo, sino con su unidad, su rango habitual y un veredicto con nombre.',
  'marketing.patients.portal.messages.title': 'Mensajes, formularios y cuentas',
  'marketing.patients.portal.messages.body':
    'Mensajería segura con la clínica, formularios de admisión y consentimiento por completar, y saldos y estados de cuenta. Un resultado que usted no entienda abre una vía para preguntar por él, en lugar de dejarle buscar la bandeja de mensajes por su cuenta.',
  'marketing.patients.ownership.title': 'Por qué importa el formato',
  'marketing.patients.ownership.lead':
    'Las decisiones detrás de las pantallas, que son la parte que sobrevive a cualquier diseño en particular.',
  'marketing.patients.ownership.standard.title': 'Un estándar abierto en la frontera',
  'marketing.patients.ownership.standard.body':
    'El servicio habla FHIR R4, el estándar de interoperabilidad alrededor del cual está escrito el trabajo regulatorio tanto en Estados Unidos como en la Unión Europea. Un expediente guardado así puede ser leído por cualquier otro sistema que lo hable, que es la diferencia entre tener sus datos y tener una impresión de ellos.',
  'marketing.patients.ownership.interpretation.title': 'Nada se interpreta por usted',
  'marketing.patients.ownership.interpretation.body':
    'El proyecto ya decidió, por escrito y antes de construir la función, que la redacción en lenguaje sencillo proviene de una correspondencia curada de los códigos que ya están en su expediente, y nunca de un modelo que decida qué significa un valor para usted. Aquí el software explica un término. No le dice cuánto debe preocuparse.',
  'marketing.patients.ownership.privacy.title': 'Usted no es el producto',
  'marketing.patients.ownership.privacy.body':
    'openrunic no transmite nada al proyecto ni a quienes lo mantienen. No hay una tubería de analítica leyendo un expediente, y el proyecto se comprometió a que cualquier telemetría futura sea opcional, documentada y estructuralmente incapaz de llevar datos de salud.',
  'marketing.patients.ownership.advice.title': 'No es consejo médico',
  'marketing.patients.ownership.advice.body':
    'openrunic no es un dispositivo médico y no está certificado por ningún regulador. No está pensado para dar consejo médico, diagnóstico ni recomendaciones de tratamiento. Las decisiones clínicas corresponden a profesionales de la salud calificados, y el portal está hecho para facilitar preguntarle a uno, no para sustituirlo.',

  'marketing.developers.eyebrow': 'Para desarrolladores',
  'marketing.developers.title': 'Una plataforma abierta con la frontera escrita',
  'marketing.developers.lead':
    'Un monorepo de pnpm y Turborepo sobre Node 22: un servicio Hono que sirve FHIR R4, una aplicación Next.js para el personal y un portal para pacientes, y paquetes tipados para el modelo de datos, los mapeadores y el sistema de diseño. Cada decisión importante, y lo que descartó, es un registro de decisión de arquitectura en el repositorio.',
  'marketing.developers.status.label': 'Estabilidad',
  'marketing.developers.status.body':
    'Prealfa, y los números de versión lo dicen. Nada se publica en un registro de paquetes, no hay versiones, y las API, los esquemas y los límites de los paquetes cambian sin aviso. Construya contra esto para aprender o para contribuir, no para poner un producto encima.',
  'marketing.developers.boundary.title': 'La frontera del servicio',
  'marketing.developers.boundary.lead':
    'Con qué tiene que hablar otro sistema, y las reglas a las que se somete.',
  'marketing.developers.boundary.fhir.title': 'FHIR R4, anunciando solo lo que puede responder',
  'marketing.developers.boundary.fhir.body':
    'La declaración de conformidad se genera desde el mismo registro que sirve el enrutador, así que no puede desviarse de la implementación. Un parámetro de búsqueda aparece solo cuando el repositorio detrás de él realmente puede responderlo, y un parámetro codificado solo cuando el enum del dominio y el conjunto de valores FHIR coinciden uno a uno. Donde un mapeo perdería información, el parámetro no está y la pérdida queda a la vista en vez de escondida tras un filtro que funciona a medias.',
  'marketing.developers.boundary.relational.title': 'Relacional por debajo, FHIR en la frontera',
  'marketing.developers.boundary.relational.body':
    'PostgreSQL a través de Prisma es la fuente de verdad; FHIR es una proyección en la frontera, y cada mapeador se entrega con pruebas de ida y vuelta. Ese es el intercambio registrado en la segunda decisión de arquitectura: una superficie de búsqueda más pequeña en la frontera, a cambio de un esquema que SQL común y herramientas comunes pueden razonar.',
  'marketing.developers.boundary.middleware.title':
    'Una sola cadena de middleware, en un solo orden',
  'marketing.developers.boundary.middleware.body':
    'Un identificador de solicitud, luego autenticación, luego alcance por organización, luego política, luego auditoría. A los repositorios se les entrega un recolector de auditoría con el alcance de la solicitud y no pueden funcionar sin él, así que el aislamiento entre organizaciones y el registro de accesos son propiedades de la cadena y no cosas que cada manejador recuerde. Los fallos vuelven como documentos de problema, así que un error se puede analizar en lugar de ser una cadena de texto.',
  'marketing.developers.boundary.workspaces.title':
    'Espacios de trabajo tipados, no una aplicación con carpetas',
  'marketing.developers.boundary.workspaces.body':
    'Tipos compartidos, los mapeadores FHIR, el esquema y el cliente de Prisma, la biblioteca de componentes del sistema de diseño, y paquetes de dominio para los conjuntos de transacciones de reclamaciones electrónicas, el motor de formularios, la terminología que cada quien aporta y los adaptadores de socios versionados. Cada uno tiene sus propias pruebas y su propia frontera.',
  'marketing.developers.agent.title': 'La capa de agentes opcional',
  'marketing.developers.agent.lead':
    'Existe un asistente, está apagado salvo que quien instala lo encienda, y sus restricciones se escribieron antes de construirlo.',
  'marketing.developers.agent.defaultOff.title': 'Apagado por omisión y de verdad separable',
  'marketing.developers.agent.defaultOff.body':
    'El asistente es un contenedor aparte que la invocación por omisión no inicia. Cada capacidad a la que puede llegar tiene una ruta determinista en la interfaz, así que una caída del punto que configuró quien instala le cuesta a la clínica su asistente y nada más. Una configuración sin modelo es un objetivo de prueba de primera clase, no algo secundario.',
  'marketing.developers.agent.tools.title': 'Las herramientas son clientes de API comunes',
  'marketing.developers.agent.tools.body':
    'Ninguna herramienta recibe un cliente de base de datos. Las herramientas llaman a la misma API HTTP llevando las credenciales de quien preguntó, así que el alcance por organización, las comprobaciones de política y las escrituras de auditoría las aplica el middleware que ya existe, y no una segunda implementación que pueda desviarse de él.',
  'marketing.developers.agent.outbound.title': 'No puede hablar hacia afuera',
  'marketing.developers.agent.outbound.body':
    'No hay ninguna herramienta de comunicación saliente de ningún tipo: ni correo, ni mensajes, ni webhooks, ni descarga de URL. El acceso a registros privados, más la exposición a texto no confiable, más la capacidad de enviar cosas hacia afuera es la combinación contra la que vale la pena diseñar, y la tercera se vuelve estructuralmente imposible en lugar de solo prohibida.',
  'marketing.developers.agent.retrieval.title':
    'Recuperación, no generación, para contenido clínico',
  'marketing.developers.agent.retrieval.body':
    'Una frase que no pueda llevar una cita a una fila y un campo del expediente no se emite, y eso lo impone un resolvedor en el código y no una instrucción al modelo. Ningún peso, ningún Python y ninguna inferencia se distribuyen dentro de la instalación. Quien instala designa, configura y paga un punto remoto, y encenderlo exige un reconocimiento aparte que nombra el acuerdo bajo el que opera.',
  'marketing.developers.bar.title': 'El listón que una modificación debe superar',
  'marketing.developers.bar.lead':
    'Cada solicitud de cambio se analiza en cobertura, calidad del código, vulnerabilidades conocidas, secretos filtrados, licencias de dependencias y procedencia de la cadena de suministro. Nada se integra solo por una palomita verde: el listón es un tablero limpio.',
};
