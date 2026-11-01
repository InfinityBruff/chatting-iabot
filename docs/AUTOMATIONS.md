# Automatizaciones reales — despliegue y límites

Implementación preparada el 01/11/2026. **Pendiente de autorización y despliegue en Supabase; no confundir las pruebas locales con producción.**

## Arquitectura
- `bruff_automations`: RPC autenticada, agencia/modelo derivadas de membresía y permisos existentes. Propietario y manager preparan/pausan; solo propietario activa. No acceso directo a tablas.
- Guardar crea un borrador desactivado. Versiones evitan sobrescrituras entre dispositivos. Cada modelo tiene reglas independientes. No se importan ejemplos/localStorage automáticamente.
- `bruff_automation_worker`: servicio interno, sin permiso para anon/authenticated. Un secreto aleatorio de 256 bits guardado en Vault autentica el reloj; la base conserva únicamente su hash. No secretos en cliente, Git, argumentos de comandos ni logs.
- Cron cada minuto llama a `bruff-live`. Reclama hasta tres reglas con bloqueo y arrendamiento; hasta diez envíos por regla/ciclo, con límite temporal. Las campañas grandes son progresivas y pueden tardar varios ciclos.
- Antes de enviar se comprueban regla activa, arrendamiento, propietario activo, correo confirmado, conexión y vínculo de modelo, política de palabras. Revalidación después de lecturas externas y antes del POST.
- Recibos persistentes por fan y regla, clave idempotente por intento, autoría BRUFF. Resultado incierto no se reenvía automáticamente; requiere revisar el historial. Pausar no retira una petición ya aceptada por el proveedor.

## Comportamientos
- **Masivos:** texto gratuito a selección guardada o directorio completo paginado, incluidos caducados. La audiencia completa se descubre desde la activación, no es una instantánea transaccional de OnlyFans. Una sola entrega por fan/regla; una campaña completada no se reactiva. Las campañas que ya empezaron conservan su configuración.
- **Bienvenida:** motor BRUFF, basado en avisos de alta con fecha explícita posterior a la activación; una bienvenida por fan/regla. Excluye renovaciones identificadas, eventos antiguos, futuros y sin fecha. No sustituye la bienvenida nativa de OnlyFans. Antes de activar, el propietario confirma haber revisado otras herramientas para evitar duplicados. Si el proveedor no entrega una alta o no la identifica, BRUFF no la inventa.
- **En línea:** usuarios seguidos que OFMAPI devuelve en `all_online`, no garantiza todos los suscriptores. Presencia caduca a los 45 segundos antes del envío. Recorrido paginado. Espera mínima 24 horas por fan/modelo; eso limita el máximo efectivo a uno cada 24 horas aunque el tope diario elegido sea mayor. Se puede excluir actividad de chat de los últimos 30 minutos; lectura incompleta bloquea el envío.
- Funciona con navegador cerrado, sujeto a disponibilidad de Supabase/OFMAPI. No promete tiempo real instantáneo. En esta versión, sin adjuntos ni PPV.

## Orden de despliegue
1. Ejecutar `202611010014_automations.sql` una sola vez. Tablas vacías; ninguna regla activa.
2. Desplegar `bruff-live` incluyendo `automation-worker.js` y `handler.js` actualizado. Conservar su validación de sesión existente y secretos actuales; no cambiar JWT ni permisos del proveedor.
3. Ejecutar `supabase/automation-scheduler.sql`. Genera el secreto internamente y programa el reloj; no devuelve la credencial. No activa reglas.
4. Confirmar `automation_runtime.last_tick` reciente y cero reglas activas/entregas. El cliente bloquea activación si no hay latido en los últimos tres minutos.
5. Publicar frontend mediante Sites privado y GitHub con control del SHA esperado.
6. QA autenticada: guardar borrador técnico desactivado, recargar/recuperar, comprobar aislamiento de las tres modelos, archivar el borrador. Nunca pulsar «Activar envíos reales» durante QA.

## Verificación local
`pnpm check`: pruebas de trabajador con proveedor simulado, clasificación de altas, cursor repetido, ausencia de envíos, revocación, actividad reciente y resultados inciertos. Pruebas PostgreSQL en `scripts/check-team-database.mjs`: RLS/RPC, roles, agencia/modelo, versiones, doble claim, recibos, pausa, términos bloqueados y revocación de conexión. Son pruebas locales, no envíos reales.

Referencias oficiales consultadas: https://ofmapi.com/openapi.json y https://supabase.com/docs/guides/functions/schedule-functions .

## Auditoría de estados · 01/11/2026
- Producción inspeccionada: los tres editores siguen en «Preparación · Envíos sin activar», con borradores locales. El despliegue sigue pendiente; no se han probado envíos reales.
- Corregido: solo una regla activa puede pausarse; una campaña completada no vuelve a un estado reactivable mediante pausa.
- Corregido: una entrega incierta detiene la regla activa y la muestra en revisión; el siguiente ciclo también detecta confirmaciones interrumpidas. No se oculta como una regla activa saludable.
- Matriz PostgreSQL de tres tipos por tres modelos, con guardado, activación, pausa, reanudación, deduplicación, aislamiento y estado final. Fecha futura excluida de ejecución; ausencia de confirmación bloquea continuación en todos los tipos.
- Resultado: 251 comprobaciones PostgreSQL y 205 pruebas de aplicación, compilación correcta. Todo con datos de prueba y proveedor simulado, sin envíos reales. Esta revisión no autoriza el despliegue pendiente ni activa reglas.

## Publicación visual independiente
El estudio visual puede publicarse antes del backend: únicamente PGRST202 (RPC ausente) habilita el modo de preparación local anterior. Se indica «Preparación · Ejecución pendiente», ningún borrador se presenta activo, y activar permanece deshabilitado. Errores de red o permisos no se reinterpretan como disponibilidad del backend. Con la RPC desplegada se utiliza nube; nunca se migran ni activan borradores locales automáticamente. Esta excepción reemplaza la restricción anterior de publicación conjunta solo para el frontend con esta protección.
