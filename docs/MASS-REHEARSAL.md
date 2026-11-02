# Ensayo local de mensajes masivos · 02/11/2026

No se usaron credenciales, datos de fans, cuentas reales ni conexión al proveedor. No se activaron campañas productivas. Las entregas siguientes son llamadas a un adaptador ficticio en memoria.

## Escenario completo
Tres modelos ficticias, 1.207 fans por modelo distribuidos en 13 páginas y una colección con dos exclusiones. El resultado es de 1.205 destinatarios únicos por modelo. Tres ciclos, nombre personalizado con prioridad sobre nombre del fan, solo primera palabra y fallback, foto y vídeo de pago por 12,50 USD. Total: 10.845 entregas ficticias, sin duplicados ni cruce de modelos. Preparación y pausa no entregan; repetir un ID ya terminado no vuelve a entregar. Se verifican fin de ciclos y rechazo explícito de opciones sin conectar.

Reproducir: `node --test server/mass-campaign-rehearsal.test.js`.

## Verificaciones adicionales
`pnpm check`: 901 tests correctos y build completado. 46 comprobaciones PostgreSQL de runtime y 121 comprobaciones de cola duradera: permisos, separación de agencias/modelos/fans, pausa, continuación/detención, revisiones, reserva exclusiva, moderación, resultados inciertos y atribución. El conjunto comprueba además selecciones por colecciones/fans, exclusiones, programación, modo nativo, precios, archivos gratuitos, pago y texto bloqueado, nombres y primer nombre, errores y cancelación simulada.

## Límites que el ensayo no elimina
El ensayo de 10.845 entregas usa reloj y almacenamiento controlados; NO prueba capacidad real ni velocidad del worker. El worker productivo procesa como máximo cuatro entregas por minuto en total. Una audiencia de 1.205 requiere al menos 302 minutos en condiciones ideales si es la única campaña. Si se repite cada 120 minutos, los pendientes del ciclo anterior se bloquean al pasar al siguiente; no equivale a entregar a todos en cada repetición. Varias campañas comparten capacidad.

No todas las opciones del editor están conectadas. `preparationPlan` rechaza franjas adicionales, retirada/reenvío, etiquetas y filtros avanzados no admitidos; la mezcla de adjuntos gratuitos/bloqueados tampoco está admitida. No afirmar que funcionan por poder guardarlas. Nombres personalizados BRUFF no se sincronizan hacia OnlyFans. La audiencia preparada es una instantánea.

La aceptación del masivo nativo no prueba entrega a cada fan. La cancelación solo afecta a pendientes que el proveedor permita cancelar. No existe prueba productiva de entrega a fans en este ensayo. El siguiente envío real corresponde al propietario, después de revisar modelo, destinatarios, contenido, precio y horario. Para una audiencia grande sin personalización/repetición, la ruta nativa evita el límite del worker individual de BRUFF; el proveedor mantiene sus propios límites.
