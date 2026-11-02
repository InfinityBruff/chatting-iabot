# Ejecutor avanzado: coordinación de entregas

## Corrección de errores de lectura · 02/11

El diagnóstico posterior identificó los 503 repetidos como 429 del proveedor en `collection_fans`, transformados incorrectamente por el adaptador de comunidad. La migración 033 y el backend read-guard ya coordinan una espera privada entre instancias y conservan estado/Retry-After. El middleware solo protege lecturas GET: no intercepta, reintenta ni reproduce escrituras ni activa campañas. No guarda claves ni datos de fans; RPC de coordinación solo service_role, tabla privada con RLS. Los fallos de coordinación bloquean la lectura.

Frontend principal corregido: directorios solo en pantallas que los requieren, modelo activa, sin consultas en pestañas ocultas; reanudación exacta del cursor y respeto de Retry-After en directorio/notificaciones. Cloudflare commit `f67d70bc8b78000132f066bc4953c0e1f0042341`; asset público idéntico al build probado. 931 pruebas, 108 SQL locales y 14 pruebas de bundle correctas. Ver `PRODUCTION-PLAN.md` para hashes/evidencia y muestras reales posteriores sin 503, con esperas 429 explícitas. Siguen sin probarse entregas/retiradas reales por la restricción del usuario; no se realizó ninguna acción de mensaje ni activación.

## Publicación confirmada · 02/11

Las migraciones 031–032 y el backend financial ya están publicados con autorización del propietario. Frontend productivo en `https://bruff-workspace.pages.dev/`, commit `051ec31bd7809c19eff6f6f37cdb24eb3d90f4ea`, Cloudflare success. La sección local y las posteriores conservan el historial anterior. Ver el último checkpoint de `PRODUCTION-PLAN.md` para hashes, copia previa, evidencias y límites.

Verificación remota: RLS y permisos correctos, 3 modelos en RPC financiera bajo propietario dentro de transacción de solo lectura revertida, programador con heartbeat vigente, HTTP 401 sin sesión / 403 origen ajeno / 204 preflight autorizado. JavaScript público idéntico al build probado. Cero campañas activas, envíos/retiradas y colas ejecutables en las comprobaciones. Sin cambiar Cron/flags ni ejecutar mensajes reales. Continúan observándose algunas respuestas 503 que ya existían antes; causa no acreditada por los logs revisados. La publicación no equivale a prueba de entrega, retirada ni disponibilidad completa del proveedor.

## Estado actual · 02/11, última continuación local

Las secciones siguientes conservan el historial de implementación. El runtime masivo y programador ya están publicados hasta la migración 030, según `PRODUCTION-PLAN.md`. Los cambios de retirada y filtros financieros 031–032 están implementados y verificados LOCALMENTE, pendientes de publicar; no interpretar el estado inicial de este documento como estado productivo actual.

Alcance final de masivos: texto propio, colecciones, precio/adjuntos sin mezcla gratis/pago, programación, repetición, nombres, etiquetas, franjas/finalización, retirada y filtros de gasto/última compra por modelo/agencia. Sin IA, traducción ni GIF externo. Compra significa PPV/post confirmado, edad en días completos; agencia incluye todas las modelos registradas y bloquea si alguna no puede verificarse. Audiencia fijada al preparar, sin reevaluación automática de filtros en cada repetición. Estados financieros desconocidos bloquean; no se convierten en cero ni se aceptan como compra confirmada.

Comprobaciones: 920 pruebas, build, 97 SQL locales y 8 pruebas del bundle candidato. `scripts/build-live-financial-bundle.mjs` conserva helpers previos de chat/baúl y genera `/private/tmp/bruff-live-financial.js` sin desplegar. El worker legado sigue rechazado. Migraciones 031–032 requieren publicación coordinada con backend/frontend. Esta continuación no consulta cuentas reales, activa campañas, envía ni retira mensajes reales. Ver el último checkpoint de `docs/PRODUCTION-PLAN.md` para comandos, hashes y límites.

