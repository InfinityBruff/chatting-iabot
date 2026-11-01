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

### Corrección definitiva de roles solicitada por el usuario — 31/10/2026

Sustituye la matriz anterior: Propietario tiene control total; Manager opera todas las modelos y puede gestionar trabajadores, roles y accesos, sin modificar al Propietario ni ajustes del sistema; Chatter únicamente lee chats, prepara respuestas y envía en modelos asignadas; Analista únicamente accede a analíticas, informes y ganancias de modelos asignadas. Separados analytics/vault de read (ahora lectura de chats). La política de notas requiere notes, por lo que Chatter no puede leerlas con permisos antiguos. Los roles limitados no pueden conservar permisos ajenos a su función aunque lleguen registros obsoletos.

Migración 202610310004_role_scopes aplicada remotamente tras confirmación específica. Actualiza RPC de Equipo para Owner/Manager, mantiene protección del propietario y bloqueo de autoedición, separa alcance de Chatter/Analista y mantiene revocación por consulta. Manager puede cambiar otros managers, nunca promover a owner. No existe endpoint de modificación del sistema ni acceso a secretos desde Equipo. Función Edge conserva validación remota de identidad y usa la autorización vigente de SQL, ahora Owner/Manager. La descripción histórica owner-only de la entrega anterior ya no representa la matriz actual.

78 pruebas de aplicación y 42 de PostgreSQL de equipo correctas; incluyen Manager gestionando otro miembro, bloqueo sobre propietario y agencia ajena, Analista sin chats y Chatter sin notas/ganancias. Modelos y trabajadores siguen sin datos de prueba en producción. La edición por modelo muestra únicamente los permisos válidos del rol: 3 para Chatter, 1 para Analista; Manager opera todas las modelos. Actualización de pantalla periódica cada 5 s en primer plano, control de servidor en cada petición. Invitación real aún pendiente de destinatario elegido; no se enviaron correos.

### Nombres de trabajadores — 31/10/2026

Nombre obligatorio al invitar y editar trabajadores (1–80 caracteres), almacenado por agencia; nombre y correo visibles en Equipo e invitaciones. Cada usuario activo puede completar su propio nombre sin modificar roles. Auditoría conserva los nombres de actor y destinatario de cada acción junto a los identificadores estables; los registros antiguos sin nombre se indican explícitamente, sin inventar autores.

Migración 202610310005_team_names aplicada en Supabase y función bruff-team-invite actualizada para propagar el nombre. Se mantienen límites de roles, protección del propietario y aislamiento entre agencias. 80 pruebas de aplicación y 54 PostgreSQL correctas. No se enviaron invitaciones ni mensajes reales. Etiqueta pequeña Send: Nombre preparada en chats: los envíos locales figuran como Usuario demo; la atribución real requiere el conector y envío en servidor aún pendientes.

### OFMAPI: lectura real — 31/10/2026

Creada `bruff-live`, con clave OFMAPI almacenada solo en Supabase Edge Function Secrets. La función verifica usuario confirmado con Auth y consulta permisos SQL por agencia/modelo antes y después de cada petición al proveedor. Solo operaciones de lectura enumeradas: perfil, bandeja, historial, transacciones y serie de ingresos. No acepta URLs ni IDs externos enviados por el cliente. Migración 006 aplicada; tres vinculaciones de modelos registradas mediante SQL privado, sin datos personales en el repositorio ni permisos nuevos para trabajadores.

La interfaz autenticada incorpora «Abrir modelos · Chats y analíticas reales», selector de modelo, búsqueda, paginación de chats e historial, intervalo UTC de movimientos e importes USD. Subtotales explícitamente limitados a páginas cargadas; valores ausentes no se convierten a cero. Los datos nunca recurren a la demo. No hay envío, bot, sincronización continua, Vault real ni atribución histórica a trabajadores. Abrir un historial marca el chat como leído en OnlyFans según el contrato OFMAPI; aviso visible y solo por selección manual. Los permisos se consultan cada cinco segundos y al volver a la pestaña.

Validación local: 91 pruebas de aplicación y 64 comprobaciones PostgreSQL; build correcto. Pendiente completar comprobación autenticada de los datos devueltos por las tres cuentas, conciliación de ingresos y comprobación de publicación.

