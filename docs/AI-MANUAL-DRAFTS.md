# Conocimiento y borradores manuales de BRUFF IA

La ampliación opcional de control, aprobación y delegación desde el chat se documenta en [AI-AUTOPILOT.md](AI-AUTOPILOT.md). El catálogo anterior de doce herramientas se conserva mientras el flag de acciones del propietario esté apagado; las descripciones siguientes de revisión exclusiva en el CRM corresponden a ese contrato anterior. La ampliación no habilita nada automáticamente al añadir su código.

El conocimiento persistente es independiente del historial de ChatGPT. El conector permite guardar explícitamente reglas de estilo, datos de la modelo y límites como borradores con fuente y versión. El propietario los revisa y aprueba en BRUFF. Guardar una nota no importa automáticamente un chat, no aprueba ejemplos y no entrena los pesos de un modelo.

## Dos tipos de respuesta

- **Banco / búsqueda semántica:** originales documentados, con su traducción y referencia. Se conserva el contrato de SQL040/041.
- **Generación manual:** texto nuevo, identificado como **Borrador IA · Revisar**, con inglés, traducción, referencias utilizadas y datos pendientes. No se presenta como un original verificado.

El panel ofrece dos modos explícitos: **Crear con IA** y **Buscar ejemplos**. El primero comprueba activación y fuentes antes de llamar al motor; una falta de configuración o un error no se sustituye por una búsqueda de originales. Los avisos distinguen generación desactivada, fuentes pendientes de aprobación, errores de contexto/configuración/proveedor y cuotas. Elegir un modo no inicia consultas. El último mensaje confirmado del fan se conserva al compactar el contexto; tanto JSON estructurado como JSON textual del proveedor pasan la misma validación.

La generación usa Mistral Small 3.1 (`@cf/mistralai/mistral-small-3.1-24b-instruct`) alojado en Cloudflare Workers AI. El modelo tiene licencia Apache 2.0; el alojamiento es un servicio de Cloudflare. No depende de OnlyX ni ejecuta herramientas de envío. Este primer motor prepara conversación no explícita; no genera guiones eróticos, propuestas de contenido ni precios.

## Enseñanza y revisión

1. Identificar la agencia y modelo con el conector privado.
2. Guardar una regla, dato, límite o ejemplo con una referencia real y versión. La instrucción del usuario es necesaria; no se copia todo el chat.
3. Revisar en el CRM y aprobar mediante la cuenta de propietario. Los borradores quedan fuera de las consultas.
4. Resolver datos contradictorios: solo se admite un dato aprobado por clave y modelo.
5. Modificar o archivar con la versión vigente. Las fuentes cambiadas invalidan los borradores generados que dependían de su revisión anterior.

El conector puede consultar y desactivar preferencias de generación. Habilitarla y aceptar la transferencia de contexto se realiza en el CRM. El nombre del chat de administración no autentica al propietario; lo hacen OAuth, la sesión y la autorización en base de datos.

«Memoria chats 1» es el chat de administración elegido. El enlace al CRM son las llamadas explícitas al conector privado: una enseñanza seleccionada se guarda como borrador por modelo con referencia y versión; el propietario la aprueba en BRUFF y las consultas posteriores pueden utilizarla. No se lee ni importa automáticamente todo lo escrito en ChatGPT. Antes de informar del estado, el chat debe consultar la configuración persistente y distinguir propuestas de código de cambios desplegados.

El conector ofrece doce herramientas, incluida `bruff_read_generation_quota`: devuelve los límites y consultas de la modelo y los agregados del presupuesto compartido del generador, con fecha y reinicio UTC. Exige sesión real y propietario actual, devuelve solo campos permitidos y no consulta fans, ejecuta IA ni cambia preferencias. El presupuesto compartido no se suma por modelo ni representa el consumo global de Cloudflare. Si una conexión conserva un catálogo antiguo, debe actualizarse mediante «Actualizar herramientas» y comprobar su disponibilidad en el chat; publicar el backend no acredita por sí solo que ese chat haya recibido herramientas nuevas.

## Contexto e inferencia

`bruff-drafts` acepta solo operación manual (`generate`/`verify`), agencia, modelo, conversación y UUID de petición. `generate` admite además `force: true` únicamente para la acción explícita **Regenerar**. No admite historial, instrucciones globales, proveedor ni mensajes del navegador como fuente autorizada. Comprueba la sesión real y obtiene el historial mediante una lectura fija de `bruff-live`, con prioridad de fondo para conservar la del chat.

Se usan hasta 20 mensajes confirmados recientes, hasta seis ejemplos y una selección de conocimiento aprobado, con límite total de 12.288 bytes de mensajes al motor y 900 tokens de salida. No se añaden credenciales de conexión, archivos multimedia ni metadatos identificativos de autores. Al texto del historial se aplican filtros de URLs y menciones @; el texto de ejemplos y conocimiento aprobados se comparte sin esos mismos filtros. Los identificadores de referencias se sustituyen por alias temporales antes de enviarlos al modelo. La consulta conserva contenido privado del chat, por lo que exige la autorización del propietario para compartir ese contexto con Cloudflare.

La salida JSON se valida antes de aceptarla: ámbito, referencias reales, duplicados, longitudes, variables, contenido explícito, importes y afirmaciones evidentes sin respaldo. Estas comprobaciones no demuestran que toda prosa libre sea correcta. El operador debe revisar la respuesta y su traducción antes de insertarla o enviarla. Puede haber cero, una o dos propuestas; no se inventa una tercera para completar el panel.

