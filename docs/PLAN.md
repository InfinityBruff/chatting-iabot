# Plataforma propia: plan de implementación

## Alcance y evidencia

Fecha: 29 de octubre de 2026. Inventario inicial basado en las herramientas de la integración OnlyX disponibles en esta sesión; no es una auditoría completa de la aplicación ni de su código. La búsqueda de documentación devolvió enlaces de su índice y avisó de que su búsqueda en vivo no estaba disponible.

Referencias de documentación para validar antes de implementar el conector:
- https://docs.onlyx.ai
- https://docs.onlyx.ai/concepts/conversations
- https://docs.onlyx.ai/guides/ai-settings
- https://docs.onlyx.ai/concepts/ai-persona

La integración disponible expone `set_conversation_ai`: activar/desactivar IA por conversación. Hay que verificar si esta función está accesible en la interfaz/plan del usuario. No debe presentarse como una capacidad totalmente ausente de OnlyX.

## Inventario inicial

| Módulo | Evidencia en integración OnlyX | Estado en IABOT |
|---|---|---|
| Workspace y creadoras | Workspace, perfiles, conexión y estado de sincronización | Pendiente |
| Bandeja y equipo | Conversaciones, mensajes, leídos, intervención humana, devolver a IA | Solo demostración local |
| IA por conversación | Activar/desactivar un chat y activar globalmente por creadora | Selector local; sin integración |
| Persona | Identidad, estilo, límites, preferencias y derivaciones | Editor inicial; sin IA |
| Revisión y seguimiento | Borradores, revisión humana y seguimientos | Pendiente |
| Fans y CRM | Perfiles, notas, segmentos, suscripción y gasto | Fans ficticios |
| Biblioteca | Medios, duración y organización | Pendiente |
| Colecciones y niveles | Carpetas, orden, precios y medios asociados | Pendiente |
| Bienvenida y campañas | Mensaje de bienvenida, enlaces de seguimiento y pruebas gratuitas | Pendiente |
| Analítica | Ingresos, transacciones, atribución y estadísticas | Pendiente; sin métricas reales |

## Mejoras solicitadas

1. Modo global todos/selección/pausa y selección múltiple de fans con exclusiones claras.
2. Instrucciones y estilo editables: tono, expresiones, longitud, puntuación y palabras preferidas/prohibidas.
3. Tiempos configurables por creadora y, posteriormente, por conversación. Pausas para lectura/visualización sin afirmar que un vídeo pregrabado se está grabando en directo.
4. Versiones de configuración y ejemplos corregidos; probar antes de activar. Las correcciones no reentrenan automáticamente el modelo.

## Arquitectura propuesta (todavía sin implementar)

- Interfaz web con bandeja, CRM, ajustes, contenido y estadísticas.
- API de servidor con autenticación, roles de administrador/supervisor/operador y aislamiento por workspace.
- PostgreSQL para creadoras, fans, conversaciones, mensajes, configuración versionada, borradores y auditoría.
- Almacenamiento de archivos separado de la base de datos.
- Worker y cola persistente para esperas, cancelaciones, reintentos y envíos con idempotencia.
- Adaptador de integración intercambiable. El primer conector puede usar OnlyX si el usuario elige esa vía; una plataforma independiente requiere verificar otro acceso autorizado a las cuentas. No se ha confirmado una API directa de OnlyFans para este proyecto.
- Motor de asistente propio con memoria por fan, instrucciones por creadora, borradores y revisión. Viabilidad del modelo/proveedor y usos admitidos por validar antes de integrarlo.

## Siguiente fase concreta: backend de prueba

Primero construir autenticación, almacenamiento compartido y API de conversaciones/configuración sobre un conector simulado. Después validar un conector real en modo lectura y la generación de borradores. Los envíos reales se incorporarán tras probar estos pasos.

Criterios de aceptación:
- Dos usuarios autorizados ven las mismas conversaciones y configuración.
- El rol de operador no puede cambiar la configuración global.
- En modo selección solo los fans seleccionados resultan elegibles; en pausa ninguno.
- Una toma de control humana cancela borradores/envíos pendientes del asistente para ese chat.
- Cada borrador conserva la versión de configuración utilizada.
- Las esperas se validan y sobreviven a un reinicio del servidor.
- Un reintento no duplica un envío; una entrega sin confirmar no se reenvía automáticamente.
- El historial registra quién cambió qué y cuándo.

## Decisiones pendientes

- Repositorio GitHub de destino.
- Reproducir funciones y flujo con diseño propio, o acercar también la distribución visual: para comparar pantallas hace falta acceso a la interfaz de referencia.
- Usar OnlyX como conexión inicial o construir una plataforma independiente.
- Proveedor de IA y alojamiento del backend.

GitHub versiona y coordina el desarrollo; por sí solo no aporta conexión a cuentas, motor de IA ni servidor de aplicación.

## Entrega 0.2 · React

Migrado el prototipo a React y Vite con componentes separados, pruebas de reglas de activación y selección múltiple de fans. La persistencia sigue siendo local; backend, autenticación de equipo, IA e integraciones permanecen pendientes.

## Entrega 0.3 · BRUFF Workspace

Interfaz de tres columnas, gasto destacado por fan, estrellas sobre el avatar con cinco umbrales configurables, ficha con desglose de gasto, suscripción, compras, actividad y notas editables. BRUFF se controla globalmente y por fan, con pausa manual prioritaria. Campañas para todos/seleccionados/en línea con vista de destinatarios y guardado de borradores locales. Respuestas rápidas y adjuntos ficticios para probar el flujo.

Origen de la información: datos de ejemplo. Estrellas calculadas solo con gasto de la cuenta, sin afirmar acceso al gasto con otras modelos. No se ha inspeccionado el chat de OnlyFans: la política del navegador ha bloqueado su lectura. Ninguna configuración activa IA ni envíos reales.

## Entrega 0.4 · 29 octubre 2026 — Producto independiente

Decisión del usuario: producto independiente, sin depender de OnlyX para operar. El conector OnlyX se consultó únicamente para documentación; no se han leído ni modificado cuentas reales.