Verificación autenticada 31/10: las tres modelos devuelven bandejas y transacciones reales en BRUFF publicado. Historial abierto y paginación de Valen comprobada (10 → 28 conversaciones). Desglose financiero distingue bruto/total, recuentos y páginas cargadas. Acceso anónimo al Edge devuelve 401. Sites privado y Cloudflare publicados. No se enviaron mensajes ni se concedieron accesos nuevos a trabajadores. 93 pruebas de aplicación y 64 PostgreSQL. Conciliación completa y sincronización continua siguen pendientes.

### 31/10 — Envíos manuales y baúl OFMAPI

Implementado compositor real con revisión explícita del fan/texto/adjuntos, mensajes gratuitos, emojis y máximo 10 adjuntos. Subida desde ordenador limitada a 10 MB por archivo (fotos/vídeos/audios compatibles); se informa que subir transfiere el archivo a OnlyFans antes del envío al fan. Baúl por modelo: carpetas paginadas, filtros de tipo y búsqueda, previews con URLs del proxy oficial y selección de adjuntos. Historial muestra adjuntos disponibles sin exponer medios bloqueados ni HTML del proveedor.

Los adjuntos y envíos revisados usan tickets HMAC de una hora ligados a usuario/agencia/modelo y vinculación externa. El envío revisado es inmutable, el reintento usa la misma Idempotency-Key del proveedor dentro de su ventana de 24 h; nunca hay reintentos automáticos. Una revisión perdida tras navegar/recargar requiere comprobar el historial antes de redactar de nuevo. No hay todavía libro persistente de envíos/atribución Send: Nombre ni recuperación duradera de intentos. No se promete entrega exactamente una vez fuera del contrato OFMAPI. URLs de contenido del proveedor duran hasta 24 h y no pueden revocarse retroactivamente por BRUFF una vez entregadas.

Migración 007 amplía únicamente las operaciones admitidas a send/vault, respetando can_access y los roles existentes. Propietario/Manager acceden al baúl; Chatter mantiene solo chats con permisos read/drafts/send y subida directa, sin acceso al módulo general de baúl; Analista sin envío ni baúl. No se concedieron nuevas modelos a trabajadores. Asistente en pausa.

Autorización explícita del usuario: ampliar la clave existente a Read & write y activar en Supabase envío manual, subidas y baúl. Clave OFMAPI renombrada BRUFF · mensajes y baúl; ampliación guardada sin recuperar ni rotar el secreto. bruff-live actualizado con código combinado equivalente al repositorio, validación Auth/SQL conservada y flag BRUFF_MANUAL_SEND_ENABLED=true guardado. Acceso anónimo remoto devuelve 401. Migración 007 ejecutada; confirmar resultado y registrar QA autenticado tras publicación.

Validación: 100 pruebas de aplicación, 72 comprobaciones PGlite y build correctos. QA navegador local con datos ficticios: chat, selección de archivo de baúl y pantalla de revisión; fixture eliminado del código antes de publicación. No se ha enviado ningún mensaje real ni subido archivos reales de prueba. Pendiente QA autenticado de baúles de las tres modelos y prueba de envío/subida realizada por el usuario desde BRUFF. Vídeos >10 MB, PPV, envíos masivos, programados, autoría persistente y bot siguen pendientes.

Contrato consultado: https://ofmapi.com/openapi.json y https://ofmapi.com/docs/idempotency .

Cierre de despliegue de esta fase: migración 007 confirmada en Supabase («Success. No rows returned»); función actualizada, flag manual true y clave Read & write guardados. Publicación Sites privada correcta, fuente 7515478d9bb9a39126be1d9052330d76e54cb689. GitHub main ede646821315c588a57e39c080889e2b39cbb3ab; Cloudflare devuelve HTTP 200 con assets index-CXcQ_G5l.js e index-CEUjM-wT.css. QA real pendiente de iniciar sesión nuevamente tras recarga: el usuario debe entrar y abrir modelos, después comprobar baúles de las tres cuentas. No volver a pedir aprobación para esta activación ya autorizada. Ningún mensaje ni archivo real enviado de prueba. No confundir pruebas con mocks y verificación de despliegue con confirmación de envío real.

### 31/10 — Precio PPV y texto acompañante

Verificación autenticada anterior completada: las tres modelos mostraron carpetas y 40 archivos iniciales, y una cuenta paginó de 40 a 80. Controles de envío/subida/baúl visibles en chat real; sin envío real de prueba.

