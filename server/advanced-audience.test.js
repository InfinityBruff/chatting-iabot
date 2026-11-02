import {test} from 'node:test';import assert from 'node:assert/strict';
import {resolveMassAudience} from '../supabase/functions/bruff-live/advanced-audience.js';
const config={trigger:'mass',bulk:{audience:'all'},audience:{excludeLists:[]}};
function setup(pages){let i=0;const calls=[];return {calls,args:{config:structuredClone(config),binding:'acct_fixture',authorize:async()=> 'acct_fixture',providerKey:'fake',fetcher:async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');return {ok:true,json:async()=>pages[i++]}}}}}
test('full paginated audience deduplicates, applies exclusions and never writes',async()=>{const f=setup([{fans:[{id:1},{id:2}],hasMore:true,cursor:'next'},{fans:[{id:2},{id:3}],hasMore:false},{id:'x',usersCount:1,users:[{id:2}]}]);f.args.config.audience.excludeLists=['x'];const r=await resolveMassAudience(f.args);assert.deepEqual(r.recipientIds,['1','3']);assert.equal(r.excludedCount,1);assert.equal(r.complete,true);assert.equal(f.calls.length,3)});
test('collections union removes duplicates and exclusions win',async()=>{const f=setup([{id:'a',usersCount:2,users:[{id:1},{id:2}]},{id:'b',usersCount:2,users:[{id:2},{id:3}]}]);f.args.config.bulk={audience:'collections',listIds:['a','b']};f.args.config.audience.excludeLists=['a'];assert.deepEqual((await resolveMassAudience(f.args)).recipientIds,['3']);assert.equal(f.calls.length,2)});
test('partial collections, missing cursors and provider failures never yield partial audience',async()=>{
 const f=setup([{id:'a',usersCount:2,users:[{id:1}]}]);f.args.config.bulk={audience:'collections',listIds:['a']};await assert.rejects(resolveMassAudience(f.args),/incompleta/);
 await assert.rejects(resolveMassAudience(setup([{fans:[{id:1}],hasMore:true}]).args),/paginación/);
 const bad=setup([]);bad.args.fetcher=async()=>({ok:false,status:429});await assert.rejects(resolveMassAudience(bad.args),/limita/);
});
test('repeated cursors and resource limits fail instead of truncating',async()=>{
 await assert.rejects(resolveMassAudience(setup([{fans:[],hasMore:true,cursor:'a'},{fans:[],hasMore:true,cursor:'a'}]).args),/paginación/);
 await assert.rejects(resolveMassAudience({...setup([{fans:[],hasMore:true,cursor:'a'}]).args,maxPages:1}),/directorio/);
 await assert.rejects(resolveMassAudience({...setup([{fans:[{id:1},{id:2}],hasMore:false}]).args,maxFans:1}),/lotes/);
});
test('selected fans must belong to the verified account directory',async()=>{for(const recipients of [['1'],['2']]){const f=setup([{fans:[{id:1}],hasMore:false}]);f.args.config.bulk={audience:'selected',recipients};if(recipients[0]==='1')assert.deepEqual((await resolveMassAudience(f.args)).recipientIds,['1']);else await assert.rejects(resolveMassAudience(f.args),/verificar/)} });
test('revoked access or changed binding stops provider results',async()=>{const f=setup([{fans:[],hasMore:false}]);let n=0;f.args.authorize=async()=>++n===1?'acct_fixture':'acct_other';await assert.rejects(resolveMassAudience(f.args),/Acceso/);assert.equal(f.calls.length,1)});
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002',d='00000000-0000-0000-0000-000000000003';
test('authenticated audience route uses stored draft, current version and send permission without writes',async()=>{
 for(const mode of ['valid','operator','changed','filtered']){
  let reads=0,providerReads=0;
  const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'fake',fetcher:async(url,o)=>{
   const json=x=>new Response(JSON.stringify(x),{status:200});
   if(url.endsWith('/auth/v1/user'))return json({id:'fixture-owner',email_confirmed_at:'yes'});
   if(url.includes('bruff_my_workspaces'))return json([{id:w,role:mode==='operator'?'operator':'owner'}]);
   if(url.includes('bruff_live_authorize')){const body=JSON.parse(o.body);assert.equal(body.w,w);assert.equal(body.c,c);assert.equal(body.p,'send');return json('acct_fixture')}
   if(url.includes('bruff_auto_message_drafts'))return json({rows:[{...config,id:d,version:mode==='changed'&&++reads>1?2:1,archived:false,audience:{excludeLists:[],modelSpend:{enabled:mode==='filtered'}}}]});
   assert.equal(o.method,'GET');providerReads++;return json({fans:[{id:1}],hasMore:false});
  }});
  const response=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({operation:'automation_audience',workspace_id:w,creator_id:c,draft_id:d,expected_version:1})}));
  assert.equal(response.status,{valid:200,operator:403,changed:409,filtered:400}[mode]);
  if(mode==='valid'){const result=await response.json();assert.deepEqual(result.data.recipientIds,['1']);assert.equal(result.data.activated,false)}
  if(['operator','filtered'].includes(mode))assert.equal(providerReads,0);
 }
});
