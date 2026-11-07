# Catálogo y seguimiento del fan

El panel del gorila incorpora una pestaña «Catálogo y seguimiento». Consulta el catálogo privado de la modelo activa y las observaciones guardadas para esa agencia, conexión y fan. La identidad y los permisos siguen en Supabase; los metadatos se almacenan en Turso. No se descargan originales ni se guardan textos de conversación, miniaturas, URLs firmadas o credenciales en esta memoria.

## Evidencia y alcance

El servidor lee mensajes mediante `bruff-live`, nunca acepta mensajes o compras suministrados por el navegador. Solo relaciona un archivo con el catálogo cuando coincide su identificador en la misma modelo. Un mensaje real saliente permite registrar un envío observado; su precio corresponde al conjunto completo. Ausencia de precio no equivale a gratis. `isOpened`, `seenByFan`, disponibilidad o una transacción sin enlace al mensaje no confirman una compra por archivo. La compra permanece sin confirmar.

El catálogo conserva su lote inmutable y sigue en borrador: etiquetas, referencias orientativas de precio y orden cronológico no son una secuencia comercial aprobada. Esta integración no añade ofertas automáticas ni contenido a las respuestas generadas, no cambia el compositor y no activa bots, campañas o envíos.

La ampliación de [propuestas manuales de contenido](CATALOG-CONTENT-PROPOSALS.md) permite revisar un archivo y su precio de referencia junto a una opción de texto, como una propuesta separada del texto canónico. Requiere comprobación y confirmación antes de preparar el borrador; no activa una secuencia ni acredita un envío o una compra.

La copia guardada se muestra al abrir la pestaña; después se comprueba una página reciente, con refresco cada 60 segundos solo mientras la pestaña está abierta y visible. «Ampliar historial» continúa una página anterior desde el cursor guardado en la nube. Llegar al final es el final reportado por esa lectura, con su fecha, no una auditoría de toda la actividad del fan. Los fans nuevos empiezan sin observaciones; no se inventa su progreso. Cerrar el gorila no inicia un rastreo de todas las cuentas.

## Configuración de servidor

1. Mantener las cuatro tablas de catálogo existentes. Aplicar únicamente `supabase/migrations/turso/202611070001_fan_script_progress.sql` en la misma base Turso. La migración no contiene IDs reales ni datos de fans.
2. Guardar en Edge Secrets `BRUFF_MEMORY_TURSO_URL` (URL de esa base), `BRUFF_MEMORY_TURSO_TOKEN` (token de acceso limitado a esa base) y `BRUFF_MEMORY_CATALOG_BATCH` (huella del lote revisado). Ninguno se incluye en el bundle del navegador. Guardar `BRUFF_MEMORY_ENABLED=true` habilita exclusivamente esta memoria.
3. Desplegar `bruff-memory`. Utiliza Auth `getUser` y `bruff_live_authorize` para cada ámbito, y vuelve a comprobar los permisos antes de guardar y devolver resultados. El gateway legacy JWT debe quedar desactivado únicamente en esta función, previa autorización: el handler implementa su validación de sesión. No se cambia la autenticación de funciones existentes.
4. Comprobar las tres modelos con una sesión autorizada, sin enviar mensajes. La cuenta actual debe coincidir con el usuario de origen del catálogo. Una reconexión cambia el ámbito de seguimiento; no se hereda el progreso de otra conexión por nombre de fan.

Un error de configuración o de la nube no se convierte en datos de demostración. Los permisos se consultan en cada petición; no se heredan automáticamente las políticas RLS de Supabase en Turso. Las comprobaciones antes y después de la operación no crean una transacción distribuida entre ambos proveedores.

## Persistencia y concurrencia

Las observaciones son idempotentes y conservan la fecha/actor de la lectura del servidor. Las variantes de evidencia se anexan; no sobrescriben el catálogo. El último estado observado se presenta por mensaje y archivo. Primero se guardan atómicamente las observaciones de la página y después se avanza su checkpoint con comparación de versión. Si otra sesión se adelanta, el checkpoint antiguo no retrocede; los hechos ya guardados pueden repetirse de forma idempotente en la siguiente lectura. Esto no es un recibo de envío del motor ni un enlace financiero a un vídeo.

El almacenamiento tiene los límites del plan del proveedor. No se promete uso gratuito ilimitado, no se habilitan excesos de pago y no se añaden tareas de sondeo global ni reloj nuevo.

## Verificación

`pnpm check` incluye pruebas de extracción, HTTP parametrizado/SQLite real, aislamiento de ámbito, revocación, reconexión, duplicados, conflicto de checkpoint y ausencia de rutas de envío. `node scripts/build-memory-function.mjs /ruta/privada/de/salida` genera el bundle de la función y sus hashes sin realizar despliegues.
