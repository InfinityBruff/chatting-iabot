import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBruffControlHandler} from '../supabase/functions/bruff-control/handler.js';

const base='https://bruff-test.supabase.co',endpoint=base+'/functions/v1/bruff-control',token='Bearer real-user-token',actor='11111111-1111-4111-8111-111111111111',w='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',example='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
const settings={mode:'bank',maxResults:3,minScore:.65,dailyLimit:20};
const entry={trigger:'How is your morning?',english:'Good morning! 🙂',spanish:'¡Buenos días! 🙂',reference_id:'guide.morning',label:'Guía documental',source_version:'v1'};
const row=patch=>({id:example,version:1,state:'draft',trigger:entry.trigger,english:entry.english,spanish:entry.spanish,referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version,reviewedBy:other,...patch});
const examples=patch=>({schemaVersion:1,status:'connected',canEdit:true,items:[row()],total:1,limit:200,complete:true,savedId:null,...patch});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture(overrides={}){
 const calls=[],state={revoked:false};
 const handler=createBruffControlHandler({url:base,anonKey:'public-anon-key',...overrides,fetcher:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):undefined;calls.push({url,options,body});
  if(overrides.respond){const custom=await overrides.respond(url,options,body,state);if(custom!==undefined)return custom}
  if(url===base+'/auth/v1/user')return json(overrides.identity??{id:actor,email_confirmed_at:'2026-11-01T00:00:00Z',email:'private@example.com'});
  if(url===base+'/rest/v1/rpc/bruff_ai_models')return state.revoked?json({code:'42501',message:'private owner details'},403):json(overrides.models??{actorId:actor,workspaces:[{id:w,name:'Agencia',models:[{id:c,name:'Modelo'}]}]});
  if(url===base+'/rest/v1/rpc/bruff_ai_control')return json(overrides.control??{actorId:actor,workspaceId:w,creatorId:c,settings:body.op==='save'?body.value:settings,version:body.op==='save'?1:0});
  if(url===base+'/rest/v1/rpc/bruff_chat_direct_knowledge')return json(overrides.knowledge??examples(body.op==='list'?{}:{savedId:body.example_id||example,items:[row({id:body.example_id||example,version:body.op==='archive'?2:1,state:body.op==='archive'?'archived':'draft'})]}));
  throw Error('Non-allowlisted network request');
 }});
 return {handler,calls,state};
}
function request(method='tools/list',params={},options={}){
 const message={jsonrpc:'2.0',id:1,method,params},headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:token,...options.headers};
 return new Request(options.url||endpoint,{method:'POST',headers,body:options.raw??JSON.stringify(options.message??message),...(options.signal?{signal:options.signal}:{})});
}
const call=(name,args={workspace_id:w,model_id:c},options={})=>request('tools/call',{name,arguments:args},options);
const modern=(method,params={})=>request(method,{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}},{headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':method,...(params.name?{'Mcp-Name':params.name}:{})}});
const body=response=>response.json();

test('RFC9728 metadata and protocol initialization disclose no private data and make no upstream calls',async()=>{
 const f=fixture();const meta=await f.handler(new Request(endpoint+'/.well-known/oauth-protected-resource',{headers:{Origin:'https://untrusted.example'}}));assert.equal(meta.status,200);assert.deepEqual(await body(meta),{resource:endpoint,authorization_servers:[base+'/auth/v1'],bearer_methods_supported:['header'],scopes_supported:['openid','email','profile'],resource_name:'BRUFF · Control privado IA'});assert.equal(meta.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(meta.headers.get('Access-Control-Allow-Credentials'),null);
 const init=await f.handler(request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Test',version:'1'}},{headers:{Authorization:''}}));assert.equal(init.status,200);const data=await body(init);assert.equal(data.result.protocolVersion,'2025-03-26');assert.equal(data.result.capabilities.tools.listChanged,false);assert.ok(!JSON.stringify(data).includes(actor));assert.equal(f.calls.length,0);
});

test('modern discovery is stateless, versioned, complete and public',async()=>{
 const f=fixture(),response=await f.handler(modern('server/discover'));assert.equal(response.status,200);const data=await body(response);assert.equal(data.result.resultType,'complete');assert.deepEqual(data.result.supportedVersions,['2026-07-28','2025-03-26']);assert.equal(data.result._meta['io.modelcontextprotocol/serverInfo'].name,'bruff-control');assert.equal(f.calls.length,0);assert.equal(response.headers.get('Mcp-Session-Id'),null);
});

test('canonical, Supabase function-prefixed and root mounts route identically without changing the public resource',async()=>{
 for(const path of ['/functions/v1/bruff-control','/bruff-control','']){
  const f=fixture(),mount='https://internal-edge.example'+path;
  for(const suffix of ['','/']){
   const url=mount+suffix,initialize=await f.handler(request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Test',version:'1'}},{url}));assert.equal(initialize.status,200,url);
   const challenge=await f.handler(request('tools/list',{}, {url,headers:{Authorization:''}}));assert.equal(challenge.status,401,url);assert.equal(challenge.headers.get('WWW-Authenticate'),`Bearer resource_metadata="${endpoint}/.well-known/oauth-protected-resource"`);
  }
  const metadata=await f.handler(new Request(mount+'/.well-known/oauth-protected-resource'));assert.equal(metadata.status,200);assert.equal((await body(metadata)).resource,endpoint);assert.equal(f.calls.length,0);
  const scoped=await f.handler(call('bruff_read_ai_settings',{workspace_id:w,model_id:c},{url:mount||'https://internal-edge.example/'}));assert.equal(scoped.status,200);assert.equal((await body(scoped)).result.structuredContent.modelId,c);assert.equal(f.calls[2].url,base+'/rest/v1/rpc/bruff_ai_control');
 }
});

test('mount aliases do not enable arbitrary suffixes, similar function names or private metadata POSTs',async()=>{
 const paths=['/functions/v1','/other-function','/bruff-control-other','/arbitrary/bruff-control','/functions/v1/bruff-control/arbitrary','/bruff-control/send_message','/send_message','//','/functions/v1/bruff-control/.well-known/oauth-protected-resource/extra','/bruff-control/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource'];
 for(const path of paths){const f=fixture(),response=await f.handler(request('tools/list',{}, {url:'https://internal-edge.example'+path}));assert.equal(response.status,404,path);assert.equal(f.calls.length,0)}
});

test('legacy initialized notification is accepted without creating a session or calling the database',async()=>{
 const f=fixture(),response=await f.handler(request('notifications/initialized',{}, {message:{jsonrpc:'2.0',method:'notifications/initialized'}}));assert.equal(response.status,202);assert.equal(await response.text(),'');assert.equal(f.calls.length,0);
});

test('tool discovery requires a real confirmed user and a current owner RPC',async()=>{
 const f=fixture(),response=await f.handler(request());assert.equal(response.status,200);const data=await body(response);assert.deepEqual(data.result.tools.map(tool=>tool.name),['bruff_list_models','bruff_read_ai_settings','bruff_update_ai_settings','bruff_list_examples','bruff_save_example_draft','bruff_archive_example']);assert.deepEqual(f.calls.map(item=>item.url),[base+'/auth/v1/user',base+'/rest/v1/rpc/bruff_ai_models']);
 for(const tool of data.result.tools){assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.annotations.openWorldHint,false);assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['openid','email','profile']}]);assert.deepEqual(tool.securitySchemes,tool._meta.securitySchemes);const readOnly=['bruff_list_models','bruff_read_ai_settings','bruff_list_examples'].includes(tool.name);assert.equal(tool.annotations.readOnlyHint,readOnly);assert.equal(tool.annotations.destructiveHint,!readOnly);assert.equal(tool.annotations.idempotentHint,readOnly)}
});

