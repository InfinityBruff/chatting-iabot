# Plataforma propia: plan de implementación

## Alcance y evidencia

Fecha: 29 de octubre de 2026. Inventario inicial basado en las herramientas de la integración OnlyX disponibles en esta sesión; no es una auditoría completa de la aplicación ni de su código. La búsqueda de documentación devolvió enlaces de su índice y avisó de que su búsqueda en vivo no estaba disponible.

Referencias de documentación para validar antes de implementar el conector:
- https://docs.onlyx.ai
- https://docs.onlyx.ai/concepts/conversations
- https://docs.onlyx.ai/guides/ai-settings
- https://docs.onlyx.ai/concepts/ai-persona

La integración disponible expone `set_conversation_ai`: activar/desactivar IA por conversación. Hay que verificar si esta función está accesible en la interfaz/plan del usuario. No debe presentarse como una capacidad totalmente ausente de OnlyX.

## Inventario inicial

| Módulo | Evidencia en integración OnlyX | Estado en IABOT |
|---|---|---|
| Workspace y creadoras | Workspace, perfiles, conexión y estado de sincronización | Pendiente |
| Bandeja y equipo | Conversaciones, mensajes, leídos, intervención humana, devolver a IA | Solo demostración local |
| IA por conversación | Activar/desactivar un chat y activar globalmente por creadora | Selector local; sin integración |
| Persona | Identidad, estilo, límites, preferencias y derivaciones | Editor inicial; sin IA |
| Revisión y seguimiento | Borradores, revisión humana y seguimientos | Pendiente |
| Fans y CRM | Perfiles, notas, segmentos, suscripción y gasto | Fans ficticios |
| Biblioteca | Medios, duración y organización | Pendiente |
| Colecciones y niveles | Carpetas, orden, precios y medios asociados | Pendiente |
| Bienvenida y campañas | Mensaje de bienvenida, enlaces de seguimiento y pruebas gratuitas | Pendiente |
| Analítica | Ingresos, transacciones, atribución y estadísticas | Pendiente; sin métricas reales |

## Mejoras solicitadas

1. Modo global todos/selección/pausa y selección múltiple de fans con exclusiones claras.
2. Instrucciones y estilo editables: tono, expresiones, longitud, puntuación y palabras preferidas/prohibidas.
3. Tiempos configurables por creadora y, posteriormente, por conversación. Pausas para lectura/visualización sin afirmar que un vídeo pregrabado se está grabando en directo.
4. Versiones de configuración y ejemplos corregidos; probar antes de activar. Las correcciones no reentrenan automáticamente el modelo.

## Arquitectura propuesta (todavía sin implementar)

- Interfaz web con bandeja, CRM, ajustes, contenido y estadísticas.
- API de servidor con autenticación, roles de administrador/supervisor/operador y aislamiento por workspace.
- PostgreSQL para creadoras, fans, conversaciones, mensajes, configuración versionada, borradores y auditoría.
- Almacenamiento de archivos separado de la base de datos.
- Worker y cola persistente para esperas, cancelaciones, reintentos y envíos con idempotencia.
- Adaptador de integración intercambiable. El primer conector puede usar OnlyX si el usuario elige esa vía; una plataforma independiente requiere verificar otro acceso autorizado a las cuentas. No se ha confirmado una API directa de OnlyFans para este proyecto.
- Motor de asistente propio con memoria por fan, instrucciones por creadora, borradores y revisión. Viabilidad del modelo/proveedor y usos admitidos por validar antes de integrarlo.

## Siguiente fase concreta: backend de prueba

Primero construir autenticación, almacenamiento compartido y API de conversaciones/configuración sobre un conector simulado. Después validar un conector real en modo lectura y la generación de borradores. Los envíos reales se incorporarán tras probar estos pasos.

Criterios de aceptación:
- Dos usuarios autorizados ven las mismas conversaciones y configuración.
- El rol de operador no puede cambiar la configuración global.
- En modo selección solo los fans seleccionados resultan elegibles; en pausa ninguno.
- Una toma de control humana cancela borradores/envíos pendientes del asistente para ese chat.
- Cada borrador conserva la versión de configuración utilizada.
- Las esperas se validan y sobreviven a un reinicio del servidor.
- Un reintento no duplica un envío; una entrega sin confirmar no se reenvía automáticamente.
- El historial registra quién cambió qué y cuándo.

## Decisiones pendientes

- Repositorio GitHub de destino.
- Reproducir funciones y flujo con diseño propio, o acercar también la distribución visual: para comparar pantallas hace falta acceso a la interfaz de referencia.
- Usar OnlyX como conexión inicial o construir una plataforma independiente.
- Proveedor de IA y alojamiento del backend.

GitHub versiona y coordina el desarrollo; por sí solo no aporta conexión a cuentas, motor de IA ni servidor de aplicación.

## Entrega 0.2 · React

Migrado el prototipo a React y Vite con componentes separados, pruebas de reglas de activación y selección múltiple de fans. La persistencia sigue siendo local; backend, autenticación de equipo, IA e integraciones permanecen pendientes.

## Entrega 0.3 · BRUFF Workspace

Interfaz de tres columnas, gasto destacado por fan, estrellas sobre el avatar con cinco umbrales configurables, ficha con desglose de gasto, suscripción, compras, actividad y notas editables. BRUFF se controla globalmente y por fan, con pausa manual prioritaria. Campañas para todos/seleccionados/en línea con vista de destinatarios y guardado de borradores locales. Respuestas rápidas y adjuntos ficticios para probar el flujo.

Origen de la información: datos de ejemplo. Estrellas calculadas solo con gasto de la cuenta, sin afirmar acceso al gasto con otras modelos. No se ha inspeccionado el chat de OnlyFans: la política del navegador ha bloqueado su lectura. Ninguna configuración activa IA ni envíos reales.
