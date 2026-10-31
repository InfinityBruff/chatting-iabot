# BRUFF: auditoría y plan de puesta en producción

Fecha: 30 de octubre de 2026. Requisitos confirmados: producto independiente de OnlyX; trabajadores con correo/contraseña propios de BRUFF, sin cuenta ChatGPT. Aún no hay conector contratado. No hay autorización para activar asistentes ni realizar envíos reales.

## Estado verificado en código

| Área | Disponible | Falta para producción |
|---|---|---|
| Interfaz React | Chats, cuenta activa, ficha, Vault, Dashboard, siete informes | Estados reales de carga/error/desconexión, accesibilidad y pruebas móviles completas |
| Almacenamiento | localStorage por navegador | Base de datos persistente, versiones y conflictos, copias y restauración |
| Equipo | Formularios de roles, permisos y comisiones demo | Identidad, invitación y recuperación por correo, sesiones, autorización por petición |
| Backend | Esquema SQL y funciones de acceso con pruebas | Servidor HTTP, repositorios, migraciones, despliegue y monitorización |
| Cuentas OnlyFans | Modelos ficticios | Proveedor autorizado, enlace/revocación por modelo, almacenamiento seguro de credenciales |
| Chats/campañas | Borradores locales, edición y archivo | Sincronización paginada, eventos, cola idempotente, adjuntos reales y recibos de envío |
| Vault | Carpetas y archivos de ejemplo, búsqueda y favoritos | Enumeración completa, metadatos y accesos temporales, permisos por cuenta |
| Analítica | Cálculos sobre histórico sintético | Libro de transacciones reales, reembolsos, comisiones reales, monedas, conciliación |
| BRUFF | Configuración y selección por cuenta/fan | Generación, política de ejecución, contexto, revisión humana, evaluación y costes |
| Entrega | Sitio privado Sites, GitHub, build y pruebas | Entornos separados, acceso propio compatible, dominio, recuperación y alertas |

No equiparar botones o configuración guardada con una conexión, envío, invitación o ejecución real. No importar automáticamente ejemplos locales a producción.

## Hallazgos y correcciones de la primera fase

1. Seleccionar un chat podía marcar como leído un fan con el mismo ID en otra cuenta. Corregido mediante selección compuesta cuenta/fan.
2. La recarga local rechazaba IDs de fan repetidos entre cuentas y volvía al estado inicial. Corregida la validación por cuenta/fan y la migración demo.
3. La ficha demo podía atribuir el gasto de un fan de Luna a un ID igual de otra modelo. El fallback queda limitado a su cuenta.
4. Las cinco pruebas del servidor quedaban fuera de pnpm test. Incluidas junto a pruebas de interfaz/dominio; total actual 47.
5. Analítica y preparación del backend estaban en cambios locales sin consolidar en la última publicación. Consolidar antes de migrar infraestructura.
6. Hay incompatibilidad de vocabulario entre roles/permisos demo y los del servidor. Definir catálogo único en la fase 2; no migrar permisos por coincidencia de etiquetas.
7. La estadística demo usa deducciones y eventos ficticios; sustituir con registros normalizados, no adaptar números ficticios a producción.
8. El hosting privado actual exige su identidad de plataforma. No anunciar acceso propio de trabajadores hasta verificar/provisionar alojamiento y autenticación compatibles. No abrir públicamente el sitio actual para resolverlo.

## Fases y criterios de finalización

### 1. Consolidar y comprobar el prototipo
- Preservar cambios, publicar la última interfaz privada y guardar la fuente en GitHub.
- Corregir aislamiento y ejecutar todas las pruebas. Mantener marcado DEMO.
- Cierre: build correcto, pruebas correctas y publicación confirmada; registrar límites de QA.

### 2. Identidad y backend real (siguiente fase)
- Elegir proveedor de autenticación administrada y hosting compatible con acceso propio, tras comprobar costes y condiciones. No implementar criptografía de contraseñas casera.
- Registro por invitación, verificación de correo, login/logout, recuperación, caducidad/revocación, segundo factor para propietarios y administradores.
- Crear agencia propietaria y catálogo único de permisos; denegar por defecto. La identidad del servidor manda sobre cualquier dato del navegador.
- Migraciones versionadas, claves compuestas, copia y restauración comprobada. Nunca convertir un visitante en propietario automáticamente.
- API inicial: sesión, cuentas permitidas, notas, borradores y configuración, con validación de datos, paginación y control de versión.
- Cierre: dos usuarios con roles distintos trabajan desde dispositivos distintos; intentos de acceso cruzado, revocación de sesión y edición concurrente probados por HTTP.

