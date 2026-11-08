import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGenerationContext,buildPrompt,generationContextHash,PROMPT_BYTES,validatedPool} from '../supabase/functions/bruff-drafts/generation.js';
import {createDraftsHandler} from '../supabase/functions/bruff-drafts/handler.js';

const actor='11111111-1111-4111-8111-111111111111',w='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const id=i=>'50000000-0000-4000-8000-'+String(i).padStart(12,'0');
const item=(i,kind,text,key=null)=>({id:id(i),version:1,kind,key,text,state:'verified',referenceId:'fixture.'+i,sourceVersion:'v1'});
const history=[{id:'10',text:'How is your day?',isFromMe:false,createdAt:'2026-11-08T00:00:00Z'}];
const pool=knowledge=>validatedPool({actorId:actor,workspaceId:w,creatorId:c,settings:{enabled:true,dailyLimit:100,maxResults:3},version:1,revision:'a'.repeat(32),approvedCount:1,examples:[{id:id(100),version:1,trigger:'How is your day?',english:'hey!! how are you?',spanish:'¡Hola! ¿Cómo estás?',referenceId:'fixture.example',sourceVersion:'v1'}],knowledge},{actor,w,c});
const data=prompt=>JSON.parse(prompt.messages[1].content).data;
const size=prompt=>new TextEncoder().encode(JSON.stringify(prompt.messages)).length;
const facts=()=>['public_name','age','country','city','language','about'].map((key,i)=>item(i+1,'model_fact','Fictional approved fact: '+key,key));

test('the twelve-entry cap retains every boundary and tone before optional facts or styles',()=>{
 const knowledge=[...facts(),...Array.from({length:6},(_,i)=>item(i+7,'style_rule','Use concise neutral wording.')),item(13,'boundary','Respect the owner-reviewed conversational boundary.')];
 const input=pool(knowledge),before=structuredClone(input),prompt=buildPrompt(input,history),sent=data(prompt).approvedKnowledge;
 assert.equal(sent.length,12);assert.equal(sent[0].kind,'boundary');assert.equal(sent[0].text,knowledge[12].text);
 assert.ok(sent.some(k=>k.kind==='style_rule'));assert.equal(prompt.knowledgeMap.get(sent[0].id).id,knowledge[12].id);
 assert.deepEqual(input,before);assert.deepEqual(buildPrompt(pool([...knowledge].reverse()),history).messages,prompt.messages);
 assert.ok(size(prompt)<=PROMPT_BYTES);
});

test('byte-budget reduction drops optional knowledge while preserving boundaries and an approved tone',()=>{
 const knowledge=[...Array.from({length:11},(_,i)=>item(i+1,'style_rule','Use concise approved neutral wording. '.repeat(30))),item(12,'boundary','Respect the owner-reviewed conversational boundary.')];
 const prompt=buildPrompt(pool(knowledge),history),sent=data(prompt).approvedKnowledge;
 assert.ok(sent.length<knowledge.length);assert.equal(sent.filter(k=>k.kind==='boundary').length,1);
 assert.equal(sent[0].text,knowledge[11].text);assert.ok(sent.some(k=>k.kind==='style_rule'));assert.ok(size(prompt)<=PROMPT_BYTES);
 for(const k of sent)assert.equal(prompt.knowledgeMap.get(k.id).text,k.text);
 assert.equal(data(prompt).conversation[data(prompt).replyTargetIndex].text,history[0].text);
});

test('a shorter approved tone survives when the UUID-first long style would displace it',()=>{
 const boundaries=Array.from({length:11},(_,i)=>item(i+1,'boundary','Respect this reviewed boundary.'));
 const long=item(12,'style_rule','Use concise approved neutral wording. '.repeat(30)),short=item(13,'style_rule','Be brief.');
 const prompt=buildPrompt(pool([...boundaries,long,short]),history),sent=data(prompt).approvedKnowledge;
 assert.equal(sent.length,12);assert.equal(sent.filter(k=>k.kind==='boundary').length,11);
 assert.deepEqual(sent.filter(k=>k.kind==='style_rule').map(k=>k.text),[short.text]);
 assert.equal(prompt.knowledgeMap.get(sent[11].id).id,short.id);
});

test('twelve mandatory boundaries consume the cap instead of silently dropping a boundary for tone',()=>{
 const boundaries=Array.from({length:12},(_,i)=>item(i+1,'boundary','Respect this reviewed boundary.'));
 const sent=data(buildPrompt(pool([...boundaries,item(13,'style_rule','Be brief.')]),history)).approvedKnowledge;
 assert.equal(sent.length,12);assert.ok(sent.every(k=>k.kind==='boundary'));
 assert.deepEqual(sent.map(k=>k.text),boundaries.map(k=>k.text));
});

async function rejectedBeforeInference(knowledge){
 const calls=[],snapshot=pool(knowledge),json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 const handler=createDraftsHandler({url:'https://auth.test',anonKey:'fixture-public',serviceKey:'fixture-service',cloudflareAccountId:'b'.repeat(32),cloudflareToken:'fixture-token',freeTierConfirmed:true,fetcher:async url=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/user'))return json({id:actor,email_confirmed_at:'2026-11-01T00:00:00Z'});
  if(url.endsWith('/bruff_generation_pool'))return json(snapshot);
  if(url.endsWith('/functions/v1/bruff-live'))return json({data:{messages:history}});
  throw Error('No reservation, provider or write is permitted in this fixture.');
 }});
 const response=await handler(new Request('https://edge.test/functions/v1/bruff-drafts',{method:'POST',headers:{Authorization:'Bearer fixture-user','Content-Type':'application/json'},body:JSON.stringify({operation:'generate',workspace_id:w,creator_id:c,conversation_id:'123',request_id:requestId})}));
 assert.equal(response.status,413);assert.equal((await response.json()).code,'AI_CONTEXT_LIMIT');
 assert.equal(calls.length,3);assert.ok(calls.every(url=>url.startsWith('https://auth.test/')));
 assert.ok(!calls.some(url=>/claim|commit|usage|cloudflare|send/iu.test(url)));
}

test('too many mandatory boundaries fail before a reservation or provider request',async()=>{
 await rejectedBeforeInference(Array.from({length:13},(_,i)=>item(i+1,'boundary','Respect this reviewed boundary.')));
});

test('mandatory boundaries exceeding the byte budget fail before a reservation or provider request',async()=>{
 await rejectedBeforeInference(Array.from({length:12},(_,i)=>item(i+1,'boundary','Respect this reviewed boundary. '.repeat(35))));
});

test('the knowledge-selection policy changes the semantic context hash without changing sources or history',async()=>{
 const current=buildGenerationContext(history);
 assert.equal(current.protocol,'bruff-generation-context-v8');
 assert.notEqual(await generationContextHash(current),await generationContextHash({...current,protocol:'bruff-generation-context-v7'}));
});
