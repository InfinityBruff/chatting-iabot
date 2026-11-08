import test from 'node:test';
import assert from 'node:assert/strict';
import {createBruffControlHandler} from '../supabase/functions/bruff-control/handler.js';
import {runTeachingAction,runFanMemoryAction,fanMemorySnapshot} from '../supabase/functions/bruff-control/admin-teaching.js';
const actor='10000000-0000-4000-8000-000000000001',w='20000000-0000-4000-8000-000000000001',c='30000000-0000-4000-8000-000000000001',id='40000000-0000-4000-8000-000000000001',rid='50000000-0000-4000-8000-000000000001',foreign='60000000-0000-4000-8000-000000000001';
const scoped={workspace_id:w,model_id:c},base='https://unit.supabase.co',at='2026-11-08T01:00:00.000Z';
const entry=()=>({trigger:'hello',english:'  Hello! How is your day?\n',spanish:'  ¡Hola! ¿Cómo va tu día?\n',reference_id:'owner.lesson.1',label:'Owner instruction',source_version:'v1'});
const teaching=(patch={})=>({...scoped,kind:'example',expected_version:0,permission_version:1,request_id:rid,reviewed:true,entry:entry(),...patch});
const memory=(patch={})=>({actorId:actor,workspaceId:w,creatorId:c,fanId:'77',binding:'acct_fixture',version:1,contextRevision:'a'.repeat(64),items:[{key:'preferred_name',category:'preferred_name',value:'Fictional Alex',status:'pending',pinned:false,origin:'analysis',source:{messageId:'900',quote:'Call me Fictional Alex',at,author:'fan'}}],coverage:{historyComplete:false,cursor:'next-page',pages:1,recentCheckedAt:at,historyCheckedAt:null,messagesObserved:1,contextLimited:true},...patch});
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
function fixture(options={}){
 const calls=[],state={revoked:false,permission:{enabled:false,allowedKinds:[]},version:0};
 const handler=createBruffControlHandler({url:base,anonKey:'public-fixture',ownerActionsEnabled:options.enabled??true,fetcher:async(url,request)=>{
  const path=url.slice(base.length),body=request.body?JSON.parse(request.body):null;calls.push({path,body,request});const response=await options.respond?.(path,body,state);if(response!==undefined)return response;
  if(path==='/auth/v1/user')return json({id:actor,email_confirmed_at:at,is_anonymous:false});
  if(path==='/rest/v1/rpc/bruff_ai_models')return state.revoked?json({code:'42501'},403):json({actorId:actor,workspaces:[{id:w,name:'Fictional workspace',models:[{id:c,name:'Fictional model'}]}]});
  if(path==='/rest/v1/rpc/bruff_teaching_permission'){
   if(body.op==='save'){if(body.expected!==state.version)return json({code:'40001'},409);state.version++;state.permission=body.value}
   return json({actorId:actor,workspaceId:w,creatorId:c,permission:state.permission,version:state.version});
  }
  if(path==='/rest/v1/rpc/bruff_save_reviewed_teaching')return json({actorId:actor,workspaceId:w,creatorId:c,requestId:body.request_id,permissionVersion:body.permission_version,kind:body.kind,reused:false,source:{id,version:body.expected+1,state:'verified',...body.value}});
  if(path==='/functions/v1/bruff-memory')return json(memory({version:body.edit?body.edit.expected_version+1:1}));
  throw Error('Unexpected network path');
 }});
 const invoke=(method,params={},authorized=true)=>handler(new Request(base+'/functions/v1/bruff-control',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer fixture-owner'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
 return {calls,state,run:(name,args={},auth=true)=>invoke('tools/call',{name,arguments:{...scoped,...args}},auth),list:()=>invoke('tools/list')};
}
const result=async response=>(await response.json()).result;

test('seven owner additions are discovered only with the existing explicit owner flag and real authentication',async()=>{
 const disabled=fixture({enabled:false}),legacy=await result(await disabled.list());assert.equal(legacy.tools.length,12);const before=disabled.calls.length;assert.equal((await disabled.run('bruff_read_teaching_permission')).status,400);assert.equal(disabled.calls.length,before);
 const f=fixture(),tools=(await result(await f.list())).tools;assert.equal(tools.length,32);for(const name of ['bruff_read_teaching_permission','bruff_save_teaching_permission','bruff_save_reviewed_teaching','bruff_read_fan_memory','bruff_sync_fan_memory','bruff_import_fan_memory_candidates','bruff_edit_fan_memory'])assert.ok(tools.some(t=>t.name===name));
 assert.equal(tools.find(t=>t.name==='bruff_save_reviewed_teaching').annotations.idempotentHint,true);assert.equal(tools.find(t=>t.name==='bruff_sync_fan_memory').annotations.openWorldHint,false);assert.equal((await f.run('bruff_read_teaching_permission',{},false)).status,401);
});

test('permission starts disabled, saves and revokes with CAS without changing generation or dispatching anything',async()=>{
 const f=fixture(),initial=(await result(await f.run('bruff_read_teaching_permission'))).structuredContent;assert.equal(initial.version,0);assert.deepEqual(initial.permission,{enabled:false,allowedKinds:[]});
 const permission={enabled:true,allowedKinds:['style_rule','example']},saved=await result(await f.run('bruff_save_teaching_permission',{expected_version:0,permission,confirmed:true}));assert.equal(saved.isError,false);assert.equal(saved.structuredContent.version,1);assert.deepEqual(saved.structuredContent.permission.allowedKinds,['example','style_rule']);
 const stale=await result(await f.run('bruff_save_teaching_permission',{expected_version:0,permission,confirmed:true}));assert.equal(stale.isError,true);assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_teaching_permission')&&x.body.op==='save').length,2);
 const revoked=await result(await f.run('bruff_save_teaching_permission',{expected_version:1,permission:{...permission,enabled:false},confirmed:true}));assert.equal(revoked.structuredContent.permission.enabled,false);assert.ok(f.calls.every(x=>!/(?:generation|autopilot|bruff-live|bruff-drafts)/u.test(x.path)));
});

test('one teaching operation maps exact source text to the fixed atomic RPC and rechecks ownership',async()=>{
 const f=fixture(),response=await result(await f.run('bruff_save_reviewed_teaching',teaching()));assert.equal(response.isError,false);assert.equal(response.structuredContent.source.english,entry().english);assert.equal(response.structuredContent.source.state,'verified');assert.equal(response.structuredContent.requestId,rid);
 assert.deepEqual(f.calls.find(x=>x.path.endsWith('/bruff_save_reviewed_teaching')).body,{w,c,kind:'example',source_id:null,expected:0,permission_version:1,request_id:rid,reviewed:true,value:{trigger:entry().trigger,english:entry().english,spanish:entry().spanish,referenceId:entry().reference_id,label:entry().label,sourceVersion:entry().source_version}});assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_ai_models')).length,2);assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_save_reviewed_teaching')).length,1);
});