Investigación pública de esta iteración:
- https://help.creatorhero.com/en/articles/10500000-fan-info — notas, perfil, idioma, zona horaria, métricas PPV y origen del fan.
- https://help.creatorhero.com/en/collections/12037234-chat-tools-enhancements — resúmenes, traducción y herramientas de chat.
- https://onlymonster.ai/faq — cuentas, permisos, segmentación, plantillas y reparto de bandejas.
- https://docs.onlymonster.ai/changelog/changelog-2026 — evolución de filtros y métricas.
- https://onlyx.ai/ — personalidad, memoria, límites y configuración por creadora.
- La búsqueda del conector OnlyX solo devolvió un índice; no funcionó la búsqueda en vivo. Las páginas de conceptos no fueron accesibles por web en esta iteración. No se inspeccionaron áreas privadas ni código propietario. El acceso previo a la página de OnlyFans fue bloqueado; no se reintentó.

Implementado y verificable localmente:
- Navegación con PRO MESSAGE, BRUFF IA, Cuentas, Campañas, Equipo, Biblioteca, Analítica y Configuración.
- Configuración independiente de BRUFF por cuenta y pausa de agencia. Todos/selección/pausa; excepciones manuales por fan. Activar todos de una cuenta retira sus excepciones. Los cambios de una cuenta no mutan otra.
- Personalidad, tono, identidad, instrucciones, idioma, emojis, ritmo, descansos, seguimientos, revisión, memoria y límites comerciales guardados por cuenta. Solo elegibilidad y estrellas tienen efecto operativo hoy; no hay generación ni scheduler de mensajes.
- Fichas de trabajadores con correo, rol, cuentas, permisos y comisión; estados preparados/suspendidos. No envía invitaciones, no crea credenciales ni aplica seguridad real.
- Plantillas por cuenta disponibles desde el chat, edición y archivo.
- Analítica derivada de datos demo, exportación JSON y calculadora de comisiones sin atribución ni pagos reales.
- Ficha de fan con campos manuales de nombre preferido, cumpleaños, zona horaria, origen, intereses y límites.
- Registro local de cambios y exportación de copia local. No es una auditoría de seguridad.
- Migración conserva fans, notas, campañas y datos previos.

Pendiente por prioridad para siguientes ejecuciones horarias:
1. Persistencia de borradores por conversación y protección frente a perder ediciones al navegar.
2. Restauración de archivos, edición de campañas y filtros/segmentos por cuenta; no fingir envíos.
3. Backend de identidad y base compartida: seleccionar servicios con el usuario, modelar workspace/roles/RLS, invitaciones de un solo uso y contraseña fuera del cliente. Los permisos deben comprobarse en servidor.
4. Adaptador independiente autorizado a OnlyFans: verificar una vía soportada, su alcance y disponibilidad. No extraer sesiones ni pedir contraseñas por chat. No afirmar conexión directa sin validación.
5. Motor BRUFF con proveedor compatible, cola, revisión, límites, cancelación al tomar control humano e idempotencia. No activar en fans reales sin instrucción explícita y pruebas.
6. Atribución de ventas por trabajador, períodos y liquidación real una vez haya transacciones verificadas.
7. Biblioteca de medios real, compras completas, historial PPV, automatizaciones, zonas horarias y segmentación a partir de datos conectados.

No marcar producto completo mientras falten identidad, correo, conexión real y motor IA. Las ejecuciones horarias deben entregar avances comprobados, evitar cambios cosméticos repetitivos y pedir decisiones solo cuando sean necesarias. GitHub destino confirmado: InfinityBruff/chatting-iabot. Hosting privado Sites confirmado.

## Entrega 0.4.1 · Borradores por conversación

- El texto, emojis y adjuntos de ejemplo se guardan como borrador en el fan de su cuenta. Cambiar de conversación, modelo o apartado y recargar conserva el borrador en este navegador.
- La lista muestra una vista previa «Borrador» y un filtro específico. Las plantillas se añaden al texto existente en lugar de sustituirlo.
- Guardar el mensaje local añade el mensaje y limpia únicamente su borrador en una sola actualización. No envía mensajes reales.
- Tres pruebas nuevas cubren aislamiento por cuenta y fan, persistencia serializada, adjuntos, limpieza atómica, entradas inválidas y mensajes vacíos. Total: 18 pruebas y compilación correctas; sin nueva verificación visual en esta iteración.
- Referencia pública consultada: https://www.creatorhero.com/hero-copilot — distingue preparación/guardado de borradores y acciones aprobadas. No se deduce de esta fuente que conserve borradores de conversación; esa mejora responde al pendiente propio de BRUFF.
- Sigue pendiente la protección de cambios sin guardar en formularios de configuración y notas, restauración de archivos y edición de campañas. Persistencia local, sin sincronización multiusuario ni garantía frente a escrituras simultáneas entre pestañas.

## Entrega 0.4.2 · Archivo recuperable por cuenta

- Biblioteca y Campañas incluyen un apartado desplegable de elementos archivados con contador, contenido y botón Restaurar.
- Recupera también los registros archivados con versiones anteriores, conservando texto, audiencia, identificador y fecha. No borra definitivamente ni envía mensajes.
- Archivar/restaurar comprueba cuenta e identificador, evita duplicados y conserva ambas versiones ante un conflicto. Los registros de otra modelo permanecen intactos.
- 21 pruebas y compilación correctas. Tres pruebas nuevas cubren restauración, aislamiento, persistencia serializada, idempotencia y conflictos; sin verificación visual nueva en esta iteración.
- Referencia oficial consultada: https://docs.onlymonster.ai/changelog/changelog-2025 menciona archivado automático de campañas detenidas. BRUFF implementa archivado manual y recuperación local como mejora propia, sin atribuir a OnlyMonster un comportamiento de restauración no verificado.
- Próximo avance: edición de borradores de campañas conservando su identidad y selección de destinatarios; después protección de cambios en formularios. Backend y conexiones reales siguen pendientes.

## Entrega 0.4.3 · Editar campañas sin duplicarlas

- Cada borrador activo tiene «Editar borrador». Conserva identidad y fecha de creación, registra actualización y sustituye solo la campaña de su cuenta.
- Al editar se conserva por defecto la audiencia guardada; cambiar a todos/en línea recalcula explícitamente. Selección manual disponible dentro del editor, sin depender de la selección temporal de la bandeja.
- Excluye destinatarios que ya no pertenecen a la cuenta y muestra aviso; exige al menos un destinatario válido. No recrea campañas archivadas o desaparecidas durante la edición.
- Cancelar o pulsar Escape con cambios muestra «Seguir editando / Descartar cambios». Nuevas campañas usan UUID en lugar de milisegundos.
- 24 pruebas y compilación correctas; tres pruebas nuevas cubren identidad, aislamiento, validación y ausencia de envíos. No se hizo una nueva prueba visual en esta iteración.
- Consultada https://docs.onlymonster.ai/ai-magic-assistant/boosting-fan-engagement-with-ai-powered-priority-mass-messages sobre revisar y adaptar texto para la audiencia. El mantenimiento de identidad y destinatarios es implementación propia.
- Pendientes: protección de formularios restantes y validación visual completa de los últimos flujos. Backend, identidad, correo, IA y conexión autorizada siguen sin configurar.

