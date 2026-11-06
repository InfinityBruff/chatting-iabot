import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiHandler} from '../supabase/functions/bruff-ai/handler.js';

const actor='00000000-0000-0000-0000-000000000001',workspace='00000000-0000-0000-0000-000000000002',creator='00000000-0000-0000-0000-000000000003',requestId='00000000-0000-0000-0000-000000000004';
const meta={actorId:actor,workspaceId:workspace,creatorId:creator},settings={mode:'semantic',maxResults:3,minScore:0.65,dailyLimit:20};
const example=(n=1,patch={})=>({id:'10000000-0000-0000-0000-'+String(n).padStart(12,'0'),trigger:'Question '+n,english:'Original approved answer '+n+' 🙂',spanish:'Respuesta revisada '+n+' 🙂',variables:[],source:{kind:'document',verified:true,modelId:creator,referenceId:'guide-'+n,label:'Reviewed guide '+n,version:'edition1.r1'},...patch});
const json=(value,status=200,headers={})=>Response.json(value,{status,headers});
const cfResult=response=>({success:true,result:{response}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
function fixture(options={}){
 const calls=[],rows=options.rows||[example(1),example(2),example(3)];let poolReads=0;
 const pool=()=>({...meta,version:1,approvedCount:rows.length,settings:{...settings,...options.settings},rows});
 const fetcher=async(url,input={})=>{
  calls.push({url,input,body:input.body?JSON.parse(input.body):null});
  if(url==='https://auth.test/auth/v1/user')return options.authResponse?.()||json(options.identity||{id:actor,email_confirmed_at:'2026-11-01T00:00:00Z'});
  if(url==='https://auth.test/rest/v1/rpc/bruff_ai_pool'){
   poolReads++;if(poolReads>1&&options.finalResponse)return options.finalResponse();
   return json(poolReads>1&&options.finalPool?options.finalPool(pool()):options.pool?options.pool(pool()):pool());
  }
  if(url==='https://auth.test/rest/v1/rpc/bruff_chat_direct_suggestions')return json(options.bank||{...meta,status:rows.length?'connected':'empty',approvedCount:rows.length,rows:rows.slice(0,3)});
  if(url==='https://auth.test/rest/v1/rpc/bruff_ai_claim')return options.claimResponse?.()||json({...meta,allowed:true,reason:'allowed',...options.claim});
  if(url==='https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/ai/run/@cf/baai/bge-reranker-base')return options.cf?options.cf(input):json(cfResult([{id:1,score:0.8},{id:0,score:0.95},{id:2,score:0.2}]));
  throw Error('Unexpected network route');
 };
 const handler=createAiHandler({url:'https://auth.test',anonKey:'public-anon',cloudflareAccountId:'a'.repeat(32),cloudflareToken:'private-cf-token',freeTierConfirmed:true,fetcher,...options.config});
 const run=(patch={},init={})=>handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer user-session','Content-Type':'application/json',...init.headers},body:JSON.stringify({workspace_id:workspace,creator_id:creator,query:'Question from the operator',request_id:requestId,...patch}),...init}));
 return {calls,run,handler,poolReads:()=>poolReads};
}
const providerCalls=f=>f.calls.filter(call=>call.url.startsWith('https://api.cloudflare.com/'));
const rpcCalls=f=>f.calls.filter(call=>call.url.includes('/rpc/'));

test('semantic engine ranks exact approved originals, shares no answers or fan metadata, and reauthorizes after inference',async()=>{
 const f=fixture(),response=await f.run(),body=await response.json();assert.equal(response.status,200);
 assert.equal(body.engine,'semantic');assert.equal(body.engineInvoked,true);assert.deepEqual(body.rows.map(row=>row.id),[example(1).id,example(2).id]);assert.equal(body.rows[0].english,example(1).english);assert.equal(body.rows[0].spanish,example(1).spanish);
 assert.deepEqual({actorId:body.actorId,workspaceId:body.workspaceId,creatorId:body.creatorId},meta);
 assert.equal(body.rows.some(row=>Object.hasOwn(row,'trigger')),false);
 assert.deepEqual(providerCalls(f)[0].body,{query:'Question from the operator',contexts:[{text:'Question 1'},{text:'Question 2'},{text:'Question 3'}],top_k:3});
 assert.deepEqual(providerCalls(f)[0].input.headers,{Authorization:'Bearer private-cf-token','Content-Type':'application/json'});
 assert.equal(JSON.stringify(providerCalls(f)[0].body).includes('Original approved'),false);
 assert.deepEqual(rpcCalls(f).map(call=>call.url.split('/').at(-1)),['bruff_ai_pool','bruff_ai_claim','bruff_ai_pool']);
 for(const call of f.calls.filter(call=>call.url.startsWith('https://auth.test/'))){assert.equal(call.input.headers.Authorization,'Bearer user-session');assert.equal(call.input.headers.apikey,'public-anon')}
 assert.deepEqual(rpcCalls(f)[1].body,{w:workspace,c:creator,request_id:requestId});
 assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('bank mode uses the existing authenticated bank RPC and never claims quota or consults a provider',async()=>{
 const f=fixture({settings:{mode:'bank',maxResults:1},pool:p=>({...p,rows:[]}),finalPool:p=>({...p,rows:[]}),config:{cloudflareToken:undefined,freeTierConfirmed:false}}),r=await f.run(),body=await r.json();
 assert.equal(r.status,200);assert.equal(body.engine,'bank');assert.equal(body.engineInvoked,false);assert.equal(body.rows.length,1);
 assert.deepEqual(rpcCalls(f).map(call=>call.url.split('/').at(-1)),['bruff_ai_pool','bruff_chat_direct_suggestions','bruff_ai_pool']);assert.equal(providerCalls(f).length,0);
 assert.deepEqual(rpcCalls(f)[1].body,{w:workspace,c:creator,query:'Question from the operator'});
});

test('validated uppercase UUIDs become canonical before identity comparison and quota reservation',async()=>{
 const w='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',c='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',requestId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const scoped=p=>({...p,workspaceId:w,creatorId:c,rows:p.rows.map(row=>({...row,source:{...row.source,modelId:c}}))});
 const f=fixture({pool:scoped,finalPool:scoped,claim:{workspaceId:w,creatorId:c}}),r=await f.run({workspace_id:w.toUpperCase(),creator_id:c.toUpperCase(),request_id:requestId.toUpperCase()}),body=await r.json();
 assert.equal(r.status,200);assert.equal(body.workspaceId,w);assert.equal(body.creatorId,c);assert.equal(body.rows[0].source.modelId,c);
 assert.deepEqual(rpcCalls(f).map(call=>call.body.w),[w,w,w]);assert.deepEqual(rpcCalls(f).map(call=>call.body.c),[c,c,c]);assert.equal(rpcCalls(f)[1].body.request_id,requestId);
});

test('bank mode also drops lexical results if settings, version or access change before completion',async()=>{
 for(const finalPool of [p=>({...p,version:p.version+1}),p=>({...p,settings:{...p.settings,maxResults:1}}),p=>({...p,settings:{...p.settings,mode:'semantic'}}),p=>({...p,creatorId:'other'})]){
  const f=fixture({settings:{mode:'bank'},pool:p=>({...p,rows:[]}),finalPool}),r=await f.run();assert.equal(r.status,409);assert.equal((await r.json()).rows,undefined);assert.equal(providerCalls(f).length,0);assert.equal(f.poolReads(),2);
 }
 const f=fixture({settings:{mode:'bank'},finalResponse:()=>json({code:'42501'},403)}),r=await f.run();assert.equal(r.status,409);assert.equal(providerCalls(f).length,0);
});

test('an empty semantic bank returns zero truthful examples without consuming a reservation or invoking AI',async()=>{
 const f=fixture({rows:[]}),r=await f.run(),body=await r.json();assert.equal(r.status,200);assert.equal(body.status,'empty');assert.equal(body.approvedCount,0);assert.deepEqual(body.rows,[]);assert.equal(body.engineInvoked,false);assert.equal(rpcCalls(f).length,1);assert.equal(providerCalls(f).length,0);
});

test('semantic mode never silently falls back when a secret or confirmed free-tier gate is missing',async()=>{
 for(const config of [{cloudflareToken:undefined},{cloudflareAccountId:'../other'},{cloudflareToken:'bad\nheader'},{freeTierConfirmed:false},{freeTierConfirmed:'true'}]){
  const f=fixture({config}),r=await f.run(),body=await r.json();assert.equal(r.status,503);assert.equal(body.code,'AI_NOT_CONFIGURED');assert.equal(body.configured,false);assert.equal(providerCalls(f).length,0);assert.equal(rpcCalls(f).length,1);assert.equal(body.rows,undefined);
 }
});

test('requests require a verified confirmed session before any bank or provider call',async()=>{
 const anonymous=fixture();assert.equal((await anonymous.run({}, {headers:{'Content-Type':'application/json'}})).status,401);assert.equal(anonymous.calls.length,0);
 for(const options of [{identity:{id:actor}},{identity:{id:'wrong',email_confirmed_at:'yes'}},{authResponse:()=>json({message:'private'},401)}]){const f=fixture(options);assert.equal((await f.run()).status,401);assert.equal(f.calls.length,1)}
 const outage=fixture({authResponse:()=>json({message:'private'},500)});assert.equal((await outage.run()).status,503);assert.equal(outage.calls.length,1);
});

test('input accepts only a bounded manual query and fixed scope/request fields, never fan IDs or arbitrary provider URLs',async()=>{
 for(const patch of [{query:''},{query:' '},{query:'x'.repeat(2001)},{creator_id:'../other'},{workspace_id:'bad'},{request_id:'bad'},{fan_id:'123'},{operation:'send_message'},{url:'https://evil.test'}]){const f=fixture();assert.equal((await f.run(patch)).status,400);assert.equal(f.calls.length,0)}
 const f=fixture();assert.equal((await f.handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer user-session','Content-Type':'application/json'},body:'x'.repeat(12289)}))).status,413);assert.equal(f.calls.length,0);
 assert.equal((await f.handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer user-session','Content-Type':'text/plain'},body:'{}'}))).status,415);
});

test('CORS is exact; preflight works without secrets and no GET status leaks private configuration',async()=>{
 const f=fixture({config:{url:undefined}});
 const blocked=await f.handler(new Request('https://edge.test',{method:'OPTIONS',headers:{Origin:'https://bruff-workspace.pages.dev.evil.test'}}));assert.equal(blocked.status,403);assert.equal(blocked.headers.get('Access-Control-Allow-Origin'),null);
 const allowed=await f.handler(new Request('https://edge.test',{method:'OPTIONS',headers:{Origin:'https://bruff-workspace.pages.dev'}}));assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'https://bruff-workspace.pages.dev');
 assert.equal((await f.handler(new Request('https://edge.test'))).status,405);assert.equal(f.calls.length,0);
 const qa=fixture({config:{origins:['http://127.0.0.1:8801']}});assert.equal((await qa.run({}, {headers:{Authorization:'Bearer user-session','Content-Type':'application/json',Origin:'http://127.0.0.1:8801'}})).status,200);
});

test('crossed identity, malformed pools, duplicate references and unsupported content fail before Cloudflare',async()=>{
 for(const pool of [p=>({...p,actorId:'other'}),p=>({...p,workspaceId:'other'}),p=>({...p,creatorId:'other'})]){const f=fixture({pool});assert.equal((await f.run()).status,403);assert.equal(providerCalls(f).length,0)}
 for(const pool of [p=>({...p,settings:{...p.settings,minScore:0.49}}),p=>({...p,settings:{...p.settings,minScore:1}}),p=>({...p,settings:{...p.settings,dailyLimit:101}}),p=>({...p,version:-1}),p=>({...p,approvedCount:201}),p=>({...p,rows:[]}),p=>({...p,rows:Array.from({length:201},()=>example())}),p=>({...p,approvedCount:2,rows:[example(),example()]}),p=>({...p,approvedCount:1,rows:[example(1,{content:{mediaIds:['1']}})]}),p=>({...p,approvedCount:1,rows:[example(1,{source:{...example().source,modelId:'other'}})]}),p=>({...p,approvedCount:1,rows:[example(1,{source:{...example().source,verified:false}})]}),p=>({...p,approvedCount:1,rows:[example(1,{variables:[{key:'NAME'}]})]})]){const f=fixture({pool});assert.equal((await f.run()).status,503);assert.equal(providerCalls(f).length,0)}
});

test('daily, workspace and actor caps are enforced atomically before provider access with no retry or quota bypass',async()=>{
 for(const reason of ['model_daily_limit','workspace_daily_limit','actor_minute_limit']){const f=fixture({claim:{allowed:false,reason,retryAfter:75}}),r=await f.run();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'75');assert.equal((await r.json()).code,'AI_LOCAL_LIMIT');assert.equal(providerCalls(f).length,0);assert.equal(rpcCalls(f).length,2)}
 for(const reason of ['duplicate','bank']){const f=fixture({claim:{allowed:false,reason}});assert.equal((await f.run()).status,409);assert.equal(providerCalls(f).length,0)}
 const malformed=fixture({claim:{allowed:true,reason:'unknown'}});assert.equal((await malformed.run()).status,503);assert.equal(providerCalls(malformed).length,0);
 const crossed=fixture({claim:{actorId:'other'}});assert.equal((await crossed.run()).status,409);assert.equal(providerCalls(crossed).length,0);
});

test('invalid provider indices, scores, duplicate matches and envelopes never become candidate sources',async()=>{
 for(const payload of [cfResult([{id:0,score:0.9},{id:0,score:0.8}]),cfResult([{id:3,score:1}]),cfResult([{id:-1,score:1}]),cfResult([{id:'0',score:0.9}]),cfResult([{id:0,score:'0.9'}]),cfResult([{id:0,score:-0.1}]),cfResult([{id:0,score:1.1}]),{success:false,result:{response:[{id:0,score:1}]}},{success:true,result:[]},cfResult(Array.from({length:4},(_,id)=>({id,score:0.9})))]){
  const f=fixture({cf:()=>json(payload)}),r=await f.run();assert.equal(r.status,503);assert.equal((await r.json()).rows,undefined);assert.equal(providerCalls(f).length,1);assert.equal(f.poolReads(),1);
 }
 const nan=fixture({cf:()=>new Response('{"success":true,"result":{"response":[{"id":0,"score":1e400}]}}')});assert.equal((await nan.run()).status,503);
 const malformed=fixture({cf:()=>new Response('not-json')}),r=await malformed.run();assert.equal(r.status,503);assert.equal((await r.json()).code,'AI_ENGINE_RESPONSE');
});

test('minimum score and configured maximum select fewer than three rather than fabricating matches',async()=>{
 const f=fixture({settings:{minScore:0.9,maxResults:1}}),r=await f.run(),body=await r.json();assert.equal(r.status,200);assert.deepEqual(body.rows.map(row=>row.id),[example(1).id]);
 const none=fixture({cf:()=>json(cfResult([{id:0,score:0.5}]))}),empty=await none.run();assert.equal(empty.status,200);assert.deepEqual((await empty.json()).rows,[]);assert.equal(none.poolReads(),2);
});

test('settings changes, withdrawal, edited text or reference versions invalidate the whole result after inference',async()=>{
 for(const finalPool of [p=>({...p,version:p.version+1}),p=>({...p,settings:{...p.settings,maxResults:1}}),p=>({...p,settings:{...p.settings,mode:'bank'}}),p=>({...p,approvedCount:p.approvedCount-1,rows:p.rows.slice(1)}),p=>({...p,rows:p.rows.map((row,i)=>i===0?{...row,source:{...row.source,version:'edition1.r2'}}:row)}),p=>({...p,rows:p.rows.map((row,i)=>i===0?{...row,english:'Changed without a version'}:row)})]){
  const f=fixture({finalPool}),r=await f.run();assert.equal(r.status,409);assert.equal((await r.json()).rows,undefined);assert.equal(providerCalls(f).length,1);
 }
 const revoked=fixture({finalResponse:()=>json({message:'raw private SQL'},403)}),r=await revoked.run();assert.equal(r.status,409);assert.equal((await r.json()).code,'AI_CONTEXT_CHANGED');
});

test('a reordered revalidated pool still maps scores to the original index, strips unsafe extras, and preserves exact text',async()=>{
 const f=fixture({rows:[example(1,{token:'secret',preview:'https://evil.test',source:{...example(1).source,token:'secret'}}),example(2),example(3)],finalPool:p=>({...p,rows:p.rows.slice().reverse()})}),r=await f.run(),body=await r.json();assert.equal(r.status,200);assert.equal(body.rows[0].id,example(1).id);assert.equal(body.rows[0].english,example(1).english);assert.equal(JSON.stringify(body).includes('secret'),false);assert.equal(JSON.stringify(body).includes('evil.test'),false);
});

test('provider failures and 429 are sanitized, preserve Retry-After and never trigger another request or bank fallback',async()=>{
 for(const status of [401,403,500]){const f=fixture({cf:()=>json({error:'secret token and prompts'},status)}),r=await f.run(),body=await r.json();assert.equal(r.status,503);assert.equal(JSON.stringify(body).includes('secret'),false);assert.equal(providerCalls(f).length,1);assert.equal(f.poolReads(),1)}
 const f=fixture({cf:()=>json({error:'private'},429,{'Retry-After':'91'})}),r=await f.run();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'91');assert.equal((await r.json()).code,'AI_ENGINE_LIMIT');assert.equal(providerCalls(f).length,1);
});

test('closing/canceling while provider work is pending drops late rows and never revalidates or sends anything',async()=>{
 const pending=deferred(),started=deferred(),f=fixture({cf:()=>{started.resolve();return pending.promise}}),controller=new AbortController(),result=f.run({}, {signal:controller.signal});
 await started.promise;controller.abort();pending.resolve(json(cfResult([{id:0,score:1}])));const r=await result;assert.equal(r.status,499);assert.equal((await r.json()).rows,undefined);assert.equal(providerCalls(f)[0].input.signal.aborted,true);assert.equal(f.poolReads(),1);
});

test('a bounded overall timeout aborts provider work without automatic retry or exposing cached answers',async()=>{
 const started=deferred(),keepAlive=setTimeout(()=>{},100),f=fixture({config:{timeoutMs:5},cf:({signal})=>new Promise((_resolve,reject)=>{started.resolve();signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})});
 try{const result=f.run();await started.promise;const r=await result;assert.equal(r.status,504);assert.equal((await r.json()).code,'AI_TIMEOUT');assert.equal(providerCalls(f).length,1);assert.equal(f.poolReads(),1)}finally{clearTimeout(keepAlive)}
});
