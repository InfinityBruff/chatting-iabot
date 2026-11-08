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


## Memoria contextual y enseñanza desde el chat

El contrato manual `bruff-drafts-v3` añade memoria revisada del fan a los mensajes recientes y las fuentes aprobadas de la modelo. El contexto es limitado y declara su cobertura; no equivale a transmitir el historial entero. El prompt sigue siendo conversacional no explícito, requiere ejemplos documentados y puede devolver menos de tres opciones cuando falte respaldo. El catálogo comercial conserva su comprobación independiente y no se atribuyen pagos a una frase del fan.

La memoria vive en Turso con una fila actual protegida por versión por propietario/agencia/modelo/conexión/fan; no depende de la versión del catálogo. Se extraen citas neutrales pendientes; el propietario puede confirmar, corregir, fijar o excluir. Las exclusiones se conservan al actualizar. Cada operación de sincronización recorre una página, conserva avance y fecha; la interfaz permite continuar o detener el recorrido sin bloquear el chat. No hay aquí un barrido automático completo de todos los fans.

`BRUFF_FAN_MEMORY_ENABLED` habilita su consulta por generación. Si está apagado, la cobertura se declara desconocida. Si está encendido y falla la memoria, no se oculta el fallo con otro contexto. El hash común incluye la revisión semántica de memoria y la conexión; se revalida antes de devolver, verificar o preparar. SQL047 actualiza el contrato y bloquea preparaciones con motores anteriores, conservando su contabilidad. No activa delegación ni envíos.

SQL046 añade un permiso de enseñanza por propietario y modelo, desactivado inicialmente. El propietario puede conceder/revocar categorías y usar `bruff_save_reviewed_teaching` para guardar y aprobar una enseñanza expresa en una transacción idempotente. Los conflictos requieren releer. Una enseñanza del propietario lleva su procedencia; no se presenta como conversación original. El conector no recibe permanentemente todo ChatGPT ni se autentica por el título «Memoria chats 1». La skill puede registrar enseñanzas expresas cuando el permiso esté vigente y debe devolver el recibo de persistencia. El host puede exigir actualizar las herramientas o confirmar acciones.

Orden de actualización: Turso003 y SQL046/047; funciones `bruff-memory`, `bruff-control`, `bruff-drafts` y `bruff-ai-runner`; interfaz y skill; después habilitar memoria y permisos de enseñanza de las modelos autorizadas. Conservar apagados los envíos y comprobar el circuito con fuentes ficticias o lecturas autorizadas. El analizador histórico separado solo genera metadatos de referencia: no fabrica eventos de compra ni incorpora muestras como conocimiento aprobado.

### Citas neutrales seleccionadas desde el control privado

La revisión de contexto `bruff-generation-context-v5` distingue expresamente a fan y modelo y señala el último mensaje recibido como objetivo de cada alternativa. Las opciones son respuestas independientes con funciones distintas, no turnos sucesivos ni paráfrasis para completar tres. El prompt distingue una pregunta sobre el día pasado de otra sobre la actividad actual; evita usar la participación en el chat como respuesta de relleno. Conserva el último mensaje del fan dentro del máximo de veinte y, si un texto supera el límite individual, marca la omisión y conserva su comienzo y final. Una cita del fan o un ejemplo de estilo no acredita actividades personales de la modelo. Un control conservador descarta borradores con determinadas afirmaciones autobiográficas sin respaldo y añade un aviso; puede devolver menos opciones y no vuelve a consultar la IA automáticamente. Estas instrucciones y controles no prueban la veracidad ni la calidad de toda frase: los resultados siguen sujetos a revisión humana.