## Entrega 0.4.4 · Protección de notas y ajustes pendientes

- Antes de cambiar de fan, cuenta o apartado, o cerrar la ficha, las notas/contexto y ajustes BRUFF sin guardar muestran «Seguir editando / Descartar y continuar».
- El diálogo conserva el editor y el destino solicitado, atrapa el foco con dialog nativo y permite cancelar con Escape. Recargar/cerrar solicita la advertencia nativa del navegador cuando este la admite; no es una garantía de persistencia ante cierre forzado.
- No guarda ni aplica automáticamente instrucciones pendientes. Los borradores de mensajes siguen su guardado local independiente.
- 27 pruebas y compilación correctas. Verificado en navegador: editar nota, intentar abrir BRUFF, cancelar conservando el texto y descartar continuando al destino. No se alteraron datos reales.
- Referencia consultada: https://help.creatorhero.com/en/articles/10500000-fan-info para notas y campos manuales. La protección contra pérdida de cambios es una mejora propia, no una función atribuida a esa fuente.
- Pendiente extender protección a editores de equipo/plantillas y probar flujos de archivo/campañas visualmente. Backend y servicios reales siguen pendientes.

## Entrega 0.4.5 · Protección de equipo y biblioteca

- Equipo y plantillas usan el mismo aviso de cambios sin guardar. Protege cancelar/cerrar, abrir otra ficha o plantilla, crear una nueva mientras se edita, archivar desde biblioteca y cambiar de apartado/cuenta.
- Abrir un formulario sin modificarlo no genera advertencia; volver exactamente a los valores iniciales la elimina. Guardar correctamente cierra el editor sin pedir descartar.
- Los borradores permanecen aislados: la ficha de equipo se reinicia al cambiar de cuenta después de confirmar; no se envían invitaciones ni se aplican permisos reales.
- 29 pruebas y compilación correctas. Dos pruebas nuevas validan cambios de permisos/comisiones, reversión y comparación de plantillas. Sin nueva comprobación visual en esta iteración.
- Consulta oficial de referencia: https://docs.onlymonster.ai/changelog/changelog-2026 — mejoras de edición y organización de plantillas. No se atribuye el aviso de cambios de BRUFF a ese producto.
- Siguiente trabajo: validación visual conjunta de biblioteca, archivo, campañas y equipo; corregir fallos antes de ampliar. Después avanzar en diseño implementable del backend independiente, identidad y permisos sin crear servicios de pago ni conexiones reales silenciosamente.

## Entrega 0.5 · Vault por cuenta

Petición explícita: apartado Vault conectado al baúl de OnlyFans, con mejor búsqueda de todas las carpetas. Implementada la interfaz, no la conexión.
- Nuevo acceso Vault separado de Biblioteca de plantillas. Catálogos demo por modelo, carpetas con contadores, contenido sin carpeta, favoritos persistentes, filtros de formato y búsqueda por título/etiqueta/carpeta, orden y vistas lista/cuadrícula.
- Inspector de metadatos con origen y estado de conexión claros. No hay miniaturas ni archivos reales, reproducción, descarga o envío simulados.
- Conexión a OnlyFans pendiente de adaptador independiente autorizado. No usar OnlyX como backend. Al integrar se requerirá enumeración paginada completa de carpetas/medios, identidad de cuenta, estados de carga/error y sincronización real; no mostrar datos demo como importados.
- 32 pruebas y compilación correctas; aislamiento, búsqueda y favoritos cubiertos. La búsqueda de carpetas es local sobre el catálogo demo.

## Entrega 0.6 · Dashboard inspirado en la referencia abierta

- Revisada visualmente la pestaña Dashboard de OnlyX, incluyendo ingresos, Hoy, Fans, pendientes y tabla de modelos. Se reproduce la estructura con código React propio y marca BRUFF; no se copia código ni información privada del servicio.
- Nuevo apartado inicial Dashboard: alcance cuenta actual/todas explícito, neto/bruto, 7/30/90 días y fechas personalizadas, comparación anterior, agrupación día/semana/mes, barras con detalle, acumulados horarios, nuevos/activos, pendientes con acceso al chat correcto, tabla ordenable, selección de columnas y CSV.
- Histórico sintético independiente de las fichas, identificado como demo. No hay importación de OnlyX, OnlyFans ni conexiones nuevas. El neto aplica una deducción ilustrativa del 20%, no una liquidación contable real. La muestra abarca 90 días; comparaciones anteriores a ella carecen de datos.
- 35 pruebas correctas y compilación. Cubiertos aislamiento entre cuentas incluso con IDs de fan repetidos, conciliación de barras y tabla, límites temporales y CSV. Verificación visual local de filtros, comparación y detalle de transacciones; verificado salto desde el resumen de todas las cuentas al chat de Alex en Luna. Sin nueva prueba específica de vista móvil.
- Conexiones independientes, datos reales e identidad siguen pendientes. El dashboard no activa BRUFF ni envía mensajes.

## Entrega 0.7 · Analítica con siete informes

- Petición directa del usuario: reproducir Analytics de la pestaña OnlyX. Se observaron Hoy, Ingresos, Embudo, Retención, Fans, Ventas de contenido y Actividad del chat. Implementación React propia, sin copiar datos privados ni usar OnlyX como backend.
- Subnavegación, cuenta/todas, fechas, neto/bruto, comparativas, gráficos con detalle, tablas con búsqueda/orden/columnas/paginación/CSV. Embudo acumulativo de ocho etapas y cohortes semanales con semanas inmaduras diferenciadas de cero. Se conserva Resumen y comisiones anterior.
- Atribución a BRUFF, precios ofertados, archivos y actividad son ejemplos explícitos, no acciones del asistente. Métricas simplificadas documentadas: respuesta media, compradores repetidos dentro del periodo; no se afirma equivalencia con fórmulas propietarias. Histórico sintético compartido con Dashboard, independiente de ficha del fan.
- 38 pruebas y compilación correctas; comprobados en navegador los siete informes y su distribución. Pruebas de conciliación, aislamiento, embudo posterior al alta y cohortes incompletas. La conexión autorizada independiente y las estadísticas reales siguen pendientes.

