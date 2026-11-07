# Control del asistente desde el chat de administración

Esta entrega añade un control privado del propietario y un ejecutor independiente de ChatGPT y OnlyX. La presencia del código no acredita su despliegue: las funciones nuevas, SQL044, el receptor de eventos, la firma del proveedor, el reloj y las herramientas del App deben verificarse por separado. Todo queda desactivado por defecto; guardar una configuración apagada o desplegar no inicia respuestas a fans.

## Trabajo diario

El propietario identifica agencia y modelo con `bruff_list_models`. «Memoria chats 1» es su chat preferido, pero el título no autentica ni importa su contenido: cada llamada usa OAuth y comprueba el propietario real y vigente.

- **Conocimiento:** guardar una enseñanza seleccionada como borrador con referencia real; preparar su revisión con `bruff_prepare_source_approval`; mostrar el texto y aprobar exactamente esa versión y huella mediante `bruff_approve_source`. Modificar después una fuente la devuelve a borrador. No se aprueba un chat entero ni se inventan fuentes.
- **Diagnóstico:** `bruff_list_conversations` y `bruff_read_conversation` consultan páginas acotadas de la modelo y fan seleccionados. Indican si el historial es parcial y no descargan medios. Solo los datos seleccionados llegan al chat de administración.
- **Tres propuestas:** `bruff_generate_replies` consulta el motor de Cloudflare con hasta veinte mensajes recientes y fuentes aprobadas de esa modelo. Reutiliza un resultado vigente cuando corresponde; `force:true` exige la acción expresa de regenerar. Puede devolver menos de tres propuestas o ninguna. Son texto nuevo, no ejemplos originales ni afirmaciones verificadas.
- **Elección manual:** mostrar modelo, fan y texto inglés exacto; tras confirmación usar `bruff_queue_selected_reply`. El servidor verifica de nuevo el borrador canónico, fuentes, contexto y caducidad antes de crear un trabajo duradero. La cola no equivale a entrega; solo `sent` con `providerId` acredita confirmación del proveedor.
- **Delegación:** consultar configuración y versión, guardar alcance por modelo (todos o hasta 500 fans seleccionados), demora de 10–120 segundos y límite de 1–20 respuestas diarias por fan. `drafts` prepara propuestas; `automatic` también elige la primera propuesta válida y envía. Requiere consentimiento de contexto y de envío automático, fuentes y generador habilitados y runtime preparado. No existe activación implícita de las tres modelos.
- **Pausa:** `bruff_pause_autopilot` apaga la modelo con control de versión y bloquea las preparaciones automáticas pendientes. La intervención manual desde el CRM cancela preparaciones del mismo fan. Una llamada al proveedor ya iniciada no puede retirarse mediante la pausa.
- **Actividad:** `bruff_read_autopilot_activity` devuelve hasta cincuenta trabajos por modelo, propuestas disponibles, opción utilizada, consumo y recibos. Distingue borrador, cola, preparación, envío, confirmado, bloqueado e incierto.
- **Incertidumbre:** no se reintenta un envío sin confirmar. Tras revisar el trabajo concreto, `bruff_review_uncertain_reply` registra la nota del propietario con su versión. Mantiene `uncertain`, conserva la auditoría, prohíbe reenviar ese trabajo y deja la modelo pausada. Solo una activación posterior permite eventos futuros; la revisión no demuestra ni envío ni ausencia de envío.

## Alcance del motor

El motor actual admite conversación de texto **no explícita**, en inglés con traducción española, usando ejemplos y conocimiento aprobados. No genera conversación erótica, scripts, ventas, precios ni adjuntos. El modo automático tiene un contrato de instrucciones y versión de motor distintos del generador manual. No elige la respuesta «mejor demostrada»: selecciona la primera opción que supera la validación. Un dato desconocido o falta de propuestas deriva a revisión.

La generación no reentrena pesos y no garantiza que toda prosa libre sea correcta. Las instrucciones de fans, documentos, ejemplos y guías son datos no fiables, no autorización para ejecutar herramientas o cambiar permisos. La investigación periódica de ChatGPT no se presenta como sincronizada hasta comprobar su propia conexión y ejecución.

## Arquitectura y aislamiento

1. OFMAPI entrega un evento firmado. `bruff-ai-events` verifica HMAC sobre el cuerpo original y timestamp, acepta solo los tipos admitidos y guarda ocho campos de metadata, sin texto de mensajes.
2. SQL resuelve una única conexión vigente de modelo. Una cuenta vinculada ambiguamente a varias agencias se rechaza; no se difunde el evento a varias. Se deduplica evento y mensaje por ámbito.
3. Una configuración autorizada crea un trabajo con demora y caducidad. No se responde a eventos anteriores a su activación. Una notificación de salida o mensaje recibido más reciente cancela la preparación obsoleta.
4. `bruff-ai-runner` reclama como máximo un trabajo con lease y deriva propietario, agencia, modelo, fan y conexión exclusivamente del registro. No usa un JWT inventado ni cambia `auth.uid()`.
5. Consulta fuentes y últimos mensajes mediante rutas fijas, con el turno secundario del proveedor para conservar la prioridad del chat. La inferencia nueva comparte presupuesto con el generador manual. Una elección manual reutiliza el resultado canónico v2 y no ejecuta Cloudflare otra vez.
6. Antes de enviar revalida contexto, fuentes, permisos actuales, intervención humana y moderación. SQL fija texto inmutable, origen «BRUFF IA» e idempotencia por trabajo. No se atribuye a un trabajador como si lo hubiera escrito personalmente.
7. Un resultado ambiguo queda en revisión y no se repite. Los recibos pueden cerrarse después de una revocación para conservar la contabilidad, sin leer nuevos datos de fans ni autorizar otro envío.

