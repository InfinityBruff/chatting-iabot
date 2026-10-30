# BRUFF independiente: paso de demo a producción

Estado: base de servidor preparada localmente; no desplegada, sin cuentas conectadas.
El usuario confirmó el 30/10/2026 que todavía no tiene proveedor de conexión.

## Arquitectura

React → API propia autenticada → base de datos → adaptador del proveedor elegido.
Motor BRUFF en el servidor → proveedor de modelo de IA → propuesta de respuesta → revisión humana → cola de envío autorizada.
Las claves de servicios nunca se incluyen en React ni localStorage. OnlyX no será backend.

Sites permite identidad hospedada y D1/R2. El proyecto actual es Vite estático: requiere migración comprobada a servidor antes de aplicar este esquema. El archivo server/schema/001-foundation.sql es un borrador validado en SQLite temporal, no una migración de producción registrada.

## Implementado en esta preparación

- Esquema de agencias, miembros, cuentas, permisos, fans, notas, mensajes, borradores, transacciones, carpetas y medios, configuración BRUFF, cursores de sincronización y auditoría.
- Claves compuestas y relaciones para separar agencias, cuentas y fans.
- Política de acceso del servidor con denegación por defecto, membresía activa y permisos por cuenta; cinco pruebas.
- Comprobación de conexión verificada antes de usar un adaptador.

No hay aún rutas HTTP, repositorios de datos, migraciones alojadas, credenciales, tareas de sincronización ni integración con React. La política solo protege cuando sea invocada por esas rutas con identidad y registros de servidor fiables.

## Conector pendiente

No se ha verificado una API pública oficial de OnlyFans. Los proveedores encontrados son externos: el nombre «OnlyFans API» no acredita respaldo de OnlyFans. Revisar permiso de las modelos, condiciones de acceso, tratamiento y eliminación de datos, revocación, costes y cobertura antes de contratarlos o compartir sesiones.
Referencias técnicas consultadas: https://docs.onlyfansapi.com/api-reference/overview y https://docs.onlyfansapi.com/webhooks ; describen mensajes y eventos de su servicio. No constituyen verificación independiente de autorización, seguridad o disponibilidad.

Prueba de aceptación del proveedor: conectar una cuenta autorizada, listar perfiles y carpetas con paginación, recuperar chats en solo lectura, conciliar transacciones por moneda, verificar eventos firmados y revocación. No enviar mensajes ni activar BRUFF en esta prueba.

## Orden de implementación

1. Migrar hosting a servidor preservando acceso privado; identidad, membresía y base de datos con pruebas de aislamiento HTTP.
2. Notas, borradores, configuración y equipo persistentes; invitaciones solo con correo configurado.
3. Adaptador elegido: sincronización inicial y por eventos, reintentos, deduplicación y estado de error/desconexión.
4. Sustituir cada vista demo por datos reales separados, sin cargar ejemplos como registros importados.
5. BRUFF: contexto por fan, límites y personalidad por cuenta, modo propuesta por defecto, pausa global y excepciones de chat, auditoría y evaluación. Un proveedor de IA se elige según políticas y usos permitidos; no prometer compatibilidad universal.
6. Envíos explícitos, cola idempotente, verificación de permisos al enviar y manejo de fallos. Analíticas calculadas con transacciones reales, comisiones explícitas y monedas separadas.

Actualización 30/10/2026: el usuario exige correo/contraseña propios de BRUFF, sin cuenta ChatGPT para trabajadores. La identidad hospedada actual de Sites no satisface por sí sola este requisito; validar hosting y proveedor de autenticación compatibles antes de migrar. Plan rector: docs/PRODUCTION-PLAN.md.