test('missing or expired authorization returns a metadata challenge, without privileged fallback',async()=>{
 const f=fixture();for(const authorization of ['', 'Basic credentials','Bearer a,b']){const response=await f.handler(request('tools/list',{}, {headers:{Authorization:authorization}}));assert.equal(response.status,401);assert.equal(response.headers.get('WWW-Authenticate'),`Bearer resource_metadata="${endpoint}/.well-known/oauth-protected-resource"`)}assert.equal(f.calls.length,0);
 const expired=fixture({respond:url=>url.endsWith('/auth/v1/user')?json({message:'sensitive token details'},401):undefined});const response=await expired.handler(request());assert.equal(response.status,401);assert.ok(!(await response.text()).includes('sensitive'));assert.equal(expired.calls.length,1);
});

test('unconfirmed and anonymous accounts cannot enumerate tools or invoke RPCs',async()=>{
 for(const identity of [{id:actor},{id:actor,email_confirmed_at:null},{id:actor,email_confirmed_at:'date',is_anonymous:true},{id:'invalid',email_confirmed_at:'date'}]){const f=fixture({identity}),response=await f.handler(request());assert.equal(response.status,401);assert.equal(f.calls.length,1)}
});

test('owner removal is checked again on every request and no owner cache is used',async()=>{
 const f=fixture();assert.equal((await f.handler(call('bruff_read_ai_settings'))).status,200);f.state.revoked=true;assert.equal((await f.handler(call('bruff_read_ai_settings'))).status,403);assert.equal(f.calls.filter(item=>item.url.endsWith('/auth/v1/user')).length,2);assert.equal(f.calls.filter(item=>item.url.endsWith('/bruff_ai_control')).length,1);
 const worker=fixture({models:{actorId:actor,workspaces:[]}});assert.equal((await worker.handler(request())).status,403);
});

