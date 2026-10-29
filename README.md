# Chatting IABOT · React

Plataforma propia de conversaciones y asistente configurable, construida con React y Vite. OnlyX es una referencia funcional; este proyecto no contiene su código fuente.

## Versión 0.3 · BRUFF Workspace

- Bandeja de tres columnas con gasto por fan, estrellas sobre el avatar, etiquetas, notas y ficha con compras/actividad.
- Interruptores de BRUFF globales y por fan; la pausa global y la atención manual tienen prioridad.
- Estrellas configurables por umbrales de gasto en esta cuenta. Gasto en otras cuentas no disponible.
- Campañas para todos, fans seleccionados o fans en línea: solo borradores locales, sin envío.
- Biblioteca de ejemplo y respuestas rápidas, sin adjuntos reales.
- Componentes React separados para bandeja, conversación y configuración.
- Búsqueda y filtro de conversaciones.
- Activación por fan y selección múltiple para activar/desactivar grupos.
- Modos todos/selección/pausa, instrucciones, tono, vocabulario y tiempos con validación.
- Mensajes locales de prueba y persistencia en el navegador.
- Conserva los datos compatibles de la versión anterior en el mismo navegador y dominio.

Todavía es un prototipo: no incluye IA, conexión a cuentas, envíos reales, autenticación propia ni base de datos compartida. Los parámetros se guardan, pero no ejecutan un asistente todavía.

## Ejecutar

Requiere Node.js 22.12 o posterior y pnpm 11.25.0.

```sh
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

Abrir la URL local que imprime Vite. Para verificar y compilar:

```sh
pnpm test
pnpm build
pnpm preview
```

La compilación genera `dist/`, publicable en un alojamiento estático.

## Estructura

- `src/App.jsx`: composición de la aplicación y estado compartido.
- `src/components/`: bandeja, chat y editor del asistente.
- `src/policy.js`: reglas de elegibilidad y validación de tiempos.
- `src/storage.js`: carga, validación y persistencia local.
- `src/styles.css`: diseño adaptable.
- `docs/PLAN.md`: alcance y módulos pendientes.

No subir credenciales ni conversaciones reales al repositorio. GitHub versiona el código; la IA, el backend y las integraciones se añadirán por separado.
