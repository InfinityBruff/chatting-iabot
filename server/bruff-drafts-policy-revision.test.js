import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftsHandler} from '../supabase/functions/bruff-drafts/handler.js';
import {buildGenerationContext,generationContextHash,historyHash,historySnapshot} from '../supabase/functions/bruff-drafts/generation.js';
import {ENGINE_VERSION,reservedUsage} from '../supabase/functions/bruff-drafts/usage.js';

const actor='11111111-1111-4111-8111-111111111111';
const workspace='22222222-2222-4222-8222-222222222222';
const creator='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const example='55555555-5555-4555-8555-555555555555';
const generationId='77777777-7777-4777-8777-777777777777';
const revision='a'.repeat(32);
const messages=[{id:'10',text:'I went hiking this morning.',isFromMe:false,createdAt:'2026-11-08T09:00:00.000Z'}];
const history=()=>historySnapshot({data:{messages}});
const currentContext=()=>buildGenerationContext(history());
// Reproduce released fingerprints rather than asking the current builder to
// label an old result. The SQL engine version deliberately remains unchanged.
const previousProtocols=['bruff-generation-context-v3','bruff-generation-context-v4'];
const oldContextHash=protocol=>historyHash({protocol,history:history(),memory:null});
const pool=()=>({actorId:actor,workspaceId:workspace,creatorId:creator,revision,version:1,settings:{enabled:true,dailyLimit:100,maxResults:3},approvedCount:1,examples:[{id:example,version:1,trigger:'What did you do today?',english:'how was your morning?',spanish:'¿Cómo fue tu mañana?',referenceId:'fictional.neutral.example',label:'Fictional reviewed example',sourceVersion:'v1'}],knowledge:[]});

async function fixture({protocol=null}={}){
  const calls=[];
  const legacy=protocol!==null,oldBiography=protocol===previousProtocols[0];
  const hash=legacy?await oldContextHash(protocol):await generationContextHash(currentContext());
  const record={generationId,actorId:actor,workspaceId:workspace,creatorId:creator,fanId:'123',revision,contextHash:hash,expiresAt:new Date(Date.now()+600000).toISOString(),drafts:[{id:'1',english:oldBiography?'i spent my morning hiking too.':legacy?'just here chatting with you, how was your day?':'how was your hike?',spanish:oldBiography?'Yo también pasé la mañana haciendo senderismo.':legacy?'Aquí charlando contigo, ¿cómo fue tu día?':'¿Cómo fue tu caminata?',exampleIds:[example],knowledgeIds:[]}],unknowns:[],aiGenerated:true,aiVerified:false,engineVersion:ENGINE_VERSION,usage:reservedUsage()};
  const handler=createDraftsHandler({url:'https://fixture.test',anonKey:'fixture-public',serviceKey:'fixture-service',cloudflareAccountId:'b'.repeat(32),cloudflareToken:'fixture-provider-token',freeTierConfirmed:true,fetcher:async(url,init)=>{
    const body=init.body?JSON.parse(init.body):null;
    calls.push({url,body});
    assert.equal(init.headers.Authorization,'Bearer fixture-user');
    assert.equal(init.headers.apikey,'fixture-public');
    assert.equal(init.redirect,'error');
    if(url==='https://fixture.test/auth/v1/user')return Response.json({id:actor,email_confirmed_at:'2026-11-01T00:00:00Z'});
    if(url==='https://fixture.test/rest/v1/rpc/bruff_generation_pool')return Response.json(pool());
    if(url==='https://fixture.test/functions/v1/bruff-live'){
      assert.deepEqual(body,{workspace_id:workspace,creator_id:creator,operation:'messages',conversation_id:'123',background:true});
      return Response.json({data:{messages}});
    }
    if(url==='https://fixture.test/rest/v1/rpc/bruff_generation_claim_v2')return Response.json({actorId:actor,workspaceId:workspace,creatorId:creator,allowed:false,reason:'cached',cached:record});
    if(url==='https://fixture.test/rest/v1/rpc/bruff_generation_result')return Response.json(record);
    if(url==='https://fixture.test/rest/v1/rpc/bruff_generation_quota'){
      const usageDay=new Date().toISOString().slice(0,10);
      return Response.json({actorId:actor,workspaceId:workspace,creatorId:creator,quota:{usageDay,resetsAt:new Date(Date.parse(usageDay+'T00:00:00Z')+86400000).toISOString(),modelQueries:1,modelDailyLimit:100,sharedBudgetNeurons:7500,calculatedNeurons:0,reservedNeurons:600,chargedNeurons:600,remainingNeurons:6900,observedRequests:0,reservedRequests:1}});
    }
    throw Error('Unexpected route: policy-revision tests never invoke an AI or write endpoint.');
  }});
  const run=operation=>handler(new Request('https://fixture.test/functions/v1/bruff-drafts',{method:'POST',headers:{Authorization:'Bearer fixture-user','Content-Type':'application/json'},body:JSON.stringify({operation,workspace_id:workspace,creator_id:creator,conversation_id:'123',request_id:operation==='verify'?generationId:requestId})}));
  return{calls,run,record};
}