## Auditoría 0.7.1 · 30/10/2026

- Plan vigente: docs/PRODUCTION-PLAN.md. Usuario confirma login propio con correo/contraseña para trabajadores, sin ChatGPT; adaptar despliegue/autenticación antes del piloto real.
- Corregida identidad compuesta cuenta/fan al marcar leídos, restaurar estado y migrar ejemplos; impedida atribución del perfil financiero demo de Luna a otra cuenta por ID coincidente.
- pnpm test incluye servidor; 47 pruebas y build correctos. Cuatro regresiones nuevas de aislamiento/recarga. No se considera el prototipo listo para producción.
- Siguiente: fase 2 del plan, identidad/backend. Proveedor OnlyFans, alojamiento/auth compatibles y proveedor IA aún pendientes. Sin envíos ni asistentes reales activados.

- 31/10: nombres persistentes en Equipo/invitaciones, edición del nombre propio y auditoría histórica. Migración 005 aplicada y Edge actualizada; 80 pruebas app + 54 PostgreSQL. Send: Nombre en mensajes demo, sin atribuirlos a trabajadores reales. Integración de remitente real pendiente del backend de envío.

## 31/10 — Conector real de lectura OFMAPI
- Implementados y desplegados en Supabase: `bruff-live`, RPC de modelos autorizadas y autorización por operación; migración 006.
- Registradas tres vinculaciones privadas. Ningún permiso nuevo de trabajadores ni envíos activados.
- Interfaz real separada de demo: bandeja/historial paginados y analíticas de movimientos USD por intervalo UTC, con alcance parcial indicado.
- Pendiente verificación autenticada y conciliación; Vault, envíos, adjuntos y motor IA siguen pendientes.

Verificación autenticada 31/10: las tres modelos devuelven bandejas y transacciones reales en BRUFF publicado. Historial abierto y paginación de Valen comprobada (10 → 28 conversaciones). Desglose financiero distingue bruto/total, recuentos y páginas cargadas. Acceso anónimo al Edge devuelve 401. Sites privado y Cloudflare publicados. No se enviaron mensajes ni se concedieron accesos nuevos a trabajadores. 93 pruebas de aplicación y 64 PostgreSQL. Conciliación completa y sincronización continua siguen pendientes.

## 31/10 — Envío manual y baúl preparados
- Compositor real con revisión, reintentos del mismo intento y adjuntos firmados por cuenta; subir foto/vídeo/audio hasta 10 MB, máximo 10 adjuntos.
- Baúl real por modelo: carpetas, filtros, búsqueda, previews y selección para mensajes. Sin asignar accesos nuevos a trabajadores.
- Usuario autoriza Read & write en OFMAPI y activación Supabase; clave actualizada, función actualizada y flag manual guardado. Migración 007 ejecutada, comprobar resultado y QA de publicación.
- 100 pruebas app + 72 comprobaciones PostgreSQL; build y QA local correctos. Sin mensajes reales de prueba ni bot activado. Detalle y pendientes en PRODUCTION-PLAN.md.

## 31/10 — Identidad y clasificación visual
- Logo BRUFF del usuario y tema grafito/blanco/azul en navegación, acceso, módulos reales y demo.
- Cinco estrellas permanentes: 6, >17, >35, >60, ≥95 USD; diamante >200. Gasto histórico por modelo mediante OFMAPI, desconocido sin estimar.
- 106 pruebas, revisión de navegación y chat móvil; detalle y límites en PRODUCTION-PLAN.md.

## 31/10 — Próxima entrega acordada (pendiente de implementación)
1. Analíticas: resumen de ingresos/neto/operaciones, evolución visual, desglose por origen y explicación de indicadores. Distinguir totales de período de páginas parciales; no estimar datos ausentes.
2. Estrellas: más pequeñas, centradas encima del avatar y separadas del nombre; conservar los umbrales y colores acordados.
3. Baúl: selección múltiple de fotos/vídeos, marcas visuales, contador, quitar selecciones y botón «Añadir al mensaje · X archivos»; máximo actual 10 adjuntos.
4. Compositor: vistas previas de todos los adjuntos, identificación de vídeos, quitar individualmente, precio total o «Gratis» y mensaje acompañante editable.
5. Confirmación: modelo, fan, texto, archivos y precio juntos; añadir desde baúl no envía. Mantener confirmación explícita e idempotencia.
6. Investigar normas oficiales de OnlyFans y preparar términos/contextos de revisión para mensajes. No presentar una lista interna de BRUFF como lista oficial exhaustiva ni habilitar un filtro sin acordar su comportamiento.

El usuario ha pedido guardar la lista y añadir requisitos antes de implementar esta entrega.

## 31/10 — Protección previa de mensajes salientes
- Lista interna estricta BRUFF: 411 entradas; no es un diccionario oficial de OnlyFans. Se comprueban palabras/frases completas normalizadas. Puede producir falsos positivos.
- Solo mensajes salientes de propietario/trabajadores. Los mensajes recibidos de fans no activan alertas ni suspensiones.
- Servidor revisa al preparar y nuevamente al confirmar, antes de llamar a OFMAPI. Deniega el intento y registra actor, modelo, fan ID, texto, términos y hora. Fallos de validación impiden enviar.
- Trabajador suspendido en toda su agencia hasta revisión del propietario en Equipo. Propietario registra alerta y no envía ese texto, pero puede corregir sin suspensión. Solo propietario puede ver registros y levantar suspensión.
- No cancela solicitudes ya despachadas, no analiza imágenes/audio ni clientes externos. Notificación dentro de Equipo, no correo.
- Migración 008 aplicada; función bruff-live actualizada. 109 pruebas de aplicación y 102 comprobaciones PostgreSQL; alerta y desbloqueo comprobados con datos locales ficticios, sin enviar a fans reales.

