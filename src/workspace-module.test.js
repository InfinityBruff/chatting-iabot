import test from 'node:test';
import assert from 'node:assert/strict';
import {canPreloadWorkspace,createWorkspaceModule} from './workspace-module.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const confirmed={access_token:'session-fixture',user:{id:'actor-fixture',email_confirmed_at:'2026-11-04T00:00:00Z'}};
test('confirmed sessions can warm static code while unconfirmed, invalid and authentication-link flows cannot',()=>{
 assert.equal(canPreloadWorkspace(confirmed,null),true);
 for(const session of [null,{}, {...confirmed,access_token:''},{...confirmed,user:{}},{...confirmed,user:{...confirmed.user,email_confirmed_at:null}},{...confirmed,user:{...confirmed.user,id:''}}])assert.equal(canPreloadWorkspace(session,null),false);
 for(const flow of ['link','request','invite','recovery'])assert.equal(canPreloadWorkspace(confirmed,flow),false);
});
test('preload and concurrent lazy loads share one import without rendering its component',async()=>{
 let imports=0,renders=0;const pending=deferred(),module={default:()=>{renders++}},loader=createWorkspaceModule(()=>{imports++;return pending.promise});
 assert.equal(imports,0);const warmA=loader.preload(),warmB=loader.preload(),lazyA=loader.load(),lazyB=loader.load();
 assert.equal(imports,1);assert.equal(lazyA,lazyB);assert.equal(renders,0);pending.resolve(module);
 assert.deepEqual(await Promise.all([warmA,warmB,lazyA,lazyB]),[module,module,module,module]);assert.equal(renders,0);assert.equal(await loader.load(),module);assert.equal(imports,1);
});
test('static module loading overlaps a pending membership check and does not render before authorization resolves',async()=>{
 const memberships=deferred(),code=deferred(),events=[];let rendered=0;
 const loader=createWorkspaceModule(()=>{events.push('module-start');return code.promise}),module={default:()=>{rendered++}};
 if(canPreloadWorkspace(confirmed,null))void loader.preload();
 events.push('membership-start');const navigation=memberships.promise.then(async rows=>{if(rows.some(row=>row.id==='authorized-agency'))(await loader.load()).default()});
 assert.deepEqual(events,['module-start','membership-start']);code.resolve(module);await loader.preload();assert.equal(rendered,0);
 memberships.resolve([{id:'authorized-agency'}]);await navigation;assert.equal(rendered,1);
});
test('failed speculative preload is consumed and a later intent retries successfully',async()=>{
 let imports=0;const module={default:()=>null},loader=createWorkspaceModule(()=>++imports===1?Promise.reject(Error('temporary chunk failure')):Promise.resolve(module));
 assert.equal(await loader.preload(),undefined);assert.equal(imports,1);assert.equal(await loader.load(),module);assert.equal(imports,2);
});
test('a lazy intent sharing a failed pending preload retries exactly once and preserves singleflight',async()=>{
 let imports=0;const old=deferred(),module={default:()=>null},loader=createWorkspaceModule(()=>++imports===1?old.promise:Promise.resolve(module));
 const warm=loader.preload(),first=loader.load(),second=loader.load();assert.equal(first,second);old.reject(Error('temporary preload failure'));
 assert.equal(await warm,undefined);assert.equal(await first,module);assert.equal(imports,2);
});
test('intent import failure has one bounded retry and does not leave a permanently rejected loader promise',async()=>{
 let imports=0,working=false;const module={default:()=>null},loader=createWorkspaceModule(()=>{imports++;if(!working)throw Error('offline');return module});
 await assert.rejects(loader.load(),/offline/);assert.equal(imports,2);working=true;assert.equal(await loader.load(),module);assert.equal(imports,3);
});
