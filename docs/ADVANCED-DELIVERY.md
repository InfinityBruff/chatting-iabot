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
