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
