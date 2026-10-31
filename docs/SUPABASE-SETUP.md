# Supabase: primera base real de BRUFF

30/10/2026. Creada mediante SQL Editor en el proyecto del usuario, tras comprobar que public y bruff_private no contenían tablas. Archivo aplicado: supabase/migrations/202610300001_private_foundation.sql. Es PostgreSQL; el borrador SQLite anterior no se aplicó.

## Estado confirmado

- Esquema bruff_private con diez tablas: workspaces, memberships, creator_accounts, account_grants, fans, fan_notes, drafts, bruff_settings, bruff_chat_overrides y schema_versions.
- Agencia BRUFF creada, pausa global activada. Sin trabajadores, cuentas de modelos, fans ni datos demo importados.
- Todas las tablas con RLS; ninguna tiene permisos SELECT/INSERT/UPDATE/DELETE para anon ni authenticated, confirmado en el catálogo de Supabase.
- Políticas de lectura preparadas por usuario/agencia/cuenta. Sin políticas de escritura que permitan autoasignarse permisos. Funciones auxiliares con search_path vacío y EXECUTE revocado a clientes; el esquema no se ha añadido a la Data API.
- Identidades referenciadas por auth.users; claves compuestas en relaciones de cuenta/fan y autores de notas.
- La migración se registra en bruff_private.schema_versions, no en el historial de Supabase CLI. Antes de adoptar CLI, reconciliar esa migración ya aplicada; NO volver a ejecutarla ni marcar otras como aplicadas sin verificar. CREATE sin IF NOT EXISTS evita esconder divergencias.

## Validación

17 comprobaciones en PostgreSQL embebido PGlite 0.5.13, incluyendo ejecución real de RLS con roles simulados, agencias y cuentas con IDs repetidos, usuario desactivado, viewer con permiso obsoleto de escritura, intento de autoascenso y claves foráneas. Los permisos temporales para ejercitar las políticas solo se concedieron dentro de la base local en memoria. No se crearon usuarios ficticios en Supabase.

Reproducir tras instalar @electric-sql/pglite en un entorno de pruebas:

```
node scripts/check-database.mjs /ruta/a/node_modules/@electric-sql/pglite/dist/index.js
```

Además, pnpm check: 54 pruebas de aplicación/API y compilación correctas. En el proyecto remoto se verificaron las diez tablas, RLS y ausencia de privilegios de cliente; no se afirma haber probado todavía acceso real de dos trabajadores ni una sesión de producción.

## Pendiente del siguiente paso

Crear la identidad del propietario mediante flujo seguro, vincularla explícitamente a la agencia y activar únicamente el acceso necesario mediante API/RPC revisadas. No convertir automáticamente al primer visitante en propietario. El acceso a Supabase con GitHub es distinto del usuario final de BRUFF.

Faltan repositorio persistente (incluida actualización atómica de versiones), endpoints desplegados, interfaz de login, retornos autorizados y correo SMTP para trabajadores. Hasta entonces la interfaz conserva sus ejemplos locales. Las tablas NO bastan para que la aplicación funcione con datos reales.

Authentication revisado y actualizado por instrucción del usuario: registro libre cerrado; email y confirmación activados; acceso anónimo desactivado; Secure password change y Require current password when updating activados. SMTP no configurado; URL de retorno aún localhost:3000. No se enviaron invitaciones ni mensajes y no se activó BRUFF.

Referencias: https://supabase.com/docs/guides/database/postgres/row-level-security y https://supabase.com/docs/guides/database/functions .

## Acceso propio — 31/10/2026

Identidad del propietario confirmada y membresía owner/active asignada con aprobación explícita; comprobada en remoto. Sin registrar identificadores personales en este documento.

Añadido formulario Supabase signInWithPassword, cierre de sesión local, sesión solo en memoria y consulta autenticada de agencias. El login no abre la demo: la demostración tiene entrada explícita separada. Sin datos ficticios en el área autenticada. Clave publicable de navegador únicamente; ninguna clave privilegiada incluida.

La migración 202610310002_membership_rpc.sql está PREPARADA, NO APLICADA. Expone solo bruff_my_workspaces(), sin parámetros: auth.uid() determina identidad y cada llamada filtra membresías activas. No permite escribir ni consultar tablas privadas directamente. Requiere aprobación para habilitar este acceso por la interfaz. Hasta aplicarla, login puede verificar identidad pero muestra permisos pendientes. Login con contraseña real pendiente de prueba por el usuario; no se solicitan contraseñas por chat. SMTP y alojamiento independiente para trabajadores continúan pendientes.

Documentación utilizada: https://supabase.com/docs/reference/javascript/auth-signinwithpassword .
