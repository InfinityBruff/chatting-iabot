# Ejecutor avanzado: coordinación de entregas

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