### 3. Conexión independiente, primero lectura
- Evaluar proveedor por acceso permitido, autorización de modelos, revocación, privacidad, costes, límites y cobertura de endpoints/eventos. Ningún nombre comercial acredita respaldo oficial de OnlyFans.
- Adaptador intercambiable: capacidades explícitas y estado de conexión. Cada operación verifica identidad de agencia y cuenta.
- Probar una cuenta autorizada: chats, fans, carpetas, archivos y transacciones, recorriendo todas las páginas. Cursores y reintentos con límites.
- Validar firmas de webhooks, deduplicar eventos y manejar orden tardío. No confiar en el creatorId enviado por un cliente sin resolverlo en servidor.
- Cierre: recuentos conciliados, reconexión y revocación comprobadas; secretos ausentes de cliente, exportaciones y logs.

### 4. Conversaciones, Vault y campañas reales
- Reemplazar datos demo por API propia, separando demo/real y mostrando fallos sin recurrir a datos ficticios.
- Búsqueda, adjuntos permitidos, lectura y envío, precios PPV validados, historial y notas persistentes.
- Cola de envío con clave idempotente, límites del proveedor y comprobación de permisos/pausas justo antes de enviar. Un resultado desconocido se reconcilia antes de reintentar.
- Campañas: previsualizar audiencia por cuenta, excluir duplicados, confirmar contenido/precio, programar, pausar y registrar resultado individual.
- Cierre: envío de prueba explícitamente autorizado no se duplica bajo reintentos; fallo parcial recuperable y cuentas aisladas.

### 5. Analítica y comisiones verificables
- Importar importes en centavos y moneda, bruto, tarifa, neto, reembolsos y zona horaria. No sumar monedas diferentes sin conversión explícita.
- Definir cada métrica (cohortes, conversión, PPV, percentiles de respuesta); distinguir datos ausentes de cero y retrasos de sincronización.
- Atribución verificable de ventas al equipo; comisiones según acuerdo guardado/versionado, sin crear pagos automáticos.
- Cierre: ingresos y exportaciones concilian con el origen para una cuenta y un periodo; reembolsos y periodos sin datos probados.

### 6. Motor BRUFF integrado en el servidor
- Elegir modelo y proveedor compatible con los usos previstos y sus políticas; evaluar con ejemplos autorizados/sintéticos y coste máximo por cuenta.
- Contexto limitado al fan y modelo correctos. Los mensajes del fan son datos no fiables, no instrucciones para cambiar permisos, revelar información o ejecutar herramientas.
- Primera modalidad: propuesta con revisión humana. Control global, por cuenta, selección de chats y toma manual, con registro de versión de instrucciones/modelo.
- Prevención de respuestas duplicadas, respuesta tardía tras intervención humana, precios inventados y acceso a información de otras cuentas. Presupuesto, límites y pausa inmediata.
- Separar generación de envío: el modelo no dispone de una clave que permita saltarse la autorización de la cola.
- Cierre: batería de evaluación y pruebas de aislamiento/pausa aprobadas; activación real solo cuando el usuario la autorice expresamente.

### 7. Piloto y operación
- Piloto con una modelo y pocos trabajadores, seguimiento de fallos y costes, soporte y procedimiento de reversión.
- Copias, restauración, alertas, exportación/eliminación, trazas sin datos sensibles innecesarios y documentación de operación.
- Cierre: flujos principales verificados de extremo a extremo, sin errores críticos pendientes; ampliar modelos gradualmente.

## Decisiones pendientes, cuando sean necesarias

- Hosting/auth/correo, dominio y presupuesto: antes de crear o contratar servicios.
- Proveedor de conexión y una cuenta piloto autorizada: antes de compartir accesos o sincronizar datos reales.
- Proveedor de IA, usos y límite de gasto: antes de generar respuestas con datos reales.

## Próximo paso concreto

Completar la fase 1 y avanzar a la selección técnica de alojamiento/autenticación propia y contrato API de la fase 2. No volver a añadir módulos demo para aparentar avance. Las fases sin credenciales pueden avanzar en contratos, pruebas y repositorios de datos; las acciones externas dependientes esperan su configuración/autorización.

### Avance fase 2 — frontera API, 30/10/2026

Usuario sin alojamiento contratado. Añadidos handler autenticado y adaptador Supabase; API de sesión/cuentas/notas con permisos por petición, fan compuesto y control de versión. 53 pruebas y build correctos. Persistencia, login visible, despliegue de servidor y conexión a React pendientes; no hay backend productivo. Siguiente avance: proyecto Supabase, migración Postgres con aislamiento y repositorio transaccional; ver detalles y límites en BACKEND.md.

### Base Supabase aplicada — 30/10/2026

