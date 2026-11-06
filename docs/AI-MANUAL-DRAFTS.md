# Conocimiento y borradores manuales de BRUFF IA

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

## Contexto e inferencia

`bruff-drafts` acepta solo operación manual (`generate`/`verify`), agencia, modelo, conversación y UUID de petición. No admite historial, instrucciones globales, proveedor ni mensajes del navegador como fuente autorizada. Comprueba la sesión real y obtiene el historial mediante una lectura fija de `bruff-live`, con prioridad de fondo para conservar la del chat.

Se usan hasta 20 mensajes confirmados recientes, hasta seis ejemplos y una selección de conocimiento aprobado, con límite total de 12.288 bytes de mensajes al motor y 900 tokens de salida. Se omiten medios, autores, credenciales y URLs; los identificadores de referencias se sustituyen por alias temporales antes de enviarlos al modelo. La consulta conserva contenido privado del chat, por lo que exige la autorización del propietario para compartir ese contexto con Cloudflare.

La salida JSON se valida antes de aceptarla: ámbito, referencias reales, duplicados, longitudes, variables, contenido explícito, importes y afirmaciones evidentes sin respaldo. Estas comprobaciones no demuestran que toda prosa libre sea correcta. El operador debe revisar la respuesta y su traducción antes de insertarla o enviarla. Puede haber cero, una o dos propuestas; no se inventa una tercera para completar el panel.

## Integridad y permisos

- SQL042 crea tres tablas privadas con RLS, sin acceso directo de clientes.
- La gestión de fuentes y preferencias es solo del propietario confirmado. Consultar borradores requiere permisos actuales de lectura y envío de esa modelo.
- La reserva deriva al trabajador de su sesión real. El único uso de la clave de servidor es el RPC fijo que registra una salida ya validada contra esa reserva. No se usa para leer historiales ni para impersonar usuarios.
- El resultado canónico queda ligado a trabajador, agencia, modelo, fan, contexto, fuentes y caducidad. Antes de insertar se vuelve a comprobar y se compara el texto exacto. Ninguna de estas operaciones envía mensajes.
- El historial del proveedor conserva su caché existente de hasta cuatro segundos. Releerlo detecta cambios observados; no garantiza una observación instantánea de OnlyFans.
- Los borradores caducan lógicamente a los diez minutos. La limpieza de su contenido es oportunista al reservar; no hay un trabajo nuevo que garantice borrado físico exacto al vencer el plazo. La metadata de uso conserva las cuotas y se limpia tras treinta días en ese mismo proceso.

## Límites del plan gratuito

La generación está desactivada por defecto. Cada consulta reserva una estimación fija de 600 neuronas, con techo de 7.500 por día UTC para este módulo, entre todas las agencias/modelos. Se aplica además el límite elegido por modelo (1–12 consultas diarias) y dos consultas por minuto por trabajador. Una reserva fallida después de iniciarse no se devuelve ni se reintenta automáticamente.

La reserva es una estimación conservadora, no una medición del proveedor. El cupo Workers AI Free es compartido con otros usos de la cuenta, incluida la búsqueda semántica existente. BRUFF no conoce todo ese consumo; el límite local no garantiza cuota restante. No se contratan planes ni se configura pago automático.

## Verificación y despliegue

Ejecutar `pnpm check` y `node scripts/check-ai-generation-database.mjs`. El segundo utiliza PostgreSQL en memoria con identidades y datos ficticios, sin conexiones reales. `node scripts/build-manual-ai-functions.mjs /ruta/absoluta/externa` genera los dos bundles revisables sin desplegarlos.

Orden: aplicar SQL042, desplegar `bruff-drafts` con su validación de sesión y actualizar `bruff-control`, publicar el frontend, actualizar las instrucciones del plugin privado y comprobar las herramientas. Todo continúa desactivado. Después, el propietario revisa las fuentes y autoriza una primera consulta manual. Las pruebas locales no acreditan el secreto, la cuota o la calidad de una inferencia real.

Referencias oficiales: [modelo y parámetros](https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/), [licencia del modelo](https://mistral.ai/news/mistral-small-3-1/), [precios y cuota gratuita](https://developers.cloudflare.com/workers-ai/platform/pricing/).
