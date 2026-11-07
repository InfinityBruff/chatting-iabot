# Propuestas manuales de contenido del catálogo

El gorila puede acompañar una de sus opciones de texto con una propuesta de contenido de la modelo actual. Es una ayuda para revisión humana: no activa una secuencia, no envía mensajes y no modifica los precios del proveedor. El texto generado conserva su identificación como borrador IA; el archivo y su precio proceden de una propuesta separada del catálogo, no de una afirmación generada por el modelo.

## Cómo se utiliza

1. Abrir una conversación autorizada y consultar las respuestas. Se conservan entre cero y tres opciones; no se inventan respuestas para llenar las tarjetas. Si hay una propuesta disponible, se asocia a la última opción recibida.
2. Revisar la carpeta, el archivo, su vista previa disponible, el precio propuesto y las advertencias. Se puede consultar otra selección admitida del catálogo. Cambiar la selección obliga a comprobarla otra vez.
3. Marcar la revisión de la propuesta. Una foto se propone gratis por instrucción del propietario. Un vídeo utiliza únicamente su precio de referencia; si falta, el precio continúa desconocido y no se puede preparar el conjunto.
4. Confirmar la preparación. BRUFF vuelve a verificar la propuesta y a resolver el archivo real en el baúl de esa modelo. Si el chat ya tiene texto, adjuntos o precio, muestra una revisión antes de reemplazarlos. Si el borrador cambia durante la comprobación, exige revisar el conflicto.
5. Revisar el resultado en el compositor. Preparar no envía. El envío sigue siendo una acción independiente del operador mediante el chat normal.

Seleccionar una tarjeta, aceptar una referencia de precio o preparar el borrador no registra un envío ni una compra en el seguimiento. Cancelar conserva la preparación anterior.

## Reglas y límites

La propuesta automática de inventario busca una foto no observada y, después, un vídeo no observado en la carpeta elegida. Esto es un criterio de selección de metadatos, no un nivel comercial ni una demostración de que ese archivo nunca se haya enviado. El historial comprobado puede ser parcial. Una selección manual puede volver a consultar un archivo que ya tenga observaciones; esa circunstancia se muestra para revisión.

Las fotos se proponen a precio cero. Los vídeos pueden tener referencias orientativas como 6, 10, 20, 30, 45, 55, 70, 85, 95 o 110 USD; se usa la referencia existente del archivo, sin extrapolar importes cuando falta. No se ajustan por gasto del fan, propinas, estrellas, suscripción o supuesto poder adquisitivo. El precio es el del conjunto propuesto, no una suma automática de importes por archivo.

El catálogo permanece en borrador. Sus etiquetas y su orden de inventario no acreditan una secuencia comercial aprobada. La propuesta mantiene el orden sin confirmar y no convierte el precio orientativo en un precio configurado del catálogo. Una apertura reportada, un mensaje visto o una coincidencia de medios no demuestra una compra por archivo.

Si no quedan elementos elegibles, no hay propuesta de contenido. No se sustituye por archivos de otra carpeta, modelo o fan ni se completa con ejemplos ficticios. El texto puede seguir utilizándose por separado cuando sus propios controles lo permiten.

## Comprobación antes de preparar

Las operaciones `recommend` y `verify_recommendation` de `bruff-memory` comprueban la sesión y los permisos actuales. El servidor consulta el catálogo y el seguimiento de esa agencia, modelo, conexión y fan, además de una página reciente autorizada. Una huella semántica liga la propuesta a ese ámbito y a su evidencia. Un cambio relevante exige actualizar la propuesta.

La interfaz conserva esa comprobación como máximo 120 segundos. La casilla de revisión no sustituye la verificación del servidor ni concede acceso al baúl. Una denegación, cambio de conversación, archivo no disponible o propuesta caducada impide preparar el conjunto. Los errores no se convierten en contenido gratuito ni en datos de demostración.

El texto canónico y su procedencia permanecen separados de la propuesta de catálogo. No se añade una referencia documental ficticia ni se afirma que una sugerencia generada esté verificada literalmente. La consulta de contenido no ejecuta una inferencia nueva ni activa el envío automático.

Para el alcance de la persistencia, los recorridos parciales y las observaciones, véase [Catálogo y seguimiento del fan](CATALOG-FAN-PROGRESS.md).