Proyecto Supabase creado por el usuario. Aplicada la primera estructura PostgreSQL privada: diez tablas, agencia BRUFF pausada, RLS y clientes sin privilegios. 17 comprobaciones SQL locales más 54 pruebas y build. Ver docs/SUPABASE-SETUP.md para evidencia, alcance y migración aplicada manualmente. Falta identidad del propietario y conexión API/interfaz; SMTP pendiente (usuario solo dispone de Gmail). No solicitar crear otro proyecto ni repetir esta migración.

### Acceso propio preparado — 31/10/2026

Propietario real vinculado y verificado. Formulario de acceso/cierre de sesión Supabase, sesiones en memoria, demo separada y pantalla de agencias/rol desde RPC. 57 pruebas de aplicación y 23 comprobaciones PostgreSQL correctas. Migración 202610310002_membership_rpc.sql pendiente de aprobación y aplicación remota; no afirmar permisos conectados hasta completarla. Prueba de contraseña real debe realizarla el usuario en la interfaz. Hosting para trabajadores y SMTP siguen pendientes.

### Actualización verificada — 31/10/2026, Cloudflare Pages

La migración 202610310002_membership_rpc.sql ya fue aplicada y el propietario verificó el acceso real y su rol en el sitio anterior; la nota precedente es histórica. Con autorización explícita del usuario se ha publicado el frontend en https://bruff-workspace.pages.dev/ mediante Cloudflare Pages, conectado únicamente a InfinityBruff/chatting-iabot, rama main, commit ddc003341a2f0b9b8838deed95d10dc657baef2c. Compilación pnpm run build, salida dist, Node 22.16.0 y pnpm 11.25.0. Cloudflare mostró despliegue satisfactorio y se verificó la pantalla de acceso en el dominio publicado. El sitio Sites anterior conserva su acceso privado.

Pendiente probar el inicio de sesión en el nuevo dominio con el usuario, actualizar el texto antiguo del formulario que aún describe el alojamiento como pendiente y actualizar Node a una versión mantenida compatible con Corepack (el build actual terminó, pero emitió una advertencia de engines). SMTP, recuperación de acceso, invitaciones, backend operativo, conector independiente y motor BRUFF siguen pendientes; este despliegue no los habilita. No se han activado asistentes ni enviado mensajes reales.

### Acceso en Cloudflare confirmado — 31/10/2026

Después de que el usuario introdujera sus credenciales, se observó en https://bruff-workspace.pages.dev/ la agencia BRUFF, «Propietario · Acceso verificado» y pausa global activada. La demo está deshabilitada durante la sesión real. Verificación local repetida: 57 pruebas y build correctos; 23 comprobaciones PostgreSQL correctas. Esto confirma login y membresía en el nuevo alojamiento, no los módulos operativos pendientes.

Supabase Site URL sigue guardado como http://localhost:3000. Se preparó https://bruff-workspace.pages.dev en el formulario, sin guardar, pendiente de confirmación específica del usuario para cambiar el destino de autenticación. Su respuesta «listo» confirmó únicamente que había iniciado sesión. No hay Redirect URLs configuradas.

### Dirección de autenticación guardada — 31/10/2026

Tras confirmación explícita posterior, se guardó Site URL = https://bruff-workspace.pages.dev en Supabase; el formulario terminó sin cambios pendientes. No se añadieron comodines ni destinos de terceros. La nota anterior describe el estado previo. SMTP personalizado continúa desactivado. Siguiente dependencia para invitaciones/recuperación: proveedor de correo y remitente verificado; además falta implementar y probar los flujos de aceptación y recuperación en React antes de enviar enlaces reales. Cambiar Site URL por sí solo no habilita estos flujos.

### SMTP guardado y plantillas preparadas — 31/10/2026

El usuario introdujo y guardó personalmente su contraseña de aplicación de Gmail. Se verificó tras recargar Supabase que SMTP personalizado permanece activado, con smtp.gmail.com, puerto 465, remitente BRUFF Workspace y contraseña almacenada oculta. No se leyó ni guardó la credencial en el repositorio. Esto confirma persistencia de configuración, no autenticación SMTP ni entrega: no se ha enviado ningún correo de prueba.

Guardadas las plantillas de recuperación e invitación en español, manteniendo {{ .ConfirmationURL }}. Supabase advierte de posibles problemas de entrega al utilizar correo personal. La nota anterior sobre SMTP desactivado es histórica. Próximo paso: implementar y probar el procesamiento seguro de enlaces y formularios de recuperación/aceptación en React; actualmente detectSessionInUrl está desactivado y esos flujos no existen. Después se podrá comprobar entrega con un envío autorizado. No enviar invitaciones a trabajadores ni presentar los enlaces como operativos todavía.

### Invitación y recuperación implementadas — 31/10/2026