test('another model cannot be accessed even with a valid owner session',async()=>{
 const f=fixture(),response=await f.handler(call('bruff_read_ai_settings',{workspace_id:w,model_id:other}));assert.equal(response.status,403);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].body,{w});
});

test('a role change between owner preflight and the actual scoped RPC is denied',async()=>{
 const f=fixture({respond:url=>url.endsWith('/bruff_ai_control')?json({code:'42501',message:'worker-name confidential'},403):undefined});const response=await f.handler(call('bruff_read_ai_settings'));assert.equal(response.status,403);assert.ok(!(await response.text()).includes('confidential'));
});

test('a session revoked between Auth and the actual RPC receives a fresh OAuth challenge',async()=>{
 const f=fixture({respond:url=>url.endsWith('/bruff_ai_control')?json({message:'private revoked details'},401):undefined}),response=await f.handler(call('bruff_read_ai_settings'));assert.equal(response.status,401);assert.ok(response.headers.get('WWW-Authenticate').includes('resource_metadata='));assert.ok(!(await response.text()).includes('private'));
});

test('settings calls map only fixed parameters and return a validated identity-bound projection',async()=>{
 const f=fixture(),response=await f.handler(call('bruff_update_ai_settings',{workspace_id:w,model_id:c,expected_version:0,settings:{mode:'semantic',maxResults:2,minScore:.9,dailyLimit:4}}));assert.equal(response.status,200);const result=(await body(response)).result.structuredContent;assert.equal(result.actorId,actor);assert.equal(result.workspaceId,w);assert.equal(result.modelId,c);assert.equal(result.version,1);assert.deepEqual(f.calls[2].body,{w,c,op:'save',expected:0,value:{mode:'semantic',maxResults:2,minScore:.9,dailyLimit:4}});
});

test('invalid limits, coerced numbers and unknown settings cannot reach any RPC',async()=>{
 for(const patch of [{maxResults:4},{maxResults:'3'},{minScore:.49},{minScore:1},{dailyLimit:0},{dailyLimit:101},{mode:'auto-send'},{send:true}]){const f=fixture(),response=await f.handler(call('bruff_update_ai_settings',{workspace_id:w,model_id:c,expected_version:0,settings:{...settings,...patch}}));assert.equal(response.status,400,JSON.stringify(patch));assert.equal(f.calls.length,0)}
});

test('a new documentary example is always a draft; source text and whitespace are preserved',async()=>{
 const f=fixture(),response=await f.handler(call('bruff_save_example_draft',{workspace_id:w,model_id:c,expected_version:0,entry:{...entry,english:'  Original 🙂\nNext line.  '}}));assert.equal(response.status,200);assert.deepEqual(f.calls[2].body,{w,c,op:'save',example_id:null,expected:0,value:{trigger:entry.trigger,english:'  Original 🙂\nNext line.  ',spanish:entry.spanish,state:'draft',referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version}});assert.equal((await body(response)).result.structuredContent.savedId,example);
});