Añadido precio total USD para los adjuntos, con 0 gratuito. Texto acompañante visible sin pagar (lockedText=false); importe y archivos quedan ligados al ticket firmado del envío. Revisión muestra destinatario, texto, lista de archivos, precio total y botón de confirmación con importe. Admite coma o punto decimal, rechaza negativos, fracciones menores que centavos y contenido de pago sin adjuntos. No cambia permisos ni activa IA. Reintentar conserva precio original incluso si el cliente intenta modificarlo después de revisar. typingWpm=200 es compatible con el contrato del proveedor consultado.

102 pruebas y build correctos; QA local de 12,99 USD con mensaje/adjunto/revisión usando datos ficticios, sin envío real. Fixtures retirados antes de publicar. La entrega/compra real PPV requiere prueba del usuario; no se ha afirmado que haya ocurrido. Fuente: https://ofmapi.com/openapi.json .

### 31/10 — Distribución de mensajes basada en referencia visual

Inspeccionada por petición del usuario la pestaña abierta Inbox de OnlyX y su selector de adjuntos. Recreada estructura de cuatro columnas en BRUFF: menú, bandeja persistente con selector de modelo/búsqueda/filtros/orden, conversación y ficha lateral Resumen/Actividad. Tema gris oscuro y azul, tarjetas compactas, cabecera del fan y estado IA, fechas separadoras, emojis sobre compositor fijo, baúl y revisión PPV en diálogos accesibles. Se conserva BRUFF y la integración independiente OFMAPI, sin copiar cuentas, mensajes ni código del producto de referencia.

Filtros Todos/Sin leer y orden operan sobre páginas cargadas, indicado en UI. La ficha solo muestra identidad y actividad disponibles; gastos, suscripción y notas aún no conectados se indican sin cifras ficticias. No hay Telegram, IA activa, traducción, índices de calidad ni atribución de trabajadores simulados. No se afirma paridad funcional con OnlyX.

QA local con dos modelos y datos ficticios: cuatro paneles, adjuntar, precio 15,50 USD, Enter abre revisión sin envío, volver a editar, cambio de modelo limpia fan/adjuntos y formato móvil 390px. Diálogos conservan el ticket firmado y reintentos existentes. Fixtures eliminados. 102 pruebas de aplicación y build correctos; sin cambios de backend/permisos ni mensajes reales enviados.

### 31/10 — Identidad BRUFF y niveles de fans

Logo original aportado por el usuario integrado en acceso y navegación con presentación blanca por CSS, sin modificar el archivo original. Tema compartido grafito, blanco y azul para el espacio real y pantallas demo, equipo, formularios, baúl, analíticas y diálogos. Las demos siguen identificadas y no se convierten en funciones reales por este cambio visual.

Estrellas siempre visibles sobre el avatar, en la cabecera y en la ficha: 1 desde 6 USD; 2 al superar 17; 3 al superar 35; 4 al superar 60; 5 desde 95. Más de 200 USD cambia las cinco a azul diamante. Importes en centavos enteros; desconocido distinto de cero. Regla común, reemplaza el editor demo de umbrales que ya no corresponde al reparto solicitado.

Consulta oficial OFMAPI `/fans/spend?ids=...` por lotes de hasta 20, exclusivamente para IDs devueltos por la página de inbox de la modelo autorizada, máximo 100 por página. Totales históricos con esa modelo, no gasto global en OnlyFans. Se normalizan importes y se descartan datos raw/IDs no solicitados. Falla de gasto conserva chats con nivel pendiente; se revalidan permisos después de la consulta. Sin cambios SQL, concesiones de acceso ni envíos. Fuente: https://ofmapi.com/openapi.json .

106 pruebas y build correctos. QA de navegación de los ocho apartados demo, logo original, niveles cero/desconocido/dorado/diamante y chat móvil de 390px sin desbordamiento. Cambio de modelo elimina hilo y nivel anteriores. La lectura de gasto se ha preparado y desplegado en bruff-live; comprobar datos autenticados tras actualizar frontend. No prueba de compra o envío real.

