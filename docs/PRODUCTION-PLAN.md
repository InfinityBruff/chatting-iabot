# BRUFF: auditoría y plan de puesta en producción

Fecha: 30 de octubre de 2026. Requisitos confirmados: producto independiente de OnlyX; trabajadores con correo/contraseña propios de BRUFF, sin cuenta ChatGPT. Aún no hay conector contratado. No hay autorización para activar asistentes ni realizar envíos reales.

## Estado verificado en código

| Área | Disponible | Falta para producción |
|---|---|---|
| Interfaz React | Chats, cuenta activa, ficha, Vault, Dashboard, siete informes | Estados reales de carga/error/desconexión, accesibilidad y pruebas móviles completas |
| Almacenamiento | localStorage por navegador | Base de datos persistente, versiones y conflictos, copias y restauración |
| Equipo | Formularios de roles, permisos y comisiones demo | Identidad, invitación y recuperación por correo, sesiones, autorización por petición |
| Backend | Esquema SQL y funciones de acceso con pruebas | Servidor HTTP, repositorios, migraciones, despliegue y monitorización |
| Cuentas OnlyFans | Modelos ficticios | Proveedor autorizado, enlace/revocación por modelo, almacenamiento seguro de credenciales |
| Chats/campañas | Borradores locales, edición y archivo | Sincronización paginada, eventos, cola idempotente, adjuntos reales y recibos de envío |
| Vault | Carpetas y archivos de ejemplo, búsqueda y favoritos | Enumeración completa, metadatos y accesos temporales, permisos por cuenta |
| Analítica | Cálculos sobre histórico sintético | Libro de transacciones reales, reembolsos, comisiones reales, monedas, conciliación |
| BRUFF | Configuración y selección por cuenta/fan | Generación, política de ejecución, contexto, revisión humana, evaluación y costes |
| Entrega | Sitio privado Sites, GitHub, build y pruebas | Entornos separados, acceso propio compatible, dominio, recuperación y alertas |

No equiparar botones o configuración guardada con una conexión, envío, invitación o ejecución real. No importar automáticamente ejemplos locales a producción.

## Hallazgos y correcciones de la primera fase

1. Seleccionar un chat podía marcar como leído un fan con el mismo ID en otra cuenta. Corregido mediante selección compuesta cuenta/fan.
2. La recarga local rechazaba IDs de fan repetidos entre cuentas y volvía al estado inicial. Corregida la validación por cuenta/fan y la migración demo.
3. La ficha demo podía atribuir el gasto de un fan de Luna a un ID igual de otra modelo. El fallback queda limitado a su cuenta.
4. Las cinco pruebas del servidor quedaban fuera de pnpm test. Incluidas junto a pruebas de interfaz/dominio; total actual 47.
5. Analítica y preparación del backend estaban en cambios locales sin consolidar en la última publicación. Consolidar antes de migrar infraestructura.
6. Hay incompatibilidad de vocabulario entre roles/permisos demo y los del servidor. Definir catálogo único en la fase 2; no migrar permisos por coincidencia de etiquetas.
7. La estadística demo usa deducciones y eventos ficticios; sustituir con registros normalizados, no adaptar números ficticios a producción.
8. El hosting privado actual exige su identidad de plataforma. No anunciar acceso propio de trabajadores hasta verificar/provisionar alojamiento y autenticación compatibles. No abrir públicamente el sitio actual para resolverlo.

## Fases y criterios de finalización

### 1. Consolidar y comprobar el prototipo
- Preservar cambios, publicar la última interfaz privada y guardar la fuente en GitHub.
- Corregir aislamiento y ejecutar todas las pruebas. Mantener marcado DEMO.
- Cierre: build correcto, pruebas correctas y publicación confirmada; registrar límites de QA.

### 2. Identidad y backend real (siguiente fase)
- Elegir proveedor de autenticación administrada y hosting compatible con acceso propio, tras comprobar costes y condiciones. No implementar criptografía de contraseñas casera.
- Registro por invitación, verificación de correo, login/logout, recuperación, caducidad/revocación, segundo factor para propietarios y administradores.
- Crear agencia propietaria y catálogo único de permisos; denegar por defecto. La identidad del servidor manda sobre cualquier dato del navegador.
- Migraciones versionadas, claves compuestas, copia y restauración comprobada. Nunca convertir un visitante en propietario automáticamente.
- API inicial: sesión, cuentas permitidas, notas, borradores y configuración, con validación de datos, paginación y control de versión.
- Cierre: dos usuarios con roles distintos trabajan desde dispositivos distintos; intentos de acceso cruzado, revocación de sesión y edición concurrente probados por HTTP.