test('approval, media, variables, actor claims and arbitrary RPC parameters are not accepted',async()=>{
 const cases=[{...entry,state:'verified'},{...entry,reviewed:true},{...entry,media:[{id:'99'}]},{...entry,variables:[]},{...entry,source_version:'0'},{...entry,english:'Hi {{NAME}}'}];
 for(const input of cases){const f=fixture(),response=await f.handler(call('bruff_save_example_draft',{workspace_id:w,model_id:c,expected_version:0,entry:input}));assert.equal(response.status,400);assert.equal(f.calls.length,0)}
 for(const extra of [{actorId:other},{rpc:'send_message'},{url:'https://private.example'},{op:'approve'},{value:{state:'verified'}}]){const f=fixture();assert.equal((await f.handler(call('bruff_list_examples',{workspace_id:w,model_id:c,...extra}))).status,400);assert.equal(f.calls.length,0)}
});

test('editing and archiving require a concrete example and a positive current version',async()=>{
 const f=fixture(),response=await f.handler(call('bruff_archive_example',{workspace_id:w,model_id:c,example_id:example,expected_version:1}));assert.equal(response.status,200);assert.deepEqual(f.calls[2].body,{w,c,op:'archive',example_id:example,expected:1,value:null});assert.equal((await body(response)).result.structuredContent.items[0].state,'archived');
 for(const args of [{workspace_id:w,model_id:c,example_id:example,expected_version:0,entry},{workspace_id:w,model_id:c,expected_version:1,entry}]){const invalid=fixture();assert.equal((await invalid.handler(call('bruff_save_example_draft',args))).status,400);assert.equal(invalid.calls.length,0)}
});

test('a version conflict is an MCP tool error with HTTP200 and is never retried automatically',async()=>{
 const f=fixture({respond:url=>url.endsWith('/bruff_chat_direct_knowledge')?json({code:'40001',message:'private SQL trace'},409):undefined}),response=await f.handler(call('bruff_archive_example',{workspace_id:w,model_id:c,example_id:example,expected_version:1}));assert.equal(response.status,200);const data=await body(response);assert.equal(data.result.isError,true);assert.match(data.result.content[0].text,/versión ha cambiado/);assert.equal(data.error,undefined);assert.ok(!JSON.stringify(data).includes('SQL'));assert.equal(f.calls.length,3);
});

test('outputs omit auth email, other worker IDs and opaque upstream fields',async()=>{
 const f=fixture({knowledge:examples({adminSecret:'never-output',items:[row({reviewedBy:other,createdBy:other,providerKey:'never-output'})]})}),response=await f.handler(call('bruff_list_examples'));assert.equal(response.status,200);const text=await response.text();for(const secret of ['private@example.com',other,'never-output','reviewedBy','providerKey'])assert.ok(!text.includes(secret),secret);
});

test('a mismatched database actor, scope or unexpected result fails closed without echoing payload',async()=>{
 for(const patch of [{actorId:other},{workspaceId:other},{creatorId:other},{settings:{...settings,unexpected:'secret'}}]){const f=fixture({control:{actorId:actor,workspaceId:w,creatorId:c,settings,version:0,...patch}}),response=await f.handler(call('bruff_read_ai_settings'));assert.equal(response.status,200);const result=await response.text();assert.equal(JSON.parse(result).result.isError,true);assert.ok(!result.includes(other))}
 const f=fixture({models:{actorId:other,workspaces:[]}});assert.equal((await f.handler(request())).status,503);
});

test('unexpected approval or wrong example in a draft-save response is not reported as successful',async()=>{
 for(const patch of [{savedId:example,items:[row({state:'verified'})]},{savedId:other,items:[row()]}]){const f=fixture({knowledge:examples(patch)}),response=await f.handler(call('bruff_save_example_draft',{workspace_id:w,model_id:c,example_id:example,expected_version:1,entry}));assert.equal(response.status,200);assert.equal((await body(response)).result.isError,true)}
});

test('only the six allowlisted tools and three fixed RPC paths are reachable',async()=>{
 for(const name of ['send_message','bruff_approve_example','bruff_delete_example','bruff_activate_bot','bruff_ai_generate','bruff_chat_direct_knowledge','__proto__']){const f=fixture();assert.equal((await f.handler(call(name))).status,400);assert.equal(f.calls.length,0)}
 const f=fixture();assert.equal((await f.handler(request('rpc',{name:'bruff_send'}))).status,404);assert.equal(f.calls.length,0);
});