## 31/10 — Protección previa de mensajes salientes
- Lista interna estricta BRUFF: 411 entradas; no es un diccionario oficial de OnlyFans. Se comprueban palabras/frases completas normalizadas. Puede producir falsos positivos.
- Solo mensajes salientes de propietario/trabajadores. Los mensajes recibidos de fans no activan alertas ni suspensiones.
- Servidor revisa al preparar y nuevamente al confirmar, antes de llamar a OFMAPI. Deniega el intento y registra actor, modelo, fan ID, texto, términos y hora. Fallos de validación impiden enviar.
- Trabajador suspendido en toda su agencia hasta revisión del propietario en Equipo. Propietario registra alerta y no envía ese texto, pero puede corregir sin suspensión. Solo propietario puede ver registros y levantar suspensión.
- No cancela solicitudes ya despachadas, no analiza imágenes/audio ni clientes externos. Notificación dentro de Equipo, no correo.
- Migración 008 aplicada; función bruff-live actualizada. 109 pruebas de aplicación y 102 comprobaciones PostgreSQL; alerta y desbloqueo comprobados con datos locales ficticios, sin enviar a fans reales.

## 31/10 — Entrega de las siete mejoras
- Analíticas reales: evolución SVG accesible por categoría, mínimo/máximo y tabla exacta; totales de proveedor separados de subtotales paginados. Ausencias no estimadas; no llamar neto al total no tipado.
- Estrellas compactas de 9 px encima del avatar, separadas del nombre. Umbrales sin cambios.
- Baúl: selección múltiple entre páginas/filtros, marcas, contador, exclusión de adjuntos ya presentes, máximo conjunto 10 y añadir explícito.
- Compositor y revisión: vistas previas foto/vídeo/audio según disponibilidad, quitar individualmente, precio conjunto/Gratis, texto, modelo y fan. Idempotencia y doble validación de seguridad conservadas.
- BRUFF: preferencias persistentes por agencia/modelo, apagado/seleccionados/todos (incluye futuros), excepciones manual/BRUFF/heredar por fan, solo propietario/manager editan. Apagar conserva selecciones. Versionado rechaza escrituras obsoletas. Migración 009 aplicada en Supabase.
- Motor NO conectado: los interruptores guardan preferencias; no inician automatización ni envían mensajes. Conectar y verificar el motor es trabajo posterior.
- QA local con datos ficticios: dos adjuntos, pago y gratis, confirmación, dos modelos independientes, fan individual. 110 pruebas aplicación y 121 comprobaciones PostgreSQL. No se enviaron mensajes reales ni se cambiaron preferencias de modelos reales durante QA.

## 31/10 — Resumen financiero por modelo
Selector destacado de modelo en Analíticas; último mes natural completo, últimos 30 días, mes actual e intervalo personalizado. Resumen mensual con bruto y total informado; mensajes/PPV, tips, suscripciones, publicaciones, directos y referidos cuando el proveedor los entregue. Histórico mensual mediante earnings/monthly y saldos mediante balances: lectura con permiso analytics y revalidación tras la respuesta. Totales históricos solo si cada mes tiene importe explícito y etiquetas únicas; ausencia no es cero. No se interpreta total como neto. Fuente oficial: https://ofmapi.com/openapi.json (consultado 31/10/2026). Contrato mensual flexible: formatos no reconocidos permanecen no disponibles, pendiente conciliación autenticada. UI comprobada con dos modelos ficticias, pruebas de fechas/aislamiento/normalización; pnpm check 115 pruebas. Actualización de Edge autorizada expresamente y desplegada. El diagnóstico anterior de 403 desde la dirección del usuario no se considera resuelto por este cambio.

## 01/11 — Primera entrega de navegación OnlyMonster → BRUFF
Referencia visual directa: https://onlymonster.ai/panel/creators y https://dashboard.onlymonster.ai/panel/analytics ; ChatSpace sin cuentas. Revisados agrupación y rail lateral, toolbar, selección de cuenta/fechas/neto, tarjetas métricas y tabla. Members volvió a login; inspección completa pendiente de sesión del usuario.

Shell operativo agrupado en Mensajes, Analíticas, Contenido, Organización y BRUFF IA, con menú contraíble, cabecera y diseño oscuro propio. Tabla de cuentas solo con modelos autorizadas, búsqueda local y enlaces a módulos; estado registrado no se presenta como comprobación de salud. Equipo reutiliza funciones/RPC actuales y recibe usuario autenticado para proteger edición de sí mismo. Roles explica el reparto acordado; alcance reutiliza ModelBotControl y RPC versionado sin activar motor. Dashboard reutiliza FinanceOverview; período/transacciones en vista separada. No nuevas operaciones de servidor ni concesiones de permisos.

