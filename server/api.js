import { canAccessAccount, requireAccountAccess } from './access.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const failure = (status, message) => Object.assign(new Error(message), { status });
const validId = value => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

async function readLimitedBody(request, limit = 24000) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw failure(413, 'Nota demasiado grande');
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

// All dependencies are server-owned. There is deliberately no demo repository fallback.
export function createApi({ authenticate, repository } = {}) {
  return async function handle(request) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/api/health' && request.method === 'GET') {
        return json(200, { service: 'bruff-api', configured: Boolean(authenticate && repository) });
      }
      if (!authenticate || !repository) return json(503, { error: 'Backend pendiente de configuración' });
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
      if (!token) return json(401, { error: 'Sesión necesaria' });
      const user = await authenticate(token);
      if (!user?.id) return json(401, { error: 'Sesión no válida' });
      if (path === '/api/me' && request.method === 'GET') return json(200, { id: user.id });

      const route = /^\/api\/workspaces\/([^/]+)\/accounts(?:\/([^/]+)\/fans\/([^/]+)\/note)?$/.exec(path);
      if (!route) return json(404, { error: 'Ruta no encontrada' });
      const [, workspaceId, creatorId, fanId] = route;
      if (![workspaceId, creatorId, fanId].filter(Boolean).every(validId)) throw failure(400, 'Identificador no válido');
      // Never accept membership, role, grants or userId supplied in a request body.
      const policy = await repository.loadAccess({ userId: user.id, workspaceId });
      const context = { ...policy, userId: user.id, workspaceId, creatorId };
      if (!creatorId) {
        if (request.method !== 'GET') return json(405, { error: 'Método no permitido' });
        const accounts = policy.accounts.filter(account => canAccessAccount({ ...context, creatorId: account.id, permission: 'read' }));
        return json(200, { accounts: accounts.map(({ id, displayName, connectionStatus }) => ({ id, displayName, connectionStatus })) });
      }
      if (!['GET', 'PUT'].includes(request.method)) return json(405, { error: 'Método no permitido' });
      requireAccountAccess({ ...context, permission: 'read' });
      if (request.method === 'PUT') requireAccountAccess({ ...context, permission: 'notes' });
      const scope = { workspaceId, creatorId, fanId };
      if (!await repository.hasFan(scope)) return json(404, { error: 'Fan no encontrado en esta cuenta' });
      if (request.method === 'GET') return json(200, { note: await repository.getNote(scope) });
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw failure(415, 'Se requiere JSON');
      const raw = await readLimitedBody(request);
      let input;
      try { input = JSON.parse(raw); } catch { throw failure(400, 'JSON no válido'); }
      if (!input || Array.isArray(input) || Object.keys(input).some(key => !['body', 'version'].includes(key)) ||
        typeof input.body !== 'string' || input.body.length > 5000 || !Number.isSafeInteger(input.version) || input.version < 0) {
        throw failure(400, 'Indica texto de hasta 5000 caracteres y una versión válida');
      }
      // Repository must atomically compare version and write; null means conflict.
      const note = await repository.saveNote({ ...scope, body: input.body, expectedVersion: input.version, updatedBy: user.id });
      return note ? json(200, { note }) : json(409, { error: 'La nota ha cambiado. Recárgala antes de guardar.' });
    } catch (error) {
      const status = [400, 401, 403, 413, 415, 503].includes(error.status) ? error.status : 500;
      return json(status, { error: status === 500 ? 'No se pudo completar la operación' : error.message });
    }
  };
}