Estado: módulo preparado y probado, no instalado como endpoint ni programado. No cambia el sitio productivo y no puede enviar por sí solo.

server/advanced-delivery.js conecta personalización con una interfaz de almacenamiento y proveedor. Requiere activación explícita, ámbito agencia/modelo/fan, reserva con versión y caducidad, comprobación de permisos antes y después de lecturas, moderación del texto final, medios verificados, respuesta del fan y presencia reciente. Un resultado incierto no vuelve automáticamente a pendiente.

## Adaptadores todavía necesarios

- Cola persistente PostgreSQL con reserva exclusiva, expiración y auditoría. claim nunca debe devolver registros sending/sent/uncertain.
- begin debe comprobar de forma atómica campaña activa, revisión, permisos vigentes, lease, hora, finalización y ausencia de envíos previos. Debe persistir el payload exacto antes de contactar al proveedor.
- context debe consultar el nombre original y el alias BRUFF de la misma modelo/fan; no aceptar contexto aportado por el navegador.
- resolveMedia debe verificar propiedad, disponibilidad y correspondencia exacta de todos los adjuntos y slots antes de preparar el payload del proveedor.
- Adaptador OFMAPI de envío con precio y slots comprobados contra su contrato. No asumir que dos proveedores usan el mismo formato.
- Descubrimiento de destinatarios, filtros completos, horarios, secuencias y cancelaciones.
- Endpoint de control autenticado y centro unificado de estados.
- Programador desplegado con campañas detenidas, seguido de una prueba de entrega únicamente a un destinatario acordado.

Validación: 7 casos nuevos, 244 pruebas totales y compilación correctas. Solo fixtures: no hubo envíos, cambios de campaña ni conexiones de producción.

## Cola persistente · 02/11
Migración 019 aplicada en Supabase. Tablas privadas, RPC exclusiva de service_role y estados pending/claimed/sending/sent/uncertain/blocked. Reserva exclusiva con lease y revisión, payload persistido antes de escribir al proveedor, pausas y revocaciones comprobadas antes de begin. Estado sending expirado pasa a uncertain, nunca a pendiente. Ningún scheduler ni ruta de activación instalado. Adaptador server/advanced-store.js preparado.

19 comprobaciones PostgreSQL locales correctas; 244 pruebas y compilación. Pendiente: descubrimiento y carga de la cola, controles autenticados de ejecución, resolución de contexto/medios, proveedor y programador. La cola vacía instalada no equivale a motor operativo.

## Comprobación de audiencia masiva · 02/11

Ruta `automation_audience` en bruff-live, desplegada como lectura sin activar ni encolar. Lee la versión guardada del borrador desde RPC, exige propietario/manager y permiso send, resuelve el binding desde la base de datos y revalida permisos en cada consulta. Recorre fans paginados o colecciones completas, deduplica y aplica exclusiones. Rechaza listas parciales, cursores repetidos, límites excedidos, cambios de versión y filtros aún sin resolver. La selección manual se contrasta con el directorio de la modelo. La interfaz ofrece «Comprobar audiencia guardada»; exige borrador cloud sin cambios pendientes.

No es activación ni garantiza elegibilidad de entrega. Todavía faltan persistencia del descubrimiento para trabajos largos, encolado, controles de ejecución, programador y adaptadores de envío/contexto. Fuente contractual: https://ofmapi.com/openapi.json (fans y lists/{list_id}, consultada 02/11). Siete pruebas nuevas del resolver y ruta autenticada; 859 pruebas totales correctas. El despliegue conserva el bundle productivo anterior y añade solo la lectura; no instala el worker antiguo 014–015.
# Verificación de producción — 2 de noviembre de 2026

La comprobación de audiencia está publicada en Sites y en `bruff-live`, protegida por sesión, permisos por modelo y versión del borrador. La prueba real con un borrador de Lana devolvió HTTP 429 del proveedor. La interfaz informa «El proveedor limita las consultas. Reintenta más tarde» y no devuelve una audiencia parcial. El borrador de prueba se archivó de forma recuperable; no se activó ni se envió ningún mensaje.