## Pendiente 7 — Interruptores BRUFF por modelo y por fan (no implementar todavía)
El usuario pide añadirlo a la lista, sin activar ni implementar aún:
- Control general en la bandeja de cada modelo: apagado (todos manuales), solo fans seleccionados, o todos los fans de esa modelo.
- Interruptor individual debajo de cada fan y accesible en la conversación: incluir/excluir ese fan sin modificar otras conversaciones.
- En modo todos, poder excluir fans concretos; en modo seleccionados, incluir únicamente los elegidos. Indicar si «todos» incluye nuevos fans y explicar la prioridad de las excepciones.
- Cada modelo conserva su propia configuración, totalmente independiente: una puede tener todos, otra solo algunos y otra ninguno.
- Mostrar claramente estado efectivo, origen de la configuración y diferencia entre selección guardada y bot realmente operativo. No afirmar que está chateando hasta conectar y habilitar el motor.
- Pausar una modelo debe detener su automatización sin borrar las selecciones individuales; mantener aislamiento de agencia/modelo/fan y permisos.

## 31/10 — Entrega de las siete mejoras
- Analíticas reales: evolución SVG accesible por categoría, mínimo/máximo y tabla exacta; totales de proveedor separados de subtotales paginados. Ausencias no estimadas; no llamar neto al total no tipado.
- Estrellas compactas de 9 px encima del avatar, separadas del nombre. Umbrales sin cambios.
- Baúl: selección múltiple entre páginas/filtros, marcas, contador, exclusión de adjuntos ya presentes, máximo conjunto 10 y añadir explícito.
- Compositor y revisión: vistas previas foto/vídeo/audio según disponibilidad, quitar individualmente, precio conjunto/Gratis, texto, modelo y fan. Idempotencia y doble validación de seguridad conservadas.
- BRUFF: preferencias persistentes por agencia/modelo, apagado/seleccionados/todos (incluye futuros), excepciones manual/BRUFF/heredar por fan, solo propietario/manager editan. Apagar conserva selecciones. Versionado rechaza escrituras obsoletas. Migración 009 aplicada en Supabase.
- Motor NO conectado: los interruptores guardan preferencias; no inician automatización ni envían mensajes. Conectar y verificar el motor es trabajo posterior.
- QA local con datos ficticios: dos adjuntos, pago y gratis, confirmación, dos modelos independientes, fan individual. 110 pruebas aplicación y 121 comprobaciones PostgreSQL. No se enviaron mensajes reales ni se cambiaron preferencias de modelos reales durante QA.

## 31/10 — Filas de fans alineadas
Columna fija de 52 px para avatar, estrellas de 7 px sin separación y 14 px de margen al nombre. Interruptor compacto bajo el avatar con etiqueta BRUFF; reglas detalladas conservadas en la conversación. Verificado visualmente con nombres largos y cambio del interruptor en datos ficticios. El diagnóstico previo de acceso 403 sigue pendiente de la URL exacta del usuario.

## 31/10 — Resumen financiero por modelo
Selector destacado de modelo en Analíticas; último mes natural completo, últimos 30 días, mes actual e intervalo personalizado. Resumen mensual con bruto y total informado; mensajes/PPV, tips, suscripciones, publicaciones, directos y referidos cuando el proveedor los entregue. Histórico mensual mediante earnings/monthly y saldos mediante balances: lectura con permiso analytics y revalidación tras la respuesta. Totales históricos solo si cada mes tiene importe explícito y etiquetas únicas; ausencia no es cero. No se interpreta total como neto. Fuente oficial: https://ofmapi.com/openapi.json (consultado 31/10/2026). Contrato mensual flexible: formatos no reconocidos permanecen no disponibles, pendiente conciliación autenticada. UI comprobada con dos modelos ficticias, pruebas de fechas/aislamiento/normalización; pnpm check 115 pruebas. Actualización de Edge autorizada expresamente y desplegada. El diagnóstico anterior de 403 desde la dirección del usuario no se considera resuelto por este cambio.

## 01/11 — Navegación operativa basada en OnlyMonster
Inspección autenticada de Accounts y Dashboard (menú expandido, filtros, tarjetas y tablas) y ChatSpace vacío, sin modelos conectadas en la referencia. Al abrir Members redirige a Sign In: se ha solicitado al usuario volver a iniciar sesión para continuar la inspección. No se ha podido observar una conversación real de OnlyMonster.

Primera entrega: shell BRUFF con grupos plegables, rail compacto, cabecera, tabla de cuentas con búsqueda y accesos por modelo; Resumen financiero separado de Ingresos y movimientos; Equipo integrado, guía de roles y página real de alcance BRUFF. Solo módulos respaldados por funciones existentes. Permisos recalculados en cada actualización; cambiar de módulo selecciona únicamente una modelo autorizada. Backend y envío no modificados.

Pendiente de la petición de paridad: inspeccionar chats, formularios y menús no accesibles; diseñar e implementar métricas por trabajador/turnos, tráfico, plantillas reales, campañas, listas dinámicas, promociones, seguimiento automático y herramientas IA con contratos/datos/motor propios. No se afirma paridad funcional ni se añaden botones ficticios para esos módulos. La configuración de alcance sigue sin motor de envío automático.

## 01/11 — Chat basado en fotografía proporcionada
Aplicada composición de la captura: rail estrecho, lista plana compacta, gasto sobre avatar, burbujas rectangulares azules/grises, herramientas en cabecera, emojis y herramientas debajo del borrador, tarjetas laterales de gasto/ficha. Estrellas y controles BRUFF conservados. Interfaz en español.
Funciones nuevas operativas sobre datos cargados: fijar/desfijar (solo memoria de esta sesión/modelo), filtro fijados y propinas, búsqueda de texto en historial, galería de archivos cargados, lista de fans por gasto, respuestas rápidas neutras/personalizadas y nombre del fan al borrador. Envío, revisión, precio, selección múltiple y seguridad existentes conservados.
No paridad funcional completa: traducción de mensaje/borrador, generación de perfil/sugerencias IA, programación y nueva conversación muestran aviso de función sin conectar. La ficha no inventa bio, cumpleaños, ubicación, preferencias, notas, suscripción ni conexión en línea. Avatares no entregados por el contrato actual: iniciales. «Mayor gasto» no se etiqueta como «en línea». Los botones foto/vídeo/audio/GIF abren el flujo real de adjuntar/subir; no grabación ni catálogo GIF externo.
Pendiente completar integración de esas capacidades y verificar contratos de datos/permisos antes de habilitarlas. No afirmar que todo lo fotografiado ya funciona ni que sea una réplica idéntica al píxel.

