# Simulación sin envíos · 02/11/2026

No se usan credenciales, fans ni llamadas de red. El proveedor es una función en memoria. Las tres modelos son fixtures. No equivale a validar OFMAPI ni a instalar el ejecutor productivo.

## Resultado

- `pnpm check`: 852 pruebas, 852 correctas, 0 fallos; compilación correcta.
- 600 combinaciones nuevas: 3 modelos × 5 tipos × 5 modos de nombre × 2 opciones de primera palabra × 4 variantes de contenido (texto gratuito, medios gratuitos, medios mixtos con precio, texto de pago).
- 4 pruebas adicionales: persistencia de audiencias/reglas, entrega futura/caducada, fallo de base de datos antes del envío y pérdida de confirmación después del envío.
- PostgreSQL local: 61 comprobaciones de borradores + 14 de alias + 43 de cola = 118. La cola incluye la integración de las funciones SQL reales con `advancedStore` y `deliverAdvanced` en tres modelos ficticias, proveedor en memoria, personalización, resultado persistido y segundo intento sin duplicación.

## Qué se ha probado y hasta dónde

| Función | Comprobación | Límite |
|---|---|---|
| Masivos, bienvenida, en línea y caducidad | Configuración y procesamiento de una entrega simulada | No descubrimiento automático de eventos/destinatarios |
| Nombres y primera palabra | Texto final por fan, prioridades y alternativa | Contexto inyectado ficticio; alias cloud se prueba aparte |
| Gratis, pago, adjuntos y texto bloqueado | Payload interno y precio tras persistencia | No contrato de envío real ni disponibilidad real de medios |
| Colecciones, fans elegidos y exclusiones | Persistencia y rechazo de colecciones parciales | No resolución completa de audiencia en producción |
| Horarios y repetición | Validación, duración y conservación de configuración | No ejecución del reloj/programador avanzado |
| Secuencia de cinco mensajes | Validación, orden SQL y bloqueo al responder | No programador que cree los seguimientos |
| Pausa, revocación, versiones y duplicados | Bloqueos de cola SQL y pruebas de coordinador | Falta el endpoint de control conectado a la interfaz |
| Retirada y reenvío | Validación y persistencia de opciones | No retirada/reenvío implementados en ejecutor avanzado |
| Etiquetas | Bloqueo explícito sin enviar | Función pendiente, no se ignoran silenciosamente |
| IA, traducción, GIF externos, Buying Power | Estado pendiente documentado | No proveedores/métrica conectados; no se certifican |

## Condiciones para habilitar uso real

Conectar controles autenticados, descubrimiento completo de audiencia, contexto/medios del proveedor, programador, envío y registro de resultados. Implementar o deshabilitar explícitamente cada opción sin soporte. Probar el recorrido completo con adaptadores reales en modo sin escritura y, solo con activación autorizada, una entrega controlada a un destinatario acordado. Ninguna de estas pruebas habilita campañas por sí sola.