test('streamed request bodies have a 128KiB byte limit, even without Content-Length',async()=>{
 for(const raw of ['x'.repeat(131073),JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{oversized:'🙂'.repeat(40000)}})]){const f=fixture(),response=await f.handler(request('tools/list',{}, {raw}));assert.equal(response.status,413);assert.equal(f.calls.length,0)}
 const f=fixture();assert.equal((await f.handler(request('tools/list',{}, {headers:{'Content-Length':'131073'}}))).status,413);assert.equal(f.calls.length,0);
});

test('a silent incoming stream has a whole-request deadline and is cancelled without any upstream reads',async()=>{
 let cancelled=0,calls=0;const handler=createBruffControlHandler({url:base,anonKey:'public-anon-key',timeoutMs:5,fetcher:()=>{calls++;throw Error('Must not fetch')}}),stream=new ReadableStream({cancel(){cancelled++}}),req=new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},duplex:'half',body:stream});
 const response=await handler(req);assert.equal(response.status,408);assert.equal(cancelled,1);assert.equal(calls,0);assert.equal((await body(response)).error.code,-32600);
});

test('aborting an incoming stream cancels its reader immediately and never proceeds to Auth',async()=>{
 let cancelled=0,calls=0;const controller=new AbortController(),handler=createBruffControlHandler({url:base,anonKey:'public-anon-key',fetcher:()=>{calls++;throw Error('Must not fetch')}}),req=new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},duplex:'half',signal:controller.signal,body:new ReadableStream({cancel(){cancelled++}})}),pending=handler(req);controller.abort();assert.equal((await pending).status,408);assert.equal(cancelled,1);assert.equal(calls,0);
});

test('upstream JSON bodies are size bounded and incomplete responses cannot become successful tool results',async()=>{
 let cancelled=0;const f=fixture({respond:url=>url.endsWith('/bruff_ai_control')?new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1))},cancel(){cancelled++}}),{headers:{'Content-Type':'application/json'}}):undefined}),response=await f.handler(call('bruff_read_ai_settings'));assert.equal(response.status,200);assert.equal((await body(response)).result.isError,true);assert.equal(cancelled,1);assert.equal(f.calls.length,3);
});

test('an upstream body stalled after response headers is cancelled at the same whole-request deadline',async()=>{
 let cancelled=0;const f=fixture({timeoutMs:8,respond:url=>url.endsWith('/bruff_ai_control')?new Response(new ReadableStream({cancel(){cancelled++}}),{headers:{'Content-Type':'application/json'}}):undefined}),response=await f.handler(call('bruff_read_ai_settings'));assert.equal(response.status,200);assert.equal((await body(response)).result.isError,true);assert.equal(cancelled,1);assert.equal(f.calls.length,3);
});

test('database application constraints are tool errors while invalid arguments remain protocol errors',async()=>{
 const f=fixture({respond:url=>url.endsWith('/bruff_chat_direct_knowledge')?json({code:'23514',message:'private constraint trace'},400):undefined}),response=await f.handler(call('bruff_save_example_draft',{workspace_id:w,model_id:c,expected_version:0,entry}));assert.equal(response.status,200);const data=await body(response);assert.equal(data.result.isError,true);assert.equal(data.error,undefined);assert.ok(!JSON.stringify(data).includes('private'));assert.equal(f.calls.length,3);
});

