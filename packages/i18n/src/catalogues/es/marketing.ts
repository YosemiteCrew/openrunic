import type { Messages } from '../../catalogue.js';

/**
 * The public pages, in Spanish.
 *
 * Complete rather than partial on purpose. These four pages are prerendered
 * once per language, so a key missing here is a paragraph of English in the
 * middle of a Spanish page, with nothing on the page offering a way out of it.
 *
 * The regulatory sentences are translated and never softened. "openrunic no
 * está certificado para nada" reads as bluntly in Spanish as it does in
 * English, and that is the point of the band it sits in.
 *
 * See `./index.ts` for what is deliberately absent from this language and why.
 */
export const marketing: Messages = {
  'marketing.tagline': 'Sistema operativo de código abierto para la salud humana',

  'marketing.header.home': 'Inicio de openrunic',
  'marketing.header.siteNav': 'Sitio',
  'marketing.source': 'Código fuente',
  'marketing.nav.hospitals': 'Hospitales',
  'marketing.nav.patients': 'Pacientes',
  'marketing.nav.developers': 'Desarrolladores',

  'marketing.footer.note':
    'Un sistema operativo de código abierto para la salud humana, construido por Yosemite Crew. Prealfa: todavía no hay versiones publicadas.',
  'marketing.footer.project': 'Proyecto',
  'marketing.footer.documentation': 'Documentación',
  'marketing.footer.architecture': 'Arquitectura',
  'marketing.footer.roadmap': 'Hoja de ruta',
  'marketing.footer.contribute': 'Contribuir',
  'marketing.footer.discussions': 'Discusiones',
  'marketing.footer.conduct': 'Código de conducta',
  'marketing.footer.governance': 'Gobernanza',
  'marketing.footer.licence': 'Licencia: AGPL-3.0-only',
  'marketing.footer.compliance': 'Postura regulatoria',
  'marketing.footer.security': 'Política de seguridad',
  'marketing.footer.decisions': 'Decisiones de arquitectura',
  'marketing.footer.notDevice':
    'openrunic es software de código abierto, no un dispositivo médico certificado.',
  'marketing.footer.copyright':
    'Copyright (C) 2026 colaboradores de openrunic. Con licencia AGPL-3.0-only.',

  'marketing.cta.readTheSource': 'Lea el código fuente',
  'marketing.cta.gettingStarted': 'Primeros pasos',
  'marketing.cta.contributing': 'Guía para contribuir',
  'marketing.cta.goodFirstIssues': 'Buenas tareas para empezar',
  'marketing.cta.compliance': 'Lea la postura regulatoria completa',
  'marketing.cta.decisions': 'Lea los registros de decisiones de arquitectura',
  'marketing.cta.architecture': 'Lea el resumen de la arquitectura',

  'marketing.pillar.hospitals.title': 'Hospitales y clínicas',
  'marketing.pillar.hospitals.summary':
    'Opere agendas, expedientes, órdenes, resultados y facturación sobre software que su consulta controla, en una base de datos que usted puede leer.',
  'marketing.pillar.hospitals.point1':
    'Una aplicación para el personal que cubre el día clínico, de la agenda a la reclamación',
  'marketing.pillar.hospitals.point2':
    'Postgres suyo, sin licencia por usuario y sin un proveedor que retenga la exportación',
  'marketing.pillar.hospitals.point3':
    'Un registro de auditoría sin el cual los repositorios no pueden entregar un expediente',
  'marketing.pillar.hospitals.link': 'openrunic para hospitales y clínicas',

  'marketing.pillar.patients.title': 'Pacientes',
  'marketing.pillar.patients.summary':
    'Su expediente le pertenece. openrunic lo guarda en un estándar abierto para que pueda acompañarlo de un proveedor a otro.',
  'marketing.pillar.patients.point1':
    'Un portal para citas, resultados, mensajes, formularios y cuentas',
  'marketing.pillar.patients.point2':
    'FHIR R4 en la frontera, para que el expediente no quede encerrado en un formato privado',
  'marketing.pillar.patients.point3':
    'Ninguna interpretación de sus resultados hecha por software, por diseño',
  'marketing.pillar.patients.link': 'openrunic para pacientes',

  'marketing.pillar.developers.title': 'Desarrolladores',
  'marketing.pillar.developers.summary':
    'Una plataforma abierta con un monorepo tipado, una declaración de conformidad FHIR generada y ninguna edición que retenga funciones.',
  'marketing.pillar.developers.point1':
    'FHIR R4 en la frontera del servicio, anunciando solo lo que puede responder',
  'marketing.pillar.developers.point2':
    'Paquetes tipados para el mapeo FHIR, el modelo de datos y la interfaz',
  'marketing.pillar.developers.point3':
    'AGPL-3.0-only, sin núcleo abierto, decisiones registradas como ADR en el repositorio',
  'marketing.pillar.developers.link': 'openrunic para desarrolladores',

  'marketing.otherAudiences.title': 'Los otros públicos',
  'marketing.otherAudiences.lead':
    'El mismo sistema, descrito para las personas que están del otro lado.',

  'marketing.home.metaTitle':
    'openrunic - sistema operativo de código abierto para la salud humana',
  'marketing.home.metaDescription':
    'openrunic es un sistema operativo de código abierto para la salud humana, con licencia AGPL-3.0-only. Su primer producto es un expediente médico electrónico moderno con FHIR R4 en la frontera de la API.',
  'marketing.home.eyebrow': 'Código abierto, AGPL-3.0-only',
  'marketing.home.lead':
    'El primer producto es un expediente médico electrónico moderno y ligero: registro, agenda, consultas, órdenes, resultados y el ciclo de ingresos, con FHIR R4 en la frontera de la API y un registro de auditoría que fue el primer modelo del esquema.',
  'marketing.home.statusLabel': 'En qué punto está el proyecto',
  'marketing.home.statusBody':
    'Prealfa. No hay versiones publicadas ni imágenes de contenedor, las API y los esquemas cambian sin aviso, y ninguna parte de esto está lista para una consulta real. No cargue datos reales de pacientes.',

  'marketing.home.audiences.title': 'Tres públicos',
  'marketing.home.audiences.lead':
    'El proyecto está organizado alrededor de tres grupos de personas, y cada superficie pertenece a uno de ellos.',

  'marketing.home.foundations.title': 'Cómo está construido',
  'marketing.home.foundations.lead':
    'Cuatro decisiones que dan forma a todo lo demás. El razonamiento de cada una, incluido lo que se descartó, está escrito en el repositorio.',
  'marketing.home.foundations.storage.title': 'Almacenamiento relacional, FHIR en el borde',
  'marketing.home.foundations.storage.body':
    'PostgreSQL a través de Prisma es la única fuente de verdad. La serialización FHIR R4 ocurre en la frontera de la API, y cada recurso mapeado lleva pruebas de ida y vuelta. La declaración de conformidad se genera desde el mismo registro que sirve el enrutador, así que el servidor anuncia solo los parámetros de búsqueda que realmente puede responder.',
  'marketing.home.foundations.audit.title': 'La auditoría es estructural, no un añadido',
  'marketing.home.foundations.audit.body':
    'El evento de auditoría fue el primer modelo del esquema y la primera migración del repositorio. Una solicitud llega a un registro a través de un repositorio que no puede funcionar sin un recolector de auditoría, así que dejar rastro no es algo que un manejador pueda olvidar. Los eventos forman una cadena de hashes por organización, lo que hace que alterar el historial sea detectable en vez de simplemente desaconsejado.',
  'marketing.home.foundations.privacy.title': 'Nada se comunica hacia afuera',
  'marketing.home.foundations.privacy.body':
    'openrunic no transmite nada al proyecto, a quienes lo mantienen, ni a ningún tercero elegido por el proyecto. Quien lo despliega puede configurar un servicio externo de inferencia para el asistente opcional; si lo hace, los datos van a un procesador con el que contrató, bajo un acuerdo que él mismo tiene, y el producto lo dice con claridad en el momento de configurarlo.',
  'marketing.home.foundations.content.title': 'Sin contenido incorporado, sin modelos empaquetados',
  'marketing.home.foundations.content.body':
    'La terminología clínica está restringida por licencia y nunca se incluye en el repositorio: cada despliegue carga solo aquello para lo que tiene licencia. La misma regla cubre los pesos de los modelos. Ningún motor de aprendizaje automático se incluye en el despliegue, y el asistente opcional está apagado de fábrica, llama a un servicio que nombra quien despliega, y nunca está en una ruta clínica.',

  'marketing.home.position.title': 'Lo que openrunic no afirma',
  'marketing.home.position.lead':
    'El software de salud atrae el lenguaje seguro de sí mismo. Esta es la parte del sitio donde ser exacto importa más que ser convincente.',
  'marketing.home.position.certified.title': 'openrunic no está certificado para nada',
  'marketing.home.position.certified.body':
    'No es un dispositivo médico, y no es un expediente clínico certificado. No tiene autorización ni aprobación de ningún regulador, y no se da a entender que la tenga. No cumple con HIPAA ni con el RGPD de fábrica, porque el cumplimiento es una propiedad de un despliegue - de su organización, sus acuerdos, su configuración y su jurisdicción - y nunca del código fuente por sí solo.',
  'marketing.home.position.support.title': 'Lo que sí está diseñado para apoyar',
  'marketing.home.position.support.body':
    'El registro de auditoría, el diseño de acceso con privilegio mínimo, y el hecho de que una consulta pueda ejecutar todo el sistema en hardware que controla están construidos para que alguien competente pueda armar un despliegue que cumpla, encima de ellos. Apoyan ese trabajo. No lo hacen por usted, y entregarlos no vuelve conforme a ningún despliegue.',
  'marketing.home.position.advice.title': 'No da consejo médico',
  'marketing.home.position.advice.body':
    'openrunic no está destinado a dar consejo médico, diagnósticos ni recomendaciones de tratamiento, y ninguna parte de él interpreta un valor clínico para un paciente ni ordena nada por riesgo clínico. Las decisiones clínicas son responsabilidad de profesionales de la salud calificados.',

  'marketing.home.contribute.title': 'Léalo, ejecútelo, modifíquelo',
  'marketing.home.contribute.lead':
    'AGPL-3.0-only, sin una edición de núcleo abierto que retenga funciones. Si ejecuta una versión modificada como servicio en red, la licencia le exige ofrecer su código fuente a sus usuarios.',

  'marketing.hospitals.metaTitle': 'Para hospitales y clínicas',
  'marketing.hospitals.metaDescription':
    'La aplicación de personal de openrunic cubre la agenda, el panel de flujo, el expediente, las órdenes, los resultados y el ciclo de ingresos, sobre una base de datos relacional que la propia consulta administra.',
  'marketing.hospitals.eyebrow': 'Para hospitales y clínicas',
  'marketing.hospitals.title': 'Opere el día clínico sobre software que usted controla',
  'marketing.hospitals.lead':
    'Una sola aplicación que cubre el día que una consulta realmente tiene: la agenda y el panel de flujo, el expediente, la bandeja de entrada, las órdenes y los resultados, y el ciclo de ingresos desde la captura de cargos hasta el pago. No un conjunto de módulos que se venden por separado.',
  'marketing.hospitals.selfHosting': 'Cómo funcionará la instalación propia',
  'marketing.hospitals.statusLabel': 'Qué puede ejecutar hoy',
  'marketing.hospitals.statusBody':
    'Una clínica no, con toda honestidad. No hay versiones publicadas, ni imágenes de contenedor, ni documentación de instalación; el empaquetado para instalación propia está en construcción y no está terminado. Lo que existe es código que usted puede leer, y un servidor de desarrollo que ejecuta toda la aplicación de personal contra datos sintéticos deterministas, sin base de datos.',
  'marketing.hospitals.coverage.title': 'Qué cubre la aplicación',
  'marketing.hospitals.coverage.lead':
    'Cinco áreas, todas ellas pantallas que hoy están en el repositorio y no elementos de una hoja de ruta.',
  'marketing.hospitals.coverage.frontDesk.title': 'La recepción',
  'marketing.hospitals.coverage.frontDesk.body':
    'Una vista del día con columnas por profesional y una línea de la hora actual, un paginador por día, un buscador de espacios disponibles, agendamiento y registro de llegada. Al lado, un panel de flujo con cinco columnas de estado, dos relojes por paciente, avance de estado con un clic, asignación de consultorio, y filtros por profesional, consultorio y solo demorados.',
  'marketing.hospitals.coverage.chart.title': 'El expediente',
  'marketing.hospitals.coverage.chart.body':
    'Búsqueda de pacientes por nombre de pila, apellido, nombre preferido y número de expediente, con vistas guardadas planteadas como preguntas. El registro detecta duplicados mientras se escribe el nombre y bloquea el guardado ante una coincidencia fuerte, en vez de dejar que alguien pase por encima dos veces. La cobertura y la elegibilidad tienen su propia pantalla, y la nota de la consulta lleva un bloque de firma.',
  'marketing.hospitals.coverage.orders.title': 'Órdenes y resultados',
  'marketing.hospitals.coverage.orders.body':
    'Composición de órdenes con manejo de muestras y advertencias planteadas antes de emitir la orden, una lista de trabajo que saca a la vista las órdenes que se detuvieron, y resultados con marcas, lecturas y firma.',
  'marketing.hospitals.coverage.revenue.title': 'El ciclo de ingresos',
  'marketing.hospitals.coverage.revenue.body':
    'Captura de cargos ligada a diagnósticos, un módulo de reclamaciones con revisión previa al envío, registro de pagos del pagador con sus excepciones, estados de cuenta y antigüedad, y asignación de pagos con recibos.',
  'marketing.hospitals.coverage.admin.title': 'Administración',
  'marketing.hospitals.coverage.admin.body':
    'Usuarios y roles sobre una matriz de permisos, centros, un constructor de formularios, integraciones con socios, una superficie de plataforma para desarrolladores, y el registro de auditoría como una pantalla que la consulta puede leer y no una tabla que solo un ingeniero puede consultar.',
  'marketing.hospitals.ownership.title': 'Qué significa administrarlo usted mismo',
  'marketing.hospitals.ownership.lead':
    'Las partes que tratan de propiedad y obligaciones, más que de funciones.',
  'marketing.hospitals.ownership.database.title':
    'Su base de datos, y ninguna exportación que pedir',
  'marketing.hospitals.ownership.database.body':
    'El esquema relacional es la fuente de verdad y está en el repositorio, así que una consulta puede leer sus propios registros con herramientas comunes. No hay un formato de almacenamiento propietario entre la clínica y sus datos, ni nadie a quien pedirle una copia.',
  'marketing.hospitals.ownership.licence.title': 'Sin licencia por usuario y sin edición retenida',
  'marketing.hospitals.ownership.licence.body':
    'AGPL-3.0-only. Sumar un clínico no suma una factura, y no hay un nivel de pago donde vivan las funciones útiles. La licencia sí le obliga en el otro sentido: si ejecuta una versión modificada como servicio en red, debe ofrecer su código fuente a sus usuarios.',
  'marketing.hospitals.ownership.compliance.title':
    'El cumplimiento sigue siendo suyo, y el software está hecho para eso',
  'marketing.hospitals.ownership.compliance.body':
    'openrunic no está certificado y no puede hacer que un despliegue cumpla. Lo que hace es volver posible ese trabajo: las acciones relevantes para la seguridad se registran como una función central y no como un añadido, el acceso está diseñado para otorgar el mínimo que un rol necesita, y todo el sistema puede ejecutarse en hardware que la consulta controla.',

  'marketing.patients.metaTitle': 'Para pacientes',
  'marketing.patients.metaDescription':
    'openrunic guarda el expediente de un paciente en FHIR R4, un estándar abierto, para que pueda moverse entre proveedores. El portal del paciente muestra citas, resultados, mensajes, formularios y cuentas.',
  'marketing.patients.eyebrow': 'Para pacientes',
  'marketing.patients.title': 'Su expediente, en un formato que puede salir',
  'marketing.patients.lead':
    'Un expediente de salud vale la pena solo si puede seguirlo a usted. openrunic guarda uno en un estándar abierto en vez de un formato privado, y le da un portal para leerlo en un lenguaje escrito para una persona y no para un expediente.',
  'marketing.patients.howThePortalWorks': 'Cómo funciona el portal',
  'marketing.patients.statusLabel': 'Qué significa esto hoy',
  'marketing.patients.statusBody':
    'Aquí no hay nada a lo que registrarse. openrunic es software prealfa sin versiones publicadas, y que usted llegue a usarlo depende de que una consulta decida operarlo. Esta página describe cómo está construido el proyecto, no un servicio al que pueda unirse.',
  'marketing.patients.portal.title': 'Qué muestra el portal',
  'marketing.patients.portal.lead':
    'Tres cosas, en seis pantallas, todas ellas hoy en el repositorio.',
  'marketing.patients.portal.upcoming.title': 'Qué viene, y qué le está esperando a usted',
  'marketing.patients.portal.upcoming.body':
    'La pantalla de inicio responde las dos preguntas con las que un paciente realmente abre un portal: qué sigue, y si hay algo esperando por mí. Las citas, próximas y pasadas, tienen su propia pantalla.',
  'marketing.patients.portal.record.title': 'Su expediente de salud, en palabras',
  'marketing.patients.portal.record.body':
    'Resultados, condiciones, medicamentos, alergias, vacunas y documentos. Un término codificado nunca aparece solo: la redacción en lenguaje claro va a su lado, para que un código de diagnóstico se lea como aquello que significa. Un valor medido tampoco aparece solo, sino con su unidad, su rango habitual y un veredicto expresado en palabras.',
  'marketing.patients.portal.messages.title': 'Mensajes, formularios y cuentas',
  'marketing.patients.portal.messages.body':
    'Mensajería segura con la consulta, formularios de ingreso y consentimiento por completar, y saldos y estados de cuenta. Un resultado que usted no entiende abre una forma de preguntar por él, en lugar de dejarlo buscando solo la bandeja de mensajes.',
  'marketing.patients.ownership.title': 'Por qué importa el formato',
  'marketing.patients.ownership.lead':
    'Las decisiones detrás de las pantallas, que son la parte que sobrevive a cualquier diseño en particular.',
  'marketing.patients.ownership.standard.title': 'Un estándar abierto en la frontera',
  'marketing.patients.ownership.standard.body':
    'El servicio habla FHIR R4, el estándar de interoperabilidad alrededor del cual está escrito el trabajo regulatorio tanto en Estados Unidos como en la Unión Europea. Un expediente guardado así puede ser leído por cualquier otro sistema que lo hable, que es la diferencia entre tener sus datos y tener una impresión de ellos.',
  'marketing.patients.ownership.interpretation.title': 'Nada se interpreta por usted',
  'marketing.patients.ownership.interpretation.body':
    'El proyecto ya decidió, por escrito y antes de construir la función, que la redacción en lenguaje claro proviene de una correspondencia curada de los códigos que ya están en su expediente, y nunca de un modelo que decida qué significa un valor para usted. Aquí el software explica un término. No le dice cuánto preocuparse.',
  'marketing.patients.ownership.product.title': 'Usted no es el producto',
  'marketing.patients.ownership.product.body':
    'openrunic no transmite nada al proyecto ni a quienes lo mantienen. No hay una tubería de analítica leyendo un expediente, y el proyecto se comprometió a que cualquier telemetría futura sea opcional, documentada y estructuralmente incapaz de transportar datos de salud.',
  'marketing.patients.ownership.advice.title': 'No es consejo médico',
  'marketing.patients.ownership.advice.body':
    'openrunic no es un dispositivo médico y no está certificado por ningún regulador. No está destinado a dar consejo médico, diagnósticos ni recomendaciones de tratamiento. Las decisiones clínicas corresponden a profesionales de la salud calificados, y el portal está hecho para que preguntarle a uno sea más fácil, no para ocupar su lugar.',

  'marketing.developers.metaTitle': 'Para desarrolladores',
  'marketing.developers.metaDescription':
    'Un monorepo de pnpm y Turborepo sobre Node 22: un servicio Hono que sirve FHIR R4, una aplicación de personal y un portal de pacientes en Next.js, y paquetes tipados para el modelo de datos, los mapeadores y el sistema de diseño.',
  'marketing.developers.eyebrow': 'Para desarrolladores',
  'marketing.developers.title': 'Una plataforma abierta con la frontera escrita',
  'marketing.developers.lead':
    'Un monorepo de pnpm y Turborepo sobre Node 22: un servicio Hono que sirve FHIR R4, una aplicación de personal y un portal de pacientes en Next.js, y paquetes tipados para el modelo de datos, los mapeadores y el sistema de diseño. Cada decisión importante, y lo que descartó, es un registro de decisión de arquitectura en el repositorio.',
  'marketing.developers.apiDesign': 'Diseño de la API',
  'marketing.developers.statusLabel': 'Estabilidad',
  'marketing.developers.statusBody':
    'Prealfa, y los números de versión lo dicen. Nada se publica en un registro de paquetes, no hay versiones publicadas, y las API, los esquemas y los límites entre paquetes cambian sin aviso. Constrúyalo para aprender de él o para contribuir, no para publicar sobre él.',
  'marketing.developers.boundary.title': 'La frontera del servicio',
  'marketing.developers.boundary.lead':
    'Con qué tiene que hablar otro sistema, y las reglas que se impone a sí misma.',
  'marketing.developers.boundary.conformance.title':
    'FHIR R4, anunciando solo lo que puede responder',
  'marketing.developers.boundary.conformance.body':
    'La declaración de conformidad se genera desde el mismo registro que sirve el enrutador, así que no puede separarse de la implementación. Un parámetro de búsqueda aparece solo cuando el repositorio detrás de él realmente puede responderlo, y un parámetro codificado solo cuando el enum del dominio y el conjunto de valores FHIR coinciden uno a uno. Donde un mapeo perdería información, el parámetro está ausente y la pérdida queda a la vista en lugar de esconderse detrás de un filtro que funciona a medias.',
  'marketing.developers.boundary.relational.title': 'Relacional por debajo, FHIR en el borde',
  'marketing.developers.boundary.relational.body':
    'PostgreSQL a través de Prisma es la fuente de verdad; FHIR es una proyección en la frontera, y cada mapeador se entrega con pruebas de ida y vuelta. Ese es el intercambio registrado en la segunda decisión de arquitectura: una superficie de búsqueda más pequeña en el borde, comprada con un esquema sobre el que el SQL común y las herramientas comunes pueden razonar.',
  'marketing.developers.boundary.middleware.title': 'Una cadena de middleware, en un solo orden',
  'marketing.developers.boundary.middleware.body':
    'Un identificador de solicitud, luego autenticación, luego alcance por organización, luego política, luego auditoría. A los repositorios se les entrega un recolector de auditoría con el alcance de la solicitud y no pueden funcionar sin uno, así que el aislamiento entre organizaciones y el registro de accesos son propiedades de la cadena y no cosas que cada manejador recuerda. Las fallas regresan como documentos de problema, así que un error se puede analizar en lugar de ser una cadena de texto.',
  'marketing.developers.boundary.workspaces.title':
    'Espacios de trabajo tipados, no una aplicación con carpetas',
  'marketing.developers.boundary.workspaces.body':
    'Tipos compartidos, los mapeadores FHIR, el esquema y el cliente de Prisma, la biblioteca de componentes del sistema de diseño, y paquetes de dominio para los conjuntos de transacciones electrónicas de reclamaciones, el motor de formularios, la terminología propia y los adaptadores de socios versionados. Cada uno tiene sus propias pruebas y su propia frontera.',
  'marketing.developers.agent.title': 'La capa agéntica opcional',
  'marketing.developers.agent.lead':
    'Existe un asistente, está apagado a menos que quien despliega lo encienda, y las restricciones sobre él se escribieron antes de construirlo.',
  'marketing.developers.agent.separable.title': 'Apagado de fábrica, y realmente separable',
  'marketing.developers.agent.separable.body':
    'El asistente es un contenedor aparte que la invocación por defecto no inicia. Cada capacidad que puede alcanzar tiene una ruta determinista en la interfaz, así que una caída del servicio que quien despliega haya configurado le cuesta a la clínica su asistente y nada más. Una configuración sin modelo es un objetivo de prueba de primera clase, no una idea tardía.',
  'marketing.developers.agent.tools.title': 'Las herramientas son clientes comunes de la API',
  'marketing.developers.agent.tools.body':
    'Ninguna herramienta recibe un cliente de base de datos. Las herramientas llaman a la misma API HTTP con las credenciales de la persona que preguntó, así que el alcance por organización, las verificaciones de política y las escrituras de auditoría las impone el middleware que ya existe y no una segunda implementación que pueda separarse de él.',
  'marketing.developers.agent.outbound.title': 'No puede hablar hacia afuera',
  'marketing.developers.agent.outbound.body':
    'No hay ninguna herramienta de comunicación saliente de ningún tipo: ni correo, ni mensajes, ni webhooks, ni descarga de URL. El acceso a expedientes privados, más la exposición a texto no confiable, más la capacidad de enviar cosas hacia afuera es la combinación contra la que vale la pena diseñar, y la tercera se vuelve estructuralmente imposible en lugar de solo estar prohibida.',
  'marketing.developers.agent.retrieval.title':
    'Recuperación, no generación, para el contenido clínico',
  'marketing.developers.agent.retrieval.body':
    'Una frase que no puede llevar una cita a la fila y el campo de un registro no se emite, y eso lo impone un resolvedor en código y no una instrucción al modelo. Ningún peso, ningún Python y ninguna inferencia se incluyen en el despliegue. Un servicio remoto lo nombra, lo configura y lo paga quien despliega, y encender uno exige un reconocimiento aparte que nombra el acuerdo bajo el cual opera.',
  'marketing.developers.agent.adrLink':
    'Lea ADR-0004 y ADR-0005, que fijan y luego enmiendan de forma acotada estas reglas',
  'marketing.developers.bar.title': 'El nivel que un cambio tiene que alcanzar',
  'marketing.developers.bar.lead':
    'Cada solicitud de cambios se analiza en cobertura, calidad de código, vulnerabilidades conocidas, secretos filtrados, licencias de dependencias y procedencia de la cadena de suministro. Nada se integra solo por una palomita verde: el nivel es un tablero limpio.',
};