El cambio de revisión invalida la reutilización y verificación de borradores del contexto anterior sin borrar sus recibos ni su consumo. El conector devuelve, cuando el servidor los facilita, los siete agregados `memoryContext`: activación, versión, recuerdos confirmados, recuerdos confirmados utilizados, mensajes observados, final del recorrido y contexto limitado. No transmite el texto de los recuerdos en ese diagnóstico ni inventa ceros para resultados antiguos. Cero recuerdos utilizados no acredita que se haya resumido o comprendido todo el historial. Las reglas en borrador siguen excluidas; aprobar un ejemplo de estilo no convierte su biografía o actividad en datos de la modelo.

El extractor determinista de sincronización reconoce declaraciones neutrales delimitadas y pares de pregunta y respuesta de vocabulario acotado. Recorrer una conversación con él no equivale a resumirla ni a comprenderla íntegramente. Para conservar una cita neutral omitida por ese extractor, el propietario debe seleccionar explícitamente el fragmento real del fan y puede usar `bruff_import_fan_memory_candidates` con su versión vigente, el cursor de la página leída y hasta veinte candidatos con `category`, `message_id` y `quote`. El campo opcional `question_message_id` identifica una pregunta real de la modelo que aporta contexto a esa respuesta; no permite inventar una pregunta ni reconstruir una declaración. Sin ese campo se conserva la política positiva de declaraciones neutrales completas. `personal_context` distingue datos ordinarios declarados del resto de categorías; no autoriza inferir información sensible, pagos ni datos de la modelo.

El servidor obtiene de nuevo la página del mismo ámbito y, si la pregunta seleccionada no está en ella, comprueba su siguiente página anterior: como máximo dos páginas adyacentes. Exige que la cita exista exactamente en el mensaje del fan. Cuando se selecciona una pregunta, verifica su texto neutral reconocido, autoría de la modelo, categoría correspondiente y posición anterior y contigua a la respuesta en la secuencia observada; mensajes intermedios, incluidos los de medios sin texto, y empates temporales impiden acreditar ese par. Admite fechas de fuente UTC terminadas en `Z` o `+00:00`, las normaliza a UTC y rechaza fechas de calendario imposibles.

El valor guardado es la cita literal, nunca una paráfrasis ni una afirmación añadida a una respuesta corta. Los nuevos candidatos quedan pendientes; los recuerdos manuales, revisados, fijados y excluidos conservan su estado. Una cita aporta procedencia, no verdad independiente. No se aprueba para completar una prueba. La importación no modifica el avance ni la cobertura histórica: las una o dos páginas consultadas para verificar citas no adelantan el cursor del recorrido guardado. Las páginas recorridas y los recuerdos encontrados se contabilizan por separado.

Esta importación no ejecuta IA, no llama a Cloudflare ni envía mensajes. La revisión del propietario y la generación posterior conservan sus controles existentes. Las citas importadas pendientes no influyen en las respuestas hasta que se revisen; una posterior revisión invalida el contexto anterior. Si la herramienta nueva o su argumento opcional aún no aparecen en el host, se debe actualizar el catálogo oficial del mismo conector y verificar su presencia antes de usarlos, sin recurrir a credenciales o APIs alternativas.

Los candidatos contextuales conservan `source.question` junto a la respuesta literal del fan. La pregunta debe ser de la modelo, anterior y contigua en la secuencia observada; su tipo debe corresponder con la categoría guardada. Un único límite de página puede conservar evidencia neutral mínima, vinculada al mismo ámbito mediante huella, para contrastarla con la siguiente página antigua. Ese límite no guarda mensajes completos ni se sustituye al consultar de nuevo mensajes recientes. Preguntas ambiguas, empates temporales y datos no admitidos no producen recuerdos. Una respuesta a «de dónde eres» no acredita residencia actual, permanente ni nacionalidad.

La versión del extractor pertenece al recorrido guardado: actualizarla reabre una vez la lectura desde la cabecera, preservando recuerdos revisados y exclusiones. Los cursores y la cobertura solo se guardan tras una página válida. La interfaz y el control privado muestran la pregunta y la respuesta para revisar el significado antes de confirmar; la generación solo recibe recuerdos confirmados y conserva sus límites existentes.