test('malformed JSON, batches, invalid IDs and extra JSON-RPC or protocol parameters fail before reads',async()=>{
 for(const raw of ['{','null','[]',JSON.stringify({jsonrpc:'2.0',id:null,method:'tools/list'}),JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',actorId:actor})]){const f=fixture();assert.equal((await f.handler(request('tools/list',{}, {raw}))).status,400);assert.equal(f.calls.length,0)}
 const f=fixture();assert.equal((await f.handler(request('tools/list',{workspace_id:w}))).status,400);assert.equal((await f.handler(request('tools/list',{}, {headers:{'Content-Type':'text/plain'}}))).status,415);
});

test('modern mirrored headers and per-request metadata must agree before any authentication reads',async()=>{
 const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
 const cases=[request('tools/list',{_meta:meta},{headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call'}}),request('tools/list',{_meta:{...meta,'io.modelcontextprotocol/protocolVersion':'2028-01-01'}},{headers:{'MCP-Protocol-Version':'2028-01-01','Mcp-Method':'tools/list'}}),request('tools/list',{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}},{headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list'}}),request('tools/call',{name:'bruff_list_models',arguments:{},_meta:meta},{headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':'bruff_send'}})];
 for(const req of cases){const f=fixture(),response=await f.handler(req);assert.equal(response.status,400);assert.equal(f.calls.length,0)}
 const f=fixture(),response=await f.handler(modern('tools/call',{name:'bruff_list_models',arguments:{}}));assert.equal(response.status,200);assert.equal((await body(response)).result.resultType,'complete');
});

test('modern ASCII tool names also accept the specified base64 header encoding, without loosening name matching',async()=>{
 const name='bruff_list_models',meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
 const f=fixture(),response=await f.handler(request('tools/call',{name,arguments:{},_meta:meta},{headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':'=?base64?'+btoa(name)+'?='}}));assert.equal(response.status,200);
 const invalid=fixture(),bad=await invalid.handler(request('tools/call',{name,arguments:{},_meta:meta},{headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':'=?base64?not-base64!?!?='}}));assert.equal(bad.status,400);assert.equal((await body(bad)).error.code,-32020);assert.equal(invalid.calls.length,0);
});

test('discovery requires modern metadata and incompatible response formats are rejected without RPCs',async()=>{
 const f=fixture();assert.equal((await f.handler(request('server/discover'))).status,400);assert.equal((await f.handler(request('tools/list',{_meta:null}))).status,400);assert.equal((await f.handler(request('tools/list',{}, {headers:{Accept:'text/plain'}}))).status,406);assert.equal(f.calls.length,0);
});

test('configured origins are exact, preflight is bounded, and endpoint GET cannot open a private stream',async()=>{
 const f=fixture();assert.equal((await f.handler(request('tools/list',{}, {headers:{Origin:'https://chatgpt.com.attacker.example'}}))).status,403);assert.equal((await f.handler(new Request(endpoint,{method:'OPTIONS',headers:{Origin:'https://chatgpt.com'}}))).status,204);assert.equal((await f.handler(new Request(endpoint))).status,405);assert.equal((await f.handler(new Request(endpoint+'/arbitrary',{method:'POST'}))).status,404);assert.equal(f.calls.length,0);
 const allowed=await f.handler(request('tools/list',{}, {headers:{Origin:'https://chatgpt.com'}}));assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'https://chatgpt.com');assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'),null);
});

test('upstream requests forward only the real bearer and public key, with deadlines and redirects disabled',async()=>{
 const f=fixture();await f.handler(call('bruff_read_ai_settings',{workspace_id:w,model_id:c},{headers:{Cookie:'private-cookie=secret',apikey:'attacker-key','X-Actor-ID':other}}));
 for(const {url,options} of f.calls){assert.ok(url.startsWith(base+'/auth/v1/user')||url.startsWith(base+'/rest/v1/rpc/'));assert.deepEqual(options.headers,{apikey:'public-anon-key',Authorization:token,'Content-Type':'application/json'});assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);assert.ok(!options.body?.includes('private-cookie'))}
});

test('authentication timeouts are safe and cannot fall back to owner or provider access',async()=>{
 const calls=[],handler=createBruffControlHandler({url:base,anonKey:'public-anon-key',timeoutMs:5,fetcher:(url,{signal})=>{calls.push(url);return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private timeout token')),{once:true}))}}),response=await handler(request());assert.equal(response.status,503);assert.equal(calls.length,1);assert.ok(!(await response.text()).includes('token'));
});

test('configuration cannot become a user-controlled URL or service-role transport',async()=>{
 const handler=createBruffControlHandler({url:'http://127.0.0.1',anonKey:'key',fetcher:()=>{throw Error('Must not fetch')}});assert.equal((await handler(request())).status,503);
 const source=await readFile(new URL('../supabase/functions/bruff-control/index.ts',import.meta.url),'utf8');assert.match(source,/SUPABASE_ANON_KEY/);assert.doesNotMatch(source,/SERVICE_ROLE|serviceKey|OFMAPI|ONLYX/i);
});
