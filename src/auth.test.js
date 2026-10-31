import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMemberships} from './auth.js';
const client=(user,result)=>({auth:{getUser:async()=>({data:{user}})},rpc:async(name)=>{assert.equal(name,'bruff_my_workspaces');return result}});
test('membership query requires server-verified confirmed identity',async()=>{await assert.rejects(loadMemberships(client(null,{})),/sesión/);await assert.rejects(loadMemberships(client({id:'u'},{})),/sesión/)});
test('membership failure never falls back to demo or owner',async()=>{await assert.rejects(loadMemberships(client({email_confirmed_at:'yes'},{error:{code:'missing'}})),/consulta de permisos/);assert.deepEqual(await loadMemberships(client({email_confirmed_at:'yes'},{data:[]})),[])});
test('membership response validates roles and pause state',async()=>{const row={id:'w',name:'Agency',role:'viewer',globally_paused:true};assert.deepEqual(await loadMemberships(client({email_confirmed_at:'yes'},{data:[row]})),[row]);await assert.rejects(loadMemberships(client({email_confirmed_at:'yes'},{data:[{...row,role:'superuser'}]})),/permisos/)});