## 01/11 — Indicador verde de presencia
Preparados punto verde sobre avatar y etiqueta «En línea» en lista, hilo y ficha, solo ante confirmación positiva de followings?filter=all_online&pages=1 (contrato público OFMAPI). Coincidencias limitadas a IDs de la página de inbox autorizada. Ausentes, errores o usuarios no seguidos son desconocidos, nunca offline. Caduca a los 60 segundos, comprobado cada 5s localmente; actualizar conversaciones renueva consulta. No se infiere de mensajes ni gasto. 119 pruebas correctas. Despliegue Edge preparado pero bloqueado por revisión automática: requiere confirmación específica de sustitución productiva inmediata sin reversión automática.

## 01/11 — Presencia ampliada y diseño negro/rojo
La versión inicial de presencia fue desplegada con confirmación explícita del usuario. Se amplía ahora a pages=-1 (todas las páginas del proveedor) y operación presence independiente con autorización y revalidación por modelo. Frontend consulta cada modelo con permiso chat cada 45 segundos, solo en pestaña visible, sin solapar consultas por modelo. Fallos invalidan el estado y nunca significan desconexión. El aro verde caduca a los 60s. Scope OFMAPI: usuarios seguidos; NO existe garantía de todos los fans ni se deduce estado de mensajes. Una respuesta parcial o indisponible se muestra explícitamente. Fuente https://ofmapi.com/openapi.json.
Tema negro y acentos rojos, logo original en cabecera y menú, navegación expandida al entrar y autoentrada con una agencia verificada. Trabajadores agrupa equipo/permisos y roles. Se ven opciones restringidas con 🚫 deshabilitadas; resolución de vistas y backend mantienen autorización. Presencia nunca activa BRUFF ni envía mensajes.
QA local con datos ficticios: aro visible en fan 1 de modelo A y fan 2 de modelo B, sin mezcla; navegación Chatter muestra restricciones; 122 pruebas y build correctos. Captura /private/tmp/bruff-rojo-presencia-prueba.png. No es evidencia de fans reales en línea.

Ajuste de latencia: consulta de presencia exclusivamente en segundo plano; inbox no espera a todas las páginas. Frontend publicado en Sites privado y código actualizado en GitHub. Edge ampliado desplegado; ninguna garantía de presencia fuera de usuarios seguidos.

Corrección tras prueba real: pages=-1 no devolvió presencia utilizable; se sustituye por recorrido de cursores sin límite de una página, peticiones individuales autorizadas y resultados progresivos con fecha por fan. Se detectan cursores repetidos/ausentes y errores sin afirmar cobertura completa. El recorrido continúa hasta hasMore=false. Pendiente confirmar presencia real disponible del proveedor.

## 01/11 — Envío manual directo solicitado por el propietario
Eliminado el diálogo de confirmación adicional. Pulsar ENVIAR o Enter prepara y envía en una sola acción; Mayús+Enter añade línea. Se mantienen vistas previas y precio en compositor, validación de permisos, pantalla de palabras y ticket idempotente en servidor. Un error ambiguo conserva el ticket y bloquea edición hasta reintentar el mismo envío o descartar tras advertencia. No se enviaron mensajes reales durante validación.

## 01/11 — Directorio profesional de trabajadores
Tabla con nombre/correo, rol, estado, modelos y acciones; indicadores, búsqueda y filtros. Alta desde cero y edición en diálogo accesible con permisos por modelo. Eliminar usa bruff_team_update existente: membership disabled, grants vacíos, versión esperada y registro de auditoría. No borra Auth ni historial; oculta de activos y permite reincorporar. Propietario y propia cuenta protegidos. Roles/expulsiones se aplican a nuevas peticiones desde el commit; pantalla del trabajador conserva refresco de 5s. No se promete borrar datos ya recibidos ni cancelar peticiones consumadas. No migración ni nuevos permisos.
QA local con trabajadores ficticios: cambiar Chatter a Manager, eliminar (desaparece del equipo activo), consultar Sin acceso, abrir reincorporación/alta. Ningún trabajador real modificado ni correo enviado. 129 pruebas y build correctos; captura /private/tmp/bruff-trabajadores-prueba.png.

### Fotos de las modelos · 01/11/2026
Identidad visual común con foto OnlyFans, recorte circular y tamaños por contexto: selector de chats, analíticas, baúl, BRUFF IA, cuentas y permisos por modelo. Selectores muestran fotos en sus opciones; imagen fallida/ausente usa iniciales, sin inventar fotos. Perfiles consultados por ID autorizado y agencia, solo en memoria; respuesta tardía descartada al cambiar ámbito. El endpoint profile expone avatar HTTPS y datos mínimos; permite identidad a analistas mediante su permiso analytics sin conceder chats, y revalida tras respuesta. Fuente: https://ofmapi.com/openapi.json, MeResponse.avatar. Edge actualizado desde panel. 131 pruebas y build correctos; QA local con imagen ficticia comprobó selección y fallback. Pendiente comprobación autenticada de las tres fotos reales después de recargar publicación. No se enviaron mensajes ni se modificaron roles.

## Selector de modelos sin recortes · 01/11/2026
Las tres modelos y sus fotos están confirmadas en producción (Cuentas, opciones de Analíticas y Mensajes). Corregido recorte visual de Valen en Mensajes: overflow:auto del contenedor de controles ocultaba la tercera opción aunque existía en DOM. El contenedor permite el solapamiento solo mientras el selector está abierto y recupera el scroll al cerrar. QA local con estilos completos: tercera opción visible y seleccionable. No cambia cuentas ni permisos.

## Fotos reales de fans · 01/11/2026
Inbox conserva avatar HTTPS del proveedor en cada fan autorizado. Componente común para lista, ficha y mayor gasto, con object-fit:cover, iniciales ante imagen ausente/rota, y aro/punto verde según presencia confirmada vigente. Estrellas permanecen fuera del avatar. No se modifica origen de presencia ni permisos. 132 pruebas y compilación correctas; pendiente inspección autenticada tras publicar.

