# Auditoría de automatizaciones · 02/11/2026

Resultado: NO está operativo de extremo a extremo. No se activaron campañas, no se guardaron borradores de prueba en producción ni se enviaron mensajes.

## Comprobaciones realizadas

- `pnpm check`: 244 pruebas superadas y compilación correcta. Advertencia de bundle mayor de 500 kB; no es fallo de compilación.
- PostgreSQL local con PGlite: 61 comprobaciones de borradores (tres modelos, agencias, revocación, versiones y operaciones sin envío), 14 de alias y 19 de cola. Total: 94. Son pruebas con fixtures, no entregas productivas.
- Navegador autenticado en el sitio publicado: centro de automatizaciones carga almacenamiento en nube; editor en línea muestra presencia actualizándose; menú de nombre dinámico y primera palabra disponibles; masivos muestra colecciones reales de Lana, opción Todos y programación desplegable. Iniciar permanece deshabilitado.
- Revisión del código: las pantallas se remontan por usuario/agencia/modelo; borradores y alias usan RPC con ámbito; el coordinador avanzado no está importado en una ruta de producción.

## Funciones preparadas, no ejecutables todavía

1. Activar, pausar, continuar y finalizar desde el centro: faltan controles autenticados conectados a la cola.
2. Descubrimiento completo de destinatarios y miembros de colecciones, exclusiones y eliminación de duplicados antes de encolar.
3. Eventos de bienvenida/presencia, programación, repetición y seguimientos: configuración almacenada, sin programador avanzado conectado.
4. Contexto del fan, alias, respuesta reciente, validación de medios y adaptador OFMAPI: interfaces preparadas, integración pendiente.
5. Retirada automática, reenvíos y etiquetas: sin ejecución avanzada completa verificada.
6. Estados e ingresos por campaña: columnas sin datos de ejecución, no estadísticas operativas.
7. BRUFF IA, traducción, GIF externos y Buying Power: dependencias pendientes. Los filtros de agencia necesitan histórico autorizado completo.

## Límites y problemas de experiencia detectados

- La presencia muestra cobertura de usuarios seguidos y confirmaciones recientes; no demuestra cobertura universal ni renovación de todos los fans cada 2–3 segundos.
- La precarga del directorio es paginada y en memoria. No garantiza carga instantánea universal tras cada inicio.
- El resumen del horario dice «Puedes pausar o finalizar antes» aunque esos controles todavía no están conectados en el editor avanzado; debe condicionarse al estado real del motor.
- El editor tiene protección de recarga y cancelación propia, pero la navegación lateral desmonta el componente sin un guard de cambios pendientes compartido. Riesgo de perder cambios sin guardar.
- El coordinador preparado no transfiere todavía `tags` al payload; debe implementarse o rechazarse explícitamente antes de habilitarlo.

No se certifica ausencia de errores ni funcionamiento de envío por pasar pruebas unitarias. Antes de habilitar ejecución hacen falta pruebas integradas con proveedor simulado y comprobación controlada del flujo completo. Cualquier envío real sigue requiriendo activación del usuario.

## Correcciones posteriores

Navegación lateral, cambio de modelo y salida a Mi cuenta comprueban cambios pendientes del editor avanzado antes de descartarlos. El resumen horario ya no promete pausa operativa. El coordinador bloquea mensajes con etiquetas hasta conectar ese contrato. El adaptador de cola interpreta explícitamente `{data,error}` de Supabase y exige `data === true` para autorizar e iniciar; un objeto de respuesta nunca equivale a permiso. Cuatro regresiones nuevas, 248 pruebas y compilación correctas. Estas correcciones no instalan el motor de ejecución ni habilitan campañas.
