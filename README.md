# Chatting IABOT

Plataforma propia de gestión de conversaciones con asistente configurable. OnlyX es una referencia funcional; este repositorio no contiene su código fuente ni su implementación privada.

## Estado real: prototipo 0.1

Implementado: bandeja con búsqueda y filtro, conversaciones de ejemplo, mensajes locales de prueba, selección de fans, modos todos/selección/pausado, instrucciones, tono, vocabulario y tiempos con validación. Los datos se guardan en `localStorage` del navegador.

Pendiente: autenticación, base de datos compartida, permisos, conexión a cuentas, sincronización, IA, cola de envíos, archivos y analítica real. Los controles del prototipo guardan preferencias, pero no ejecutan un asistente ni envían mensajes a terceros.

## Ejecutar

Requiere Node.js 22 o posterior. No hay dependencias que instalar.

```sh
npm start
```

Abrir http://127.0.0.1:8765. El servidor escucha solo en la máquina local. También se puede servir `dist/` con cualquier servidor estático.

```sh
npm run check
```

## Archivos

- `dist/index.html`: interfaz y lógica completas del prototipo.
- `scripts/serve.mjs`: servidor local.
- `scripts/check.mjs`: comprobaciones básicas de integridad y sintaxis.
- `docs/PLAN.md`: módulos, arquitectura propuesta y criterios de aceptación.

## GitHub

Crear o elegir un repositorio privado y subir estos archivos. El paquete exportado excluye `.git`, el identificador de Sites y cualquier configuración local de despliegue. GitHub almacena y versiona el código; la aplicación de producción necesitará además alojamiento, base de datos y un proveedor de IA/conexión a las cuentas.

No subir claves, contraseñas, conversaciones reales ni archivos de usuarios al repositorio. Las credenciales futuras se usarán en el servidor mediante variables de entorno.

El código entregado corresponde a esta versión inicial; no representa una réplica completa de OnlyX.