## Ficha real de fan y notas · 01/11/2026
Perfil público mediante user/{id} e historial mediante fans/{id}/subscription-history; validación de ID, permiso read por modelo y revalidación tras consulta. Sin objetos raw ni datos privados no necesarios. Historia con contrato abierto: solo campos reconocidos, ausencia explícita y aviso de parcialidad; pendiente verificar forma real de respuesta autenticada. Notas BRUFF persistentes por agencia/modelo/fan mediante RPC, permiso notes existente (propietario/manager), versión optimista y bloqueo compartido con cambios de equipo. Chatter conserva solo chat; sin ampliación de roles. Migración 010 y Edge desplegados en Supabase. 135 tests aplicación y 133 comprobaciones PostgreSQL; prueba visual ficticia confirmó guardado y aislamiento entre dos modelos. Falta comprobación autenticada tras recargar frontend. No se enviaron mensajes reales ni se activó motor BRUFF. Fuente: https://ofmapi.com/openapi.json.

## Autoría de mensajes · 01/11/2026
Mensajes salientes muestran Enviado por: nombre guardado al iniciar envío BRUFF. Registro privado por agencia/modelo/fan/ID de mensaje; actor derivado de sesión, nombre congelado y finalización solo service_role desde Edge. Cliente no puede adjudicar IDs ni autores. Reintento conserva Idempotency-Key; respuesta confirmada se reutiliza sin reenviar. Fallo al guardar autoría conserva ticket e informa fallo ambiguo, para reparar en reintento. Sin registro: by: onlyfans, incluida historia anterior a esta entrega (no prueba el cliente de origen). Si falla consulta: Autoría no disponible. Fans entrantes sin etiqueta. Migración 011 y Edge desplegados, sin cambios de autenticación. 138 tests aplicación, 145 comprobaciones SQL; QA visual con datos ficticios. No mensajes enviados a fans reales durante pruebas.

## Baúl visual y selector de adjuntos · 01/11/2026
Biblioteca común para apartado Baúl y diálogo de mensajes: navegación lateral de carpetas, búsqueda de carpetas, filtros de medios, búsqueda de contenido, orden de archivos cargados, densidades de miniatura y vista previa ampliada. Recorre todas las páginas de carpetas con deduplicación, descarte al cambiar modelo y detección de cursores repetidos. Contenido paginado con Cargar más, sin afirmar total global. Selector conserva varios archivos entre carpetas, bandeja inferior con miniaturas y quitar individual; añade solo mediante botón explícito, máximo conjunto 10 contando adjuntos existentes. Ámbito remonta por agencia/modelo. Mantiene precios, subida, permisos y envío existentes; no nuevos endpoints ni cambios de Supabase. Prueba visual con datos ficticios: tres selecciones entre carpetas, vista previa, añadido explícito y ventana 390px sin desbordamiento horizontal. Capturas /private/tmp/bruff-baul-diseno.png y /private/tmp/bruff-baul-chat-diseno.png.

## Acabados visuales · 01/11/2026
Capa final de estilos compartidos: superficies y bordes coherentes, números tabulares, contraste de formularios, estados hover/foco, sombras discretas de tarjetas y mensajes, diálogos y scrollbars. Mantiene distribución, tamaños de controles, estrellas, presencia, logo y funciones. Respeta movimiento reducido. Solo CSS e importación; sin cambios de permisos, datos o servicios. Revisión local de acceso y navegación demo; no equivale a comprobación autenticada de todos los apartados.

## Analíticas reales completas · 01/11/2026
Corregida estructura observada del histórico OFMAPI: months contiene monthlyTotal; se expande antes de sumar bruto/neto explícitos. Confirmados 29 meses en Lana durante diagnóstico. Earnings/chart devuelve total por defecto: consultas explícitas de seis categorías en lotes de dos, normalización de alias de una única serie monetaria y rechazo de filtro incompatible. Fallos de categorías son independientes y visibles; nunca sustituidos por cero. Desglose seleccionable último mes/todo el tiempo, desde el primer mes disponible; gráficos hasta 20 años desde 2016, movimientos mantienen máximo un año. Permisos analytics y revalidación posterior por agencia/modelo conservados. Diagnóstico temporal solo de claves de esquema retirado de función final. Durante el diagnóstico el editor duplicó código y causó error de arranque; recuperado sustituyendo archivo completo y verificando igualdad antes de desplegar. Sin envíos ni cambios de roles.
Referencia oficial: https://ofmapi.com/openapi.json (EarningsFilter, MonthlyEarningsResponse).

## Presencia completa por modelo · 01/11/2026
Recorrido independiente y alternado de todas las páginas de followings/all_online/type=all para cada modelo autorizada. Reintenta la página pendiente con espera progresiva y Retry-After; detecta cursor ausente/repetido y páginas repetidas sin declarar completitud. Conserva confirmaciones vigentes durante refresco, sin renovar su hora artificialmente; caducidad de 60 segundos y limpieza inmediata ante 401/403. Aislamiento por agencia y modelo también al cambiar ámbito de React. Aro verde exterior más visible sin alterar tamaño del avatar ni estrellas. Estado informa páginas, completitud o motivo de parcialidad. Límite documentado del proveedor: este endpoint cubre usuarios seguidos, no todos los fans no seguidos; no se inventa presencia. 153 pruebas y compilación correctas, incluidas 8 páginas, tres modelos, reintentos, caducidad y respuestas incompletas. Pendiente comprobación autenticada de las tres modelos tras publicar frontend. Referencia: https://ofmapi.com/openapi.json.

## Adaptación móvil conservadora · 01/11/2026
Hoja bruff-mobile.css exclusiva para anchuras de hasta 800px, importada al final. Mantiene escritorio, colores, apartados y lógica. Corrige fila residual del shell, menú y ficha alineados con cabecera de 56px, campos 16px, controles táctiles, mensajes legibles, composer con margen inferior seguro, tablas con desplazamiento y baúl adaptable. Vista horizontal de poca altura conserva envío accesible. QA local: acceso 390x844, chat con datos ficticios 390x844/320x568/740x390; sin desbordamiento horizontal, envío dentro de pantalla en las dos últimas. No equivale a prueba física de teclado Safari ni a sesión real. Captura local /private/tmp/bruff-mobile-chat.png. No cambios backend, permisos, presencia, estrellas ni envíos reales.