Las tablas nuevas son privadas y tienen RLS, sin acceso directo de clientes ni del rol de servicio. El propietario solo usa RPC fijos con su sesión. El rol de servicio solo dispone de las operaciones acotadas del receptor/ejecutor y los controles secundarios de lectura ya existentes. Las proyecciones del App excluyen leases, conexiones, tokens, medios y URLs firmadas.

## Controles de despliegue

Los flags son independientes y estrictamente `true`:

| Flag | Efecto |
|---|---|
| `BRUFF_CONTROL_OWNER_ACTIONS_ENABLED` | Expone el catálogo ampliado; apagado conserva las doce herramientas anteriores |
| `BRUFF_AI_AUTOPILOT_ENABLED` | Permite procesar eventos y trabajos |
| `BRUFF_AI_AUTOPILOT_SEND_ENABLED` | Permite al ejecutor iniciar el envío; apagado aparca las propuestas sin reactivarlas después |
| `BRUFF_AI_AUTOPILOT_RUNTIME_READY` | El App puede aceptar activación solo tras comprobar reloj, firma y funciones |

Orden: revisar/aplicar SQL044, desplegar control y las dos funciones nuevas, configurar firma del proveedor y reloj, comprobar con configuraciones de modelos apagadas, actualizar instrucciones del plugin preservando App/identidad/audiencia y refrescar herramientas. Las nuevas tablas no crean un Cron, secreto, suscripción de webhook ni configuración habilitada.

El receptor externo usa firma HMAC y necesita que su gateway no exija JWT de Supabase. El ejecutor mantiene JWT del gateway y además exige la credencial de servicio exacta; no admite una sesión de usuario. El control conserva su validación de propietario. Cambiar protecciones o ampliar acceso exige la autorización aplicable antes de guardar.

La firma del webhook se crea y se guarda por el propietario en las interfaces oficiales; no se pega en chats ni repositorios. Las credenciales existentes permanecen en secretos del servidor. El despertar opcional vía `waitUntil` solo llama por HTTPS al ejecutor del propio proyecto con `{job_id}`; no retrasa el acuse del webhook ni acredita envío. Los trabajos con demora siguen esperando su fecha.

El reloj debe consultar en SQL si existen trabajos vencidos antes de invocar una función. No debe enviar una invocación vacía cada pocos segundos. El intervalo elegido, permisos y autenticación deben comprobarse en el proyecto; el código de esta migración no instala el reloj. Un lease evita dos reclamaciones del mismo trabajo aunque se solapen invocaciones. Ningún cambio aumenta automáticamente la capacidad de OFMAPI.

OFMAPI documenta a la vez frescura de firma de cinco minutos y reintentos que conservan la firma original. Un reintento más antiguo puede ser rechazado: se conserva la protección de frescura y no se presenta esa entrega tardía como resuelta. No se elude el problema desactivando la firma.

## Consumo y pruebas

No hay uso gratuito ilimitado. Se comparten las preferencias y el presupuesto diario UTC de 7.500 neuronas del generador BRUFF, reservas conservadoras de 600 y dos consultas nuevas por minuto por actor. Las cuotas y disponibilidad de Cloudflare, Supabase y OFMAPI son independientes. No se contrata ni amplía un plan al desplegar este código.

Pruebas sin red:

```sh
BRUFF_PGLITE_MODULE=/ruta/al/modulo/pglite/dist/index.js pnpm check
node scripts/check-ai-autopilot-database.mjs /ruta/al/modulo/pglite/dist/index.js
node scripts/check-ai-runtime.mjs /ruta/al/modulo/pglite/dist/index.js
node scripts/build-manual-ai-functions.mjs /ruta/externa/artefactos --autopilot
```

La integración ejecuta SQL y el worker reales con identidades, eventos y proveedores ficticios. Comprueba elección manual sin nueva inferencia, generación automática, contexto cambiado después de guardar el resultado, duplicados, pausa y resultado incierto. Esas pruebas no acreditan un mensaje real ni calidad garantizada de conversación.

Referencias oficiales: [eventos y firma OFMAPI](https://www.ofmapi.com/docs/webhooks), [Cron de Supabase](https://supabase.com/docs/guides/cron), [programación de funciones](https://supabase.com/docs/guides/functions/schedule-functions).
