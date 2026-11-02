import {test} from 'node:test';import assert from 'node:assert/strict';
import {newAutoMessage} from '../src/auto-messages.js';
import {preparationPlan} from './advanced-preparation.js';
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002',d='00000000-0000-0000-0000-000000000003';
const draft=()=>{const x=newAutoMessage('mass');x.name='Fixture';x.messages[0].text='Hola';return {...x,id:d,version:1}};
test('preparation rejects unsupported switches without silently dropping them',()=>{
 assert.equal(preparationPlan(draft()).cycles,1);
 for(const k of ['resend']){const x=draft();x[k].enabled=true;assert.throws(()=>preparationPlan(x))}
 const x=draft();x.startAiOnReply=true;assert.throws(()=>preparationPlan(x));
});
test('preparation route binds verified server recipients and never sends',async()=>{
 for(const mode of ['ok','operator','unsupported','changed','incomplete']){
  let reads=0;const prepared=[];
  const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'fixture',serviceKey:'private-fixture',fetcher:async(url,o)=>{
   const json=x=>new Response(JSON.stringify(x));
   if(url.endsWith('/auth/v1/user'))return json({id:w,email_confirmed_at:'yes'});
   if(url.includes('bruff_my_workspaces'))return json([{id:w,role:mode==='operator'?'operator':'owner'}]);
   if(url.includes('bruff_live_authorize'))return json('acct_fixture');
   if(url.includes('bruff_auto_message_drafts'))return json({rows:[{...draft(),startAiOnReply:mode==='unsupported',version:mode==='changed'&&++reads>1?2:1}]});
   if(url.includes('bruff_audience_checkpoint')){const b=JSON.parse(o.body);return json(b.op==='acquire'?mode==='incomplete'?{busy:true,retryAfter:30}:{lease:'fixture',checkpoint:null}:true)}
   if(url.includes('bruff_native_mass')){prepared.push(JSON.parse(o.body));return json({id:d,state:'prepared',kind:'native'})}
   assert.equal(o.method,'GET');assert.match(url,/api.ofmapi.com/);return json({fans:[{id:123}],hasMore:false});
  }});
  const r=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({operation:'automation_prepare',workspace_id:w,creator_id:c,draft_id:d,expected_version:1})}));
  assert.equal(r.status,{ok:200,operator:403,unsupported:400,changed:409,incomplete:503}[mode],mode);
  if(mode==='ok'){assert.deepEqual(prepared[0].recipients,['123']);assert.equal(prepared[0].c,c);assert.equal((await r.json()).data.activated,false)}else assert.equal(prepared.length,0);
 }
});
test('advanced scheduler is disabled independently of manual messaging and refuses browsers',async()=>{
 const calls=[];const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'fixture',serviceKey:'private-fixture',writeEnabled:true,fetcher:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});assert.match(url,/bruff_advanced_poll$/);return new Response(JSON.stringify({ready:false,deliveries:[]}))}});
 const request=origin=>new Request('https://bruff.test',{method:'POST',headers:{'x-bruff-advanced-secret':'fixture',...(origin?{Origin:'https://bruff-workspace.pages.dev'}:{})}});
 assert.equal((await handler(request(true))).status,403);assert.equal(calls.length,0);
 const r=await handler(request(false));assert.equal(r.status,200);assert.equal(calls[0].body.can_send,false);assert.equal((await r.json()).processed,0);
});