## Continuidad y actualización del chat · 01/11/2026
Historial y lista se conservan durante recarga de datos; merge por ID sustituye filas actualizadas y conserva páginas antiguas y su cursor. Consultas independientes por ámbito; respuesta tardía descartada y acceso 401/403 limpia datos. Sondeo visible del chat cada 5 s y lista cada 12 s tras completar consulta, sin solicitudes solapadas, con espera exponencial ante errores y actualización al volver a la pestaña. Mensajes confirmados actualizan inmediatamente la vista previa, sin regresión ante una página antigua; acepta ambos remitentes. Envío muestra comprobación/envío/confirmación y conserva el ticket de reintento; no reduce ni omite controles de moderación/autorización ni afirma entrega antes del proveedor.
Sesión Supabase persistente en este navegador por petición explícita; renovación del mismo usuario ya no desmonta workspace. Se siguen consultando membresía y permisos cada 5 s y en servidor. Selección de agencia/modelo/apartado/chat, posición de lectura disponible y borrador/ticket se guardan en sessionStorage por usuario/agencia/modelo/fan y se limpian al cerrar sesión/cambiar usuario. Adjuntos blob no conservan miniatura tras recarga, pero sí referencia preparada; tickets siguen sujetos a caducidad. Solo se restaura navegación después de verificar permisos. Puede requerir un nuevo login al cargar por primera vez esta versión desde la anterior sesión solo en memoria.
QA local aislada con adaptador ficticio: historial visible durante envío, confirmación y autoría, borrador tras recarga y separado entre dos modelos, actualización externa en historial/lista, renovación de sesión y recuperación del ticket al recargar durante envío. No se enviaron mensajes reales. Pendiente comprobar persistencia SDK con sesión productiva del usuario y latencia real de OFMAPI. Fuentes oficiales: https://supabase.com/docs/reference/javascript/auth-onauthstatechange y https://ofmapi.com/openapi.json. Captura /private/tmp/bruff-chat-fluido.png.

## 01/11 — Notificaciones y colecciones reales
Nuevas secciones de actividad y listas, sin sustituir chats/finanzas/baúl. OFMAPI notifications, lists, list detail y bookmarks. Crear/renombrar/añadir/quitar fan requieren confirmación, permiso de gestión, writeEnabled y capacidades explícitas del proveedor. No borrado de listas ni compras. Bookmarks es lectura de texto y metadatos; no paridad completa con feed multimedia.
Avisos globales animados, círculo verde y sonido habilitado por gesto. Consulta secuencial de modelos cada 20s después de terminar, solo pestaña visible; no WebSocket ni garantía instantánea. Primera carga silenciosa; cambios posteriores recorren cursores hasta actividad conocida. Estado de revisión por usuario/agencia/modelo en este navegador, no marca leído en OnlyFans ni sincroniza entre dispositivos. Búsqueda y filtros sobre páginas cargadas; más historial por modelo.
Backend autoriza owner/admin y vuelve a comprobar rol y vínculo de modelo tras respuesta y antes de mutaciones. Chatter/analista no obtienen acceso nuevo. HTML/raw/credenciales del proveedor no se exponen. Errores de permiso retiran datos. Pruebas locales de normalización, aislamiento, revocación, capacidades y deduplicación; UI aislada comprobó aviso desde Colecciones, sonido activable, revisión y cambio A/B. No mensajes ni modificaciones de listas reales en QA.

## 01/11 — Clasificación y consulta completa por categoría
Corregida la diferencia entre filtro OFMAPI purchases y evento real paided_message, comprobado en las tres modelos. Compras y propinas muestran una insignia USD extraída solo cuando el texto del aviso contiene un único importe explícito y no ambiguo; no se interpreta como neto/saldo, ni se inventan valores ausentes. Se conserva el texto original. Tipos alternativos normalizados; menciones y etiquetas agrupadas.
El selector de actividad ahora solicita notifications?type=… al conector por modelo, con cursores propios y revalidación de acceso existente. Ya no depende de que la categoría esté en las páginas generales cargadas. Cambio de modelo/categoría descarta respuestas tardías; cada historial mantiene sus cursores y se puede ampliar. Búsqueda de texto limitada a lo cargado y estado de revisión local conservados. Sin cambios de backend/credenciales/permisos ni escrituras en OnlyFans. Fuente oficial https://ofmapi.com/openapi.json, NotificationType y NotificationResponse (01/11). Pruebas de categorías, USD ambiguo/ausente, no confundir mensajes/comentarios con ingresos y filtros/cursor ligados a modelo; 173 pruebas.

## 01/11 — Selector completo de fans en Colecciones
El detalle de listas ofrece una vista previa (Following 4900 devolvió solo 3 usuarios). Nuevo selector consulta fans?type=all con búsqueda y cursores por modelo; fotos, selección múltiple, cargar más o recorrer todas las páginas, cancelación tras página y detección de cursor repetido. Incluye activos/caducados; no confunde Following con suscriptores. Hasta 100 selecciones por operación, revisión explícita antes de añadir. Crear lista abre selector después de confirmar creación; listas automáticas conservan restricciones del proveedor. Añadido batch userIds con validación, deduplicación y autorización antes/después; ningún cambio de roles. Pruebas locales de tres modelos, cursores, datos normalizados, revocación y lote inválido. No se modificaron listas reales durante QA. Fuente: https://ofmapi.com/openapi.json.

QA autenticada Valen: 110 fans en 11 páginas y dos selecciones conservadas. Una interrupción transitoria del proveedor se recuperó reintentando la página pendiente. Añadidos reintentos limitados de lectura 429/503 y pausa entre páginas. No se añadieron usuarios reales a listas. 176 pruebas y compilación correctas.

## 01/11 — Sincronización automática del directorio de fans
Sustituida la carga manual del selector por un directorio compartido que arranca al entrar en Workspace para todas las modelos autorizadas a propietario/manager. Recorrido alternado completo de páginas, sin botones de cargar; caché en memoria durante la sesión del workspace, búsqueda local y selección independiente. Cabecera revisada cada 30 s y recorrido completo renovado 5 min después de completar el anterior; no depende de un supuesto orden documentado del proveedor para detectar altas en páginas posteriores. Reintentos automáticos con espera hasta 60 s, sin borrar fans por fallo transitorio, sin declarar completitud ante cursor repetido. 401/403 vacía datos y detiene esa cuenta. Cambio de usuario/agencia/modelos cancela respuestas pendientes y oculta inmediatamente el ámbito anterior. No almacenamiento persistente de fans ni sincronización con BRUFF cerrado: una sesión nueva requiere la carga inicial, visible como sincronización en curso. No promete que miles de fans lleguen en una respuesta ni tiempo real instantáneo. Pruebas de tres modelos, paginación completa, nuevas filas, errores/revocación y descarte tras desmontaje. 179 tests y build correctos.