function assertNoInferenceOrWrites(calls){
  assert.ok(calls.every(call=>call.url.startsWith('https://fixture.test/')));
  assert.ok(calls.every(call=>!/(?:bruff_generation_(?:usage|commit)|prepare_send|\/send|cloudflare)/u.test(call.url)));
}

test('the v5 policy changes v3 and v4 fingerprints even with identical history, sources and engine',async()=>{
  const context=currentContext();
  assert.equal(context.protocol,'bruff-generation-context-v5');
  assert.equal(ENGINE_VERSION,'bruff-drafts-v3');
  for(const protocol of previousProtocols)assert.notEqual(await generationContextHash(context),await oldContextHash(protocol));
});

for(const protocol of previousProtocols){
test(`a stale ${protocol} result is rejected even if the cache RPC returns it for a v5 claim`,async()=>{
  const f=await fixture({protocol}),response=await f.run('generate'),body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.code,'AI_CONTEXT_CHANGED');
  assert.equal(body.drafts,undefined);
  const claims=f.calls.filter(call=>call.url.endsWith('/bruff_generation_claim_v2'));
  assert.equal(claims.length,1);
  assert.equal(claims[0].body.engine_version,f.record.engineVersion);
  assert.equal(claims[0].body.context_hash,await generationContextHash(currentContext()));
  assert.notEqual(claims[0].body.context_hash,f.record.contextHash);
  assertNoInferenceOrWrites(f.calls);
});

test(`verification cannot certify an existing ${protocol} draft under v5 or trigger generation`,async()=>{
  const f=await fixture({protocol}),response=await f.run('verify'),body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.code,'AI_CONTEXT_CHANGED');
  assert.equal(body.drafts,undefined);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/bruff_generation_result')).length,1);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/bruff_generation_claim_v2')).length,0);
  assertNoInferenceOrWrites(f.calls);
});
}

test('a current v5 canonical cache entry still reuses and verifies without inference or accounting writes',async()=>{
  const f=await fixture(),generated=await f.run('generate'),reused=await generated.json();
  assert.equal(generated.status,200);
  assert.equal(reused.generationId,generationId);
  assert.equal(reused.requestId,requestId);
  assert.equal(reused.reused,true);
  assert.equal(reused.engineInvoked,false);
  assert.equal(reused.contextHash,await generationContextHash(currentContext()));
  const verified=await f.run('verify'),checked=await verified.json();
  assert.equal(verified.status,200);
  assert.equal(checked.generationId,generationId);
  assert.equal(checked.requestId,generationId);
  assert.equal(checked.engineInvoked,false);
  assert.equal(checked.reused,false);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/bruff_generation_claim_v2')).length,1);
  assertNoInferenceOrWrites(f.calls);
});