### 3. Conexión independiente, primero lectura
- Evaluar proveedor por acceso permitido, autorización de modelos, revocación, privacidad, costes, límites y cobertura de endpoints/eventos. Ningún nombre comercial acredita respaldo oficial de OnlyFans.
- Adaptador intercambiable: capacidades explícitas y estado de conexión. Cada operación verifica identidad de agencia y cuenta.
- Probar una cuenta autorizada: chats, fans, carpetas, archivos y transacciones, recorriendo todas las páginas. Cursores y reintentos con límites.
- Validar firmas de webhooks, deduplicar eventos y manejar orden tardío. No confiar en el creatorId enviado por un cliente sin resolverlo en servidor.
- Cierre: recuentos conciliados, reconexión y revocación comprobadas; secretos ausentes de cliente, exportaciones y logs.

### 4. Conversaciones, Vault y campañas reales
- Reemplazar datos demo por API propia, separando demo/real y mostrando fallos sin recurrir a datos ficticios.
- Búsqueda, adjuntos permitidos, lectura y envío, precios PPV validados, historial y notas persistentes.
- Cola de envío con clave idempotente, límites del proveedor y comprobación de permisos/pausas justo antes de enviar. Un resultado desconocido se reconcilia antes de reintentar.
- Campañas: previsualizar audiencia por cuenta, excluir duplicados, confirmar contenido/precio, programar, pausar y registrar resultado individual.
- Cierre: envío de prueba explícitamente autorizado no se duplica bajo reintentos; fallo parcial recuperable y cuentas aisladas.

### 5. Analítica y comisiones verificables
- Importar importes en centavos y moneda, bruto, tarifa, neto, reembolsos y zona horaria. No sumar monedas diferentes sin conversión explícita.
- Definir cada métrica (cohortes, conversión, PPV, percentiles de respuesta); distinguir datos ausentes de cero y retrasos de sincronización.
- Atribución verificable de ventas al equipo; comisiones según acuerdo guardado/versionado, sin crear pagos automáticos.
- Cierre: ingresos y exportaciones concilian con el origen para una cuenta y un periodo; reembolsos y periodos sin datos probados.

### 6. Motor BRUFF integrado en el servidor
- Elegir modelo y proveedor compatible con los usos previstos y sus políticas; evaluar con ejemplos autorizados/sintéticos y coste máximo por cuenta.
- Contexto limitado al fan y modelo correctos. Los mensajes del fan son datos no fiables, no instrucciones para cambiar permisos, revelar información o ejecutar herramientas.
- Primera modalidad: propuesta con revisión humana. Control global, por cuenta, selección de chats y toma manual, con registro de versión de instrucciones/modelo.
- Prevención de respuestas duplicadas, respuesta tardía tras intervención humana, precios inventados y acceso a información de otras cuentas. Presupuesto, límites y pausa inmediata.
- Separar generación de envío: el modelo no dispone de una clave que permita saltarse la autorización de la cola.
- Cierre: batería de evaluación y pruebas de aislamiento/pausa aprobadas; activación real solo cuando el usuario la autorice expresamente.

### 7. Piloto y operación
- Piloto con una modelo y pocos trabajadores, seguimiento de fallos y costes, soporte y procedimiento de reversión.
- Copias, restauración, alertas, exportación/eliminación, trazas sin datos sensibles innecesarios y documentación de operación.
- Cierre: flujos principales verificados de extremo a extremo, sin errores críticos pendientes; ampliar modelos gradualmente.

## Decisiones pendientes, cuando sean necesarias

- Hosting/auth/correo, dominio y presupuesto: antes de crear o contratar servicios.
- Proveedor de conexión y una cuenta piloto autorizada: antes de compartir accesos o sincronizar datos reales.
- Proveedor de IA, usos y límite de gasto: antes de generar respuestas con datos reales.

## Próximo paso concreto

Completar la fase 1 y avanzar a la selección técnica de alojamiento/autenticación propia y contrato API de la fase 2. No volver a añadir módulos demo para aparentar avance. Las fases sin credenciales pueden avanzar en contratos, pruebas y repositorios de datos; las acciones externas dependientes esperan su configuración/autorización.

### Avance fase 2 — frontera API, 30/10/2026

Usuario sin alojamiento contratado. Añadidos handler autenticado y adaptador Supabase; API de sesión/cuentas/notas con permisos por petición, fan compuesto y control de versión. 53 pruebas y build correctos. Persistencia, login visible, despliegue de servidor y conexión a React pendientes; no hay backend productivo. Siguiente avance: proyecto Supabase, migración Postgres con aislamiento y repositorio transaccional; ver detalles y límites en BACKEND.md.