test('rules, facts and boundaries keep their category and only a fact may carry a permitted key',async()=>{
 for(const kind of ['style_rule','model_fact','boundary']){const f=fixture(),e={text:'Use a friendly tone.',reference_id:'owner.rule.1',label:'Owner rule',source_version:'v1',...(kind==='model_fact'?{key:'about'}:{})},response=await result(await f.run('bruff_save_reviewed_teaching',teaching({kind,entry:e})));
  assert.equal(response.isError,false);assert.deepEqual(response.structuredContent.source,{id,version:1,state:'verified',...e});assert.equal(f.calls.find(x=>x.path.endsWith('/bruff_save_reviewed_teaching')).body.kind,kind);
 }
});

test('unreviewed inputs, FAQ enums, inferred source fields, coercions and invalid category keys never write',async()=>{
 const f=fixture();for(const patch of [{reviewed:false},{kind:'FAQ'},{expected_version:'0'},{source_id:id},{entry:{...entry(),state:'verified'}},{entry:{...entry(),actorId:foreign}},{entry:{...entry(),source_version:'0'}},{entry:{...entry(),english:'Hello {{NAME}}'}},{kind:'style_rule',entry:{text:'Use short replies.',key:'age',reference_id:'x',label:'Rule',source_version:'v1'}}]){const before=f.calls.filter(x=>x.path.endsWith('/bruff_save_reviewed_teaching')).length;await f.run('bruff_save_reviewed_teaching',teaching(patch));assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_save_reviewed_teaching')).length,before)}
});

test('a CAS error is returned once, owner revocation hides successful source output and a foreign model never reaches teaching',async()=>{
 const conflict=fixture({respond:path=>path.endsWith('/bruff_save_reviewed_teaching')?json({code:'40001'},409):undefined}),failure=await result(await conflict.run('bruff_save_reviewed_teaching',teaching()));assert.equal(failure.isError,true);assert.equal(conflict.calls.filter(x=>x.path.endsWith('/bruff_save_reviewed_teaching')).length,1);
 const revoked=fixture({respond:(path,body,state)=>{if(path.endsWith('/bruff_save_reviewed_teaching'))state.revoked=true}}),response=await revoked.run('bruff_save_reviewed_teaching',teaching());assert.equal(response.status,403);assert.ok(!(await response.text()).includes(entry().english.trim()));
 const foreignModel=fixture();assert.equal((await foreignModel.run('bruff_save_reviewed_teaching',teaching({model_id:foreign}))).status,403);assert.ok(!foreignModel.calls.some(x=>x.path.endsWith('/bruff_save_reviewed_teaching')));
});

test('safe source projection rejects unconfirmed state, changed text, source ID/version or identity',async()=>{
 const canonical={actorId:actor,workspaceId:w,creatorId:c,requestId:rid,permissionVersion:1,kind:'example',reused:false,source:{id,version:1,state:'verified',trigger:entry().trigger,english:entry().english,spanish:entry().spanish,referenceId:entry().reference_id,label:entry().label,sourceVersion:entry().source_version}};
 for(const patch of [{actorId:foreign},{workspaceId:foreign},{creatorId:foreign},{requestId:foreign},{source:{...canonical.source,version:2}},{source:{...canonical.source,state:'draft'}},{source:{...canonical.source,english:'Changed text'}},{source:{...canonical.source,url:'private'}}])await assert.rejects(()=>runTeachingAction({name:'bruff_save_reviewed_teaching',args:teaching(),actor,w,c,rpc:async()=>({...canonical,...patch}),recheckOwner:async()=>{}}));
});

test('fan memory reads and syncs route only the scoped fan to a fixed endpoint, preserving partial coverage',async()=>{
 const f=fixture(),read=await result(await f.run('bruff_read_fan_memory',{fan_id:'77'}));assert.equal(read.structuredContent.coverage.historyComplete,false);assert.equal(read.structuredContent.items[0].status,'pending');assert.equal(read.structuredContent.modelId,c);
 await f.run('bruff_sync_fan_memory',{fan_id:'77',scan:'older'});assert.deepEqual(f.calls.filter(x=>x.path==='/functions/v1/bruff-memory').map(x=>x.body),[{operation:'fan_memory_read',workspace_id:w,creator_id:c,conversation_id:'77'},{operation:'fan_memory_sync',workspace_id:w,creator_id:c,conversation_id:'77',scan:'older'}]);assert.ok(f.calls.every(x=>!/(?:bruff-live|bruff-drafts|generation_claim|queue_selected)/u.test(x.path)));
});

test('fan memory edits use a single CAS, accept a value only for correct and never retry an uncertain update',async()=>{
 const f=fixture();for(const action of ['confirm','pin','delete','correct']){const args={fan_id:'77',key:'preferred_name',action,expected_version:1,...(action==='correct'?{value:'Fictional Sam'}:{})},response=await result(await f.run('bruff_edit_fan_memory',args));assert.equal(response.structuredContent.version,2)}
 const before=f.calls.filter(x=>x.path==='/functions/v1/bruff-memory').length;await f.run('bruff_edit_fan_memory',{fan_id:'77',key:'preferred_name',action:'confirm',expected_version:1,value:'must not apply'});await f.run('bruff_sync_fan_memory',{fan_id:'077',scan:'recent'});assert.equal(f.calls.filter(x=>x.path==='/functions/v1/bruff-memory').length,before);
 const conflict=fixture({respond:path=>path==='/functions/v1/bruff-memory'?json({error:'private detail'},409):undefined});const failed=await result(await conflict.run('bruff_edit_fan_memory',{fan_id:'77',key:'preferred_name',action:'pin',expected_version:1}));assert.equal(failed.structuredContent.errorCode,'FAN_MEMORY_CHANGED');assert.equal(conflict.calls.filter(x=>x.path==='/functions/v1/bruff-memory').length,1);assert.ok(!JSON.stringify(failed).includes('private detail'));
});

test('memory projections reject fan/model leakage, malformed sources, extra item fields and false completion',()=>{
 const valid=memory(),clean=fanMemorySnapshot({...valid,secret:'not exposed'},actor,w,c,'77');assert.equal(Object.hasOwn(clean,'secret'),false);
 for(const patch of [{fanId:'78'},{creatorId:foreign},{actorId:foreign},{contextRevision:'bad'},{items:[{...valid.items[0],url:'https://private'}]},{items:[{...valid.items[0],source:{...valid.items[0].source,messageId:'0900'}}]},{coverage:{...valid.coverage,historyComplete:true}},{items:Array(101).fill(valid.items[0])}])assert.throws(()=>fanMemorySnapshot({...valid,...patch},actor,w,c,'77'));
});

test('revoked or limited memory reads do not reveal body data or retry; post-read revocation hides results',async()=>{
 for(const status of [401,403,409,429,503]){let count=0;await assert.rejects(()=>runFanMemoryAction({name:'bruff_read_fan_memory',args:{fan_id:'77'},actor,w,c,call:async()=>{count++;return {ok:false,status,data:{private:'not exposed'},retryAfter:30}},recheckOwner:async()=>{}}),e=>!e.message.includes('not exposed'));assert.equal(count,1)}
 const f=fixture({respond:(path,body,state)=>{if(path==='/functions/v1/bruff-memory')state.revoked=true}}),response=await f.run('bruff_read_fan_memory',{fan_id:'77'});assert.equal(response.status,403);assert.ok(!(await response.text()).includes('Fictional Alex'));
});