Esto NO valida todavía la audiencia completa de las tres modelos ni la ejecución automática. Pendiente: sincronización persistente/reanudable con control de cuota, adaptación real del proveedor a la cola, activación/pausa y planificador. Las pruebas locales y la compilación pasan, pero no equivalen a una validación de entrega en producción.


## Reanudación persistente · 02/11
Migración 020 y módulo `audience-discovery.js`: checkpoint privado por agencia/modelo/borrador/revisión/conexión, reserva exclusiva de 90 s y caducidad de 30 minutos. Cada página válida se confirma antes de continuar; una consulta posterior retoma el cursor sin volver a leer páginas anteriores. HTTP 429 respeta Retry-After (30 s–24 h); no activa, encola ni envía. RPC únicamente service_role, comprobaciones actuales de propietario/manager y modelo conectado, sin acceso directo de navegador. El endpoint vuelve a verificar la sesión y los permisos antes de cada RPC.

La interfaz continúa automáticamente tras la espera indicada mientras el editor permanezca abierto, muestra cuenta atrás y permite detener la comprobación. Cambiar modelo/borrador o salir cancela la continuación del navegador; una lectura ya iniciada puede terminar de guardar su página. No hay scheduler de descubrimiento ni envíos. La cuota no se coordina globalmente entre otras funciones de OFMAPI. Colecciones se siguen verificando íntegramente en cada intento; el checkpoint guarda el directorio paginado de fans. No presentar esta fase como ejecución completa de automatizaciones.

Validación local: 865 pruebas de aplicación, build y 57 comprobaciones PostgreSQL (incluyen 14 nuevas de checkpoint, aislamiento, reserva concurrente, espera, bloqueo de acceso anónimo/directo y revocación). Proveedor ficticio en pruebas; ningún envío real.

Prueba productiva: migración 020 aplicada y bruff-live desplegado; dos peticiones consecutivas guardaron 2 páginas/20 fans en Supabase, sin lease retenido y sin envíos. Esto valida reanudación del directorio de Lana, no la totalidad de las tres modelos.

## Controles de ejecuciones · 02/11
Migración 021 instalada: RPC autenticada `bruff_advanced_runs` con consulta de estados/contadores y pausa, continuación y detención de ejecuciones existentes. Bloqueo compartido de agencia + ejecución, rol propietario/manager vigente, permiso por modelo, revisión optimista. Pausar invalida reservas anteriores a `begin`; detener bloquea pendientes y no permite continuar esa ejecución. Las entregas `sending` no se borran ni vuelven a pendientes: pueden finalizar y conservar su resultado después de pausar/detener. Continuar conserva horario original y exige borrador/revisión, conexión y autoridad de activación vigentes. No crea ni activa ejecuciones.

Panel `AutomationRuns` conectado al RPC, dentro de borradores cloud, actualización visible cada 5 segundos, cambio de modelo/borrador invalida resultados pendientes. Confirma continuación/detención y muestra pendientes, en curso, enviados, inciertos y bloqueados; no inventa ejecuciones ni estadísticas.

Planificador puro `server/advanced-schedule.js`: fechas futuras, intervalos, duración/final por fecha/número, ciclos anclados y omisión de intervalos perdidos para evitar ráfagas tras una interrupción. NO es un Cron desplegado. La propuesta técnica de ventana de entrega única de 24 h debe mostrarse en la revisión de activación antes de conectarlo; hoy no gobierna campañas reales.

Validación: 870 pruebas de aplicación, compilación y 121 comprobaciones SQL aisladas; UI ficticia recorrió pausar/continuar/detener y cambio de modelo. Ninguna campaña real activada ni enviada. Faltan creación/activación de ejecuciones desde audiencia final, proveedor/contexto/medios, disparadores de bienvenida/presencia y scheduler. No interpretar la RPC de controles como un motor completo disponible.