Pruebas de navegación: chatter solo chat/cuentas, analista solo finanzas/cuentas, gestión solo propietario/manager, pérdida de permiso elimina sección/modelo. Continúa la autorización real del backend y la verificación periódica de membresía. No equivalencia completa con OnlyMonster: tráfico, turnos/métricas de trabajadores, automatizaciones y motor IA aún requieren desarrollo e integración independientes. La referencia vacía no permite comprobar disposición de conversaciones o menús del chat.

Validación: 117 pruebas y build correctos. QA local aislado con dos modelos ficticias: tabla, apertura del resumen de la modelo B (400 USD frente a 1200 USD de A), equipo integrado, guía de roles, configuración sin activar y rail contraíble. Captura /private/tmp/bruff-navegacion-modelos.png. Fixtures retirados. No se ha comprobado una conversación de OnlyMonster con modelo conectada ni la nueva navegación en sesión productiva del trabajador.

## 01/11 — Referencia fotográfica del chat
Frontend de chat adaptado a la fotografía aportada: rail 62px, lista 350/395px, hilo central, tarjetas laterales compactas. Colores carbón/cian, burbujas de radio 5px, gasto sobre avatar, estrellas y switch BRUFF preservados. Configuración global de modelo plegada para dejar más espacio a fans. No se modifica servidor, migraciones ni permisos.
Se añaden controles locales: fijados (se reinician al salir/cambiar modelo), filtro de propinas según gasto histórico conocido, búsqueda y galería limitadas a páginas cargadas, ranking por gasto de fans cargados, respuestas rápidas que solo rellenan borrador. El nombre del fan se inserta como texto; no ejecuta envío. Adjuntar sigue el diálogo existente con precio total y selección múltiple. Revisar conserva ticket, destinatario, doble comprobación de seguridad e idempotencia.
Accesos no conectados abren una explicación explícita: traducción, calendario/programación, nueva conversación, temas/preferencias y perfil/sugerencias IA. Campos desconocidos no se rellenan ni se consideran cero; estado en línea y fotos de perfil no disponibles en el contrato actual. La tarjeta lateral usa «Mayor gasto», no «Spenders online». Estas limitaciones impiden afirmar paridad completa solicitada; requieren desarrollo de proveedor/motor separado.
QA local con datos ficticios y bloqueo expreso del envío: búsqueda «novedades» devuelve 1/6, fijar Will muestra 1 fijado, saludo solo rellena borrador, revisar abre confirmación sin enviar; cambio de disposición a 390px sin desbordamiento. Captura /private/tmp/bruff-chat-referencia.png. Fixtures eliminados. No se enviaron mensajes reales ni se activó BRUFF. Se mantiene pendiente verificación autenticada de la nueva interfaz con datos reales.

## 01/11 — Presencia en línea
Contrato verificado https://ofmapi.com/openapi.json: followings acepta all_online, respuesta followings[].id. Se consulta 1 página por carga de inbox, límite/timeout 8s; IDs solo se cruzan con fans autorizados del inbox de esa modelo; no se devuelven raw ni otros usuarios. Fallo conserva chats con presencia desconocida. Revalidación de permisos posterior existente. No prueba offline para ausentes ni exhaustividad para fans no seguidos/otras páginas. UI verde con confirmación positiva menor a 60s; reloj local cada 5s retira indicador vencido; refresh de conversaciones renueva consulta. Fan activo se resuelve por ID contra nueva página, no mantiene presencia vieja tras refrescar. Pruebas de coincidencia parcial, aislamiento/revocación existentes, expiración/dato ausente/string inválido; 119 tests y build.
Edge preparado en editor Supabase. Auto-review rechazó confirmación del despliegue productivo por reemplazo inmediato sin reversión automática; pendiente autorización específica del usuario. No considerar activo hasta completar ese despliegue. Frontend compatible con Edge anterior: ausencia de presence no produce verde.

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

### Continuidad de sesión y chats · 01/11/2026
Por petición del propietario, persistSession pasa a true; sustituye el comportamiento histórico de sesión solo en memoria. Renovación del mismo usuario conserva la interfaz; permisos se siguen verificando en servidor y cada 5 s. Borrador, navegación y ticket incierto quedan aislados por usuario/agencia/modelo/fan en la pestaña, con borrado al cerrar sesión. Historial no se vacía al refrescar, sondeo visible 5 s chat / 12 s lista y backoff ante fallos. UI distingue envío pendiente de confirmado; mantiene moderación y ticket idempotente. Pruebas locales ficticias no equivalen a enviar a fans reales ni a verificación de sesión productiva.
