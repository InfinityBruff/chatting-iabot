import test from 'node:test';
import assert from 'node:assert/strict';
import {createBruffControlHandler} from '../supabase/functions/bruff-control/handler.js';
const actor='10000000-0000-4000-8000-000000000001',w='20000000-0000-4000-8000-000000000001',c='30000000-0000-4000-8000-000000000001';
const base='https://fixture.supabase.co',at='2026-11-08T00:00:00.000Z',privateText='Fictional neutral conversation';
const operations=[['bruff_list_conversations',{cursor:'next-inbox'},'inbox'],['bruff_read_conversation',{fan_id:'77',cursor:'next-history'},'messages']];
function pause(ms,signal,onAbort){
 return new Promise((resolve,reject)=>{let timer;const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);onAbort?.();reject(signal.reason)};signal.throwIfAborted();signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms)});
}
function fixture(options={}){
 const calls=[],state={aborts:0,revoked:false};let began;const started=new Promise(resolve=>{began=resolve});
 const handler=createBruffControlHandler({url:base,anonKey:'public-fixture',ownerActionsEnabled:true,timeoutMs:options.timeoutMs??40,draftsTimeoutMs:options.draftsTimeoutMs??500,fetcher:async(url,init)=>{
  const path=url.slice(base.length),body=init.body?JSON.parse(init.body):null;calls.push({path,body});assert.equal(init.headers.Authorization,'Bearer fixture-owner');assert.equal(init.redirect,'error');
  if(path==='/auth/v1/user'){if(options.authDelay)await pause(options.authDelay,init.signal,()=>state.aborts++);return Response.json({id:actor,email_confirmed_at:at,is_anonymous:false})}
  if(path==='/rest/v1/rpc/bruff_ai_models')return state.revoked?Response.json({code:'42501'},{status:403}):Response.json({actorId:actor,workspaces:[{id:w,name:'Fixture',models:[{id:c,name:'Fixture model'}]}]});
  assert.equal(path,'/functions/v1/bruff-live');began();await pause(options.delay??70,init.signal,()=>state.aborts++);
  if(options.status)return Response.json({error:'private provider diagnostics'},{status:options.status,headers:{'Retry-After':'17'}});
  if(options.revokeAfter)state.revoked=true;
  return Response.json({actorId:actor,workspaceId:w,creatorId:c,observedAt:at,data:{cursor:null,hasMore:false,...(body.operation==='inbox'?{conversations:[{id:'77',userId:'77',name:'Fixture fan',lastMessage:privateText,lastMessageTime:at,lastMessageIsFromMe:false,unreadCount:0}]}:{messages:[{id:'900',text:privateText,isFromMe:false,createdAt:at,price:0,isTip:false,isOpened:false,mediaCount:0}]})}});
 }});
 const run=(name,args={},signal)=>handler(new Request(base+'/functions/v1/bruff-control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-owner'},signal,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{workspace_id:w,model_id:c,...args}}})}));
 return{run,calls,state,started};
}
const relayCalls=f=>f.calls.filter(call=>call.path==='/functions/v1/bruff-live');

test('list and selected conversation reads can finish beyond the general deadline using the existing bounded relay deadline',async()=>{
 for(const[name,args,operation]of operations){const f=fixture(),response=await f.run(name,args),payload=await response.json();assert.equal(response.status,200);assert.equal(payload.result.isError,false);assert.equal(payload.result.structuredContent.actorId,actor);assert.equal(payload.result.structuredContent.workspaceId,w);assert.equal(payload.result.structuredContent.modelId,c);assert.equal(f.state.aborts,0);assert.equal(f.calls.filter(call=>call.path.endsWith('/bruff_ai_models')).length,2);assert.equal(relayCalls(f).length,1);
  assert.deepEqual(relayCalls(f)[0].body,{workspace_id:w,creator_id:c,operation,background:true,...(operation==='inbox'?{fast:true}:{conversation_id:'77'}),cursor:args.cursor});
 }
});

test('the relay deadline remains finite and an abandoned or timed-out read never retries or publishes conversation data',async()=>{
 for(const[name,args]of operations){const f=fixture({timeoutMs:20,draftsTimeoutMs:45,delay:150}),payload=await(await f.run(name,args)).json();assert.equal(payload.result.isError,true);assert.equal(f.state.aborts,1);assert.equal(relayCalls(f).length,1);assert.ok(!JSON.stringify(payload).includes(privateText))}
});

test('request cancellation still aborts both kinds of provider read immediately inside the longer deadline',async()=>{
 for(const[name,args]of operations){const controller=new AbortController(),f=fixture({delay:150}),pending=f.run(name,args,controller.signal);await f.started;controller.abort();const payload=await(await pending).json();assert.equal(payload.result.isError,true);assert.equal(f.state.aborts,1);assert.equal(relayCalls(f).length,1);assert.ok(!JSON.stringify(payload).includes(privateText))}
});

test('authentication retains the short general deadline and cannot gain a long timeout by naming a chat tool',async()=>{
 for(const[name,args]of operations){const f=fixture({timeoutMs:25,authDelay:70}),response=await f.run(name,args);assert.equal(response.status,503);assert.equal(f.state.aborts,1);assert.equal(relayCalls(f).length,0);assert.equal(f.calls.filter(call=>call.path.endsWith('/bruff_ai_models')).length,0)}
});

test('delayed cooldowns preserve Retry-After without retries and delayed success still rechecks current ownership',async()=>{
 for(const[name,args]of operations){const limited=fixture({status:429}),payload=await(await limited.run(name,args)).json();assert.equal(payload.result.isError,true);assert.equal(payload.result.structuredContent.status,429);assert.equal(payload.result.structuredContent.retryAfter,17);assert.equal(relayCalls(limited).length,1);assert.ok(!JSON.stringify(payload).includes('private provider diagnostics'));
  const revoked=fixture({revokeAfter:true}),response=await revoked.run(name,args);assert.equal(response.status,403);assert.equal(relayCalls(revoked).length,1);assert.ok(!(await response.text()).includes(privateText));
 }
});