## Integridad y permisos

- SQL042 crea tres tablas privadas con RLS, sin acceso directo de clientes.
- La gestión de fuentes y preferencias es solo del propietario confirmado. Consultar borradores requiere permisos actuales de lectura y envío de esa modelo.
- La reserva deriva al trabajador de su sesión real. La clave de servidor se limita a dos RPC fijos: liquidar el consumo de una reserva existente y registrar una salida ya validada contra ella. No se usa para leer historiales ni para impersonar usuarios.
- El resultado canónico queda ligado a trabajador, agencia, modelo, fan, contexto, fuentes y caducidad. Antes de insertar se vuelve a comprobar y se compara el texto exacto. Ninguna de estas operaciones envía mensajes.
- El historial del proveedor conserva su caché existente de hasta cuatro segundos. Releerlo detecta cambios observados; no garantiza una observación instantánea de OnlyFans.
- Los borradores caducan lógicamente a los diez minutos. La limpieza de su contenido es oportunista al reservar; no hay un trabajo nuevo que garantice borrado físico exacto al vencer el plazo. La metadata de uso conserva las cuotas y se limpia tras treinta días en ese mismo proceso.

## Reutilización sin inferencia nueva

**Generar respuestas** busca primero un resultado vigente con exactamente el mismo trabajador, agencia, modelo, fan, revisión de fuentes y configuración, huella del historial confirmado y versión del motor. La base de datos realiza la comprobación atómicamente antes de reservar cuota. Una coincidencia conserva su identificador y caducidad originales; no consulta Cloudflare ni consume otra reserva. Se vuelve a leer el historial y las fuentes antes de entregarla.

**Regenerar** pide una inferencia nueva por acción humana. Dos solicitudes idénticas pendientes, incluso forzadas, no ejecutan dos inferencias simultáneas: se devuelve una espera acotada de hasta 45 segundos, sin reintento automático. Un error reciente puede conservar esa espera mientras se descarta una solicitud en curso. La liquidación del consumo no equivale a que el borrador esté terminado.

El panel distingue generado y reutilizado, muestra la hora de caducidad, el consumo calculado, las reservas estimadas y el cupo compartido del módulo. Solo consulta estos contadores al abrir el contexto, al consultar y al actualizar manualmente; no crea un sondeo de fondo ni carga otras conversaciones. El registro de un resultado generado no es un ejemplo documental aprobado.

## Límites del plan gratuito

La generación está desactivada por defecto. El límite inicial para modelos sin configuración es 100 consultas nuevas al día, editable por el propietario entre 1 y 1.000. Cambiar el máximo admitido no altera automáticamente preferencias existentes ni habilita modelos. Este es un tope de solicitudes, no una promesa de disponibilidad: el presupuesto compartido de 7.500 neuronas por día UTC y dos consultas nuevas por minuto por trabajador siguen aplicándose.

Cada inferencia nueva reserva primero 600 neuronas. Si Cloudflare informa tokens válidos, el servidor registra entrada/salida y liquida la reserva con la tarifa de Mistral Small 3.1: ceil((entrada × 31.876 + salida × 50.488) / 1.000.000), con mínimo de una neurona. Son tokens observados y neuronas calculadas, no una lectura de la factura de Cloudflare. La liquidación es atómica e idempotente; el primer resultado queda fijado. El consumo calculado puede superar la reserva y nunca se recorta para aparentar más cupo.

Sin datos de uso válidos, o ante un resultado incierto, se conservan las 600 neuronas. El consumo observado se registra aunque después falle la validación del texto o cambie el contexto. No hay reintentos automáticos. Las reservas anteriores a SQL043 mantienen su estimación. La fecha de uso corresponde al día UTC de inicio de la reserva.

La reserva de solicitudes pendientes o inciertas es una estimación conservadora, no una medición del proveedor. El cupo Workers AI Free es compartido con otros usos de la cuenta, incluida la búsqueda semántica existente. BRUFF no conoce todo ese consumo; el límite local no garantiza cuota restante. No se contratan planes ni se configura pago automático.

## Verificación y despliegue

Ejecutar `pnpm check` y los verificadores `scripts/check-ai-generation-database.mjs` y `scripts/check-ai-generation-budget-database.mjs`, pasando la ruta del módulo PGlite instalado. Usan PostgreSQL en memoria con identidades y datos ficticios, sin conexiones reales. `node scripts/build-manual-ai-functions.mjs /ruta/absoluta/externa` genera los dos bundles revisables sin desplegarlos.

Orden inicial: aplicar SQL042 y después SQL043, desplegar `bruff-drafts` con su validación de sesión y actualizar `bruff-control`, publicar el frontend, actualizar las instrucciones del plugin privado y comprobar las herramientas. SQL043 conserva los estados habilitados y los límites ya guardados; el propietario puede cambiarlos con control de versión en BRUFF. Las modelos nuevas siguen desactivadas hasta revisar fuentes y autorizar una primera consulta manual. Las pruebas locales no acreditan el secreto, la cuota o la calidad de una inferencia real.

Referencias oficiales: [modelo y parámetros](https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/), [licencia del modelo](https://mistral.ai/news/mistral-small-3-1/), [precios y cuota gratuita](https://developers.cloudflare.com/workers-ai/platform/pricing/).