Pantallas en React para solicitar recuperación, validar enlaces invite/recovery, crear y confirmar contraseña, éxito y enlaces caducados. Procesan el fragmento implicit de ConfirmationURL con setSession y getUser; parámetros retirados inmediatamente de URL, sin almacenamiento persistente. No se aceptan redirecciones arbitrarias ni se conceden membresías. La sesión del enlace no abre módulos ni consulta agencias durante este flujo; volver al acceso cierra la sesión local. Contraseñas de 12–128 caracteres y confirmación; errores del proveedor traducidos sin mostrar detalles sensibles. Corregido texto antiguo sobre hosting pendiente.

Verificación: pnpm check, 65 pruebas y build correctos; navegador local: formulario de recuperación y error de enlace caducado con URL limpia. Las pruebas de sesión válida y guardado usan dobles del cliente, no identidades reales. Pendiente prueba extremo a extremo con correo autorizado y contraseña introducida por el usuario; no se enviaron correos ni modificaron credenciales reales. Si Supabase exige reautenticación adicional, se muestra error y se requiere nuevo enlace/revisión, sin debilitar ajustes de seguridad. Las invitaciones reales siguen requiriendo asignar previamente permisos desde backend administrativo; no hay envío de invitaciones desde la UI todavía.

Referencias oficiales: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail y https://supabase.com/docs/reference/javascript/auth-setsession .

### Equipo real y revocación — 31/10/2026

Implementado Equipo dentro del acceso autenticado de cada agencia, separado de las fichas demo. Nombres acordados: Propietario (owner), Manager (admin), Chatter (operator), Analista (viewer). Manager tiene todas las modelos actuales/futuras y acciones; solo Propietario gestiona equipo. Chatter usa permisos explícitos por modelo (consulta, notas, borradores, envío, configuración); Analista solo consulta. Ninguna asignación activa BRUFF ni conecta OnlyFans. Registro de modelos crea exclusivamente cuentas desconectadas, sin datos de ejemplo.

Aplicada remotamente, con confirmación específica, la migración 202610310003_team: RPC de lectura y edición solo propietario, versión para evitar sobrescrituras, validación transaccional de modelos de la agencia, protección del propietario, invitaciones pendientes/fallidas/canceladas y auditoría privada. La retirada conserva el historial y marca la membresía disabled: la siguiente petición pierde permisos. Cambios de rol se consultan en cada comprobación de acceso; React renueva membresías cada 5 s en pestaña activa y al recuperar visibilidad, ocultando módulos si falla la verificación. No se promete borrar datos ya vistos ni terminar sesiones de otras agencias.

Desplegada bruff-team-invite en Supabase. Verifica bearer con Auth /user y correo confirmado, exige propietario vía SQL antes de usar la clave de servicio en servidor. El usuario autorizó explícitamente desactivar SOLO la verificación JWT legacy de esta función tras un bloqueo del control automático; se mantiene autenticación remota y autorización de propietario en el handler. Rechazo remoto comprobado: petición sin sesión devuelve HTTP 401 desde el handler. CORS restringido a los dos sitios publicados. No hay clave privilegiada en frontend/repositorio. Cuenta existente: asignación sin correo; cuenta nueva: invitación Auth/SMTP. Si envío/asignación es incierto, se informa y la ficha pendiente puede cancelarse sin conceder acceso. Un correo en tránsito puede llegar tras cancelar, pero no concede membresía.

Verificación remota de RPC como propietario dentro de transacción revertida: 1 miembro, 0 modelos, 0 invitaciones; anon no puede consultar y authenticated no puede finalizar invitaciones. Pruebas locales: 73 de aplicación y 27 PostgreSQL específicas de equipo, incluida revocación en la siguiente consulta, degradación de rol, agencias ajenas, conflictos de versión, identidad de invitación y función final solo service_role. QA local con dobles explícitos: formulario, selección por modelo, revisión y guardado de Analista con acceso retirado. Fixture eliminado antes de empaquetar. No se enviaron correos ni crearon trabajadores reales. Falta prueba real de invitación/aceptación con un destinatario y rol elegidos por el propietario; los módulos de chats/analíticas con datos reales siguen pendientes del conector/backend correspondiente.

Fuentes: https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail , https://supabase.com/docs/guides/functions/auth , https://supabase.com/docs/guides/functions/secrets .

Ajuste solicitado durante esta entrega: selector visual de una modelo o todas las registradas, tarjetas con explicación de cada permiso, cobertura concedido/sin permiso/algunas y resumen de modelos asignadas. «Todas» aplica a modelos actuales, no futuras; Manager conserva acceso implícito a todas actuales/futuras. Quitar consulta retira acciones dependientes de ese alcance. Pruebas ampliadas a 75; QA con dos modelos ficticias verificó estado mixto, aplicación masiva y cambio de vista individual. El usuario puede proponer cambios a la matriz de roles; no se habilitó edición arbitraria de roles globales. Los nombres de la demo también se actualizaron sin convertir fichas locales en trabajadores reales.
