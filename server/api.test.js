import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './api.js';
import { createSupabaseAuthenticator } from './supabase-auth.js';

function fixture(role='admin') {
  let active = true;
  const notes = new Map();
  const key = s => JSON.stringify([s.workspaceId, s.creatorId, s.fanId]);
  const repository = {
    async loadAccess() { return {
      memberships: [{ userId: 'alice', workspaceId: 'agency', role, status: active ? 'active' : 'disabled' }],
      accounts: [{ workspaceId: 'agency', id: 'luna', displayName: 'Luna' }],
      grants: ['read', 'notes'].map(permission => ({ userId: 'alice', workspaceId: 'agency', creatorId: 'luna', permission })),
    }; },
    async hasFan(s) { return s.creatorId === 'luna' && s.fanId === 'fan'; },
    async getNote(s) { return notes.get(key(s)) || null; },
    async saveNote(s) {
      const previous = notes.get(key(s));
      if ((previous?.version || 0) !== s.expectedVersion) return null;
      const note = { body: s.body, version: s.expectedVersion + 1, updatedBy: s.updatedBy };
      notes.set(key(s), note);
      return note;
    },
  };
  const api = createApi({ authenticate: async token => ['alice', 'bob'].includes(token) ? { id: token } : null, repository });
  return {
    disable() { active = false; },
    call(path = '/api/workspaces/agency/accounts/luna/fans/fan/note', { token = 'alice', body, method = body === undefined ? 'GET' : 'PUT' } = {}) {
      return api(new Request(`https://bruff.test${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    },
  };
}

test('API denies unconfigured backend and never returns example data', async () => {
  assert.equal((await createApi()(new Request('https://bruff.test/api/me'))).status, 503);
});
test('account listing only exposes permitted accounts', async () => {
  const response = await fixture().call('/api/workspaces/agency/accounts');
  assert.deepEqual((await response.json()).accounts.map(a => a.id), ['luna']);
});
test('rejects invalid sessions and another user, workspace or account', async () => {
  const f = fixture();
  assert.equal((await f.call(undefined, { token: 'expired' })).status, 401);
  assert.equal((await f.call(undefined, { token: 'bob' })).status, 403);
  assert.equal((await f.call('/api/workspaces/other/accounts/luna/fans/fan/note')).status, 403);
  assert.equal((await f.call('/api/workspaces/agency/accounts/other/fans/fan/note')).status, 403);
  assert.equal((await f.call('/api/workspaces/agency/accounts/luna/fans/missing/note')).status, 404);
});
test('notes use authenticated actor and reject lost updates and forged identity', async () => {
  const f = fixture();
  const saved = await f.call(undefined, { body: { body: 'Nota', version: 0 } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).note.updatedBy, 'alice');
  assert.equal((await f.call(undefined, { body: { body: 'Stale', version: 0 } })).status, 409);
  assert.equal((await f.call(undefined, { body: { body: 'Forged', version: 1, userId: 'owner' } })).status, 400);
  assert.equal((await (await f.call()).json()).note.body, 'Nota');
});
test('disabled membership blocks next request even with valid auth token', async () => {
  const f = fixture();
  f.disable();
  assert.equal((await f.call()).status, 403);
});
test('Supabase auth verifies remotely, requires confirmed email and handles outages', async () => {
  const options = { url: 'https://project.supabase.co', publishableKey: 'test-key' };
  const authenticate = createSupabaseAuthenticator({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url.pathname, '/auth/v1/user');
    assert.equal(init.headers.authorization, 'Bearer session');
    return Response.json({ id: 'alice', email_confirmed_at: '2026-10-30' });
  } });
  assert.deepEqual(await authenticate('session'), { id: 'alice' });
  assert.equal(await createSupabaseAuthenticator({ ...options, fetchImpl: async () => Response.json({ id: 'alice' }) })('session'), null);
  assert.equal(await createSupabaseAuthenticator({ ...options, fetchImpl: async () => new Response(null, { status: 401 }) })('session'), null);
  await assert.rejects(createSupabaseAuthenticator({ ...options, fetchImpl: async () => { throw new Error('secret'); } })('session'), { status: 503 });
});

test('oversized body is rejected without changing the existing note', async () => {
  const f = fixture();
  assert.equal((await f.call(undefined, { body: { body: 'Original', version: 0 } })).status, 200);
  assert.equal((await f.call(undefined, { body: { body: 'x'.repeat(25000), version: 1 } })).status, 413);
  assert.equal((await (await f.call()).json()).note.body, 'Original');
});

test('Chatter cannot read or edit notes even with stale notes grant',async()=>{const f=fixture('operator');assert.equal((await f.call()).status,403);assert.equal((await f.call(undefined,{body:{body:'No',version:0}})).status,403)});
