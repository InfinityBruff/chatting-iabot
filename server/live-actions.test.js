import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
import {tickets,mediaView} from '../supabase/functions/bruff-live/actions.js';
const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
function setup({enabled=true,denied=false,revoke=false}={}){
 let checks=0;const calls=[];
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'private-test-key',writeEnabled:enabled,fetcher:async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response({id:'actor',email_confirmed_at:'yes'});
  if(url.includes('/rpc/')){checks++;if(denied||(revoke&&checks>1))return response({},403);return response(JSON.parse(options.body).c===other?'acct_other':'acct_one')}
  calls.push({url,options});
  if(url.includes('/vault/media'))return response({media:[{id:'42',type:'photo',canView:true,isReady:true,downloadUrl:'https://api.ofmapi.com/v1/accounts/acct_one/media/download?token=test'}]});
  if(url.endsWith('/uploads'))return response({id:'process',name:'uploaded.jpg',host:'of-host',extra:{x:1}});
  return response({id:99,createdAt:'2026-10-31T00:00:00Z'});
 }});
 const call=async extra=>{const r=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,...extra})}));return {status:r.status,body:await r.json()}};
 return {handler,call,calls};
}
test('review sends nothing; replay uses identical recipient, payload and provider key',async()=>{
 const {call,calls}=setup();const prepared=await call({operation:'prepare_send',conversation_id:'123',text:'Hello',attachments:[]});assert.equal(prepared.status,200);assert.equal(calls.length,0);
 for(let i=0;i<2;i++)assert.equal((await call({operation:'send_message',ticket:prepared.body.data.ticket})).status,200);
 assert.equal(calls.length,2);assert.equal(calls[0].url,calls[1].url);assert.match(calls[0].url,/acct_one\/conversations\/123\/messages$/);assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);assert.equal(calls[0].options.body,calls[1].options.body);
});
test('vault attachments cannot cross accounts or accept arbitrary URL references',async()=>{
 const {call,calls}=setup();const vault=await call({operation:'vault_media'});const token=vault.body.data.media[0].attachment;
 assert.equal((await call({operation:'prepare_send',creator_id:other,conversation_id:'123',text:'',attachments:[token]})).status,400);
 assert.equal((await call({operation:'prepare_send',conversation_id:'123',text:'',attachments:['https://evil.test/file']})).status,400);
 const prepared=await call({operation:'prepare_send',conversation_id:'123',text:'',attachments:[token]});assert.equal(prepared.status,200);await call({operation:'send_message',ticket:prepared.body.data.ticket});assert.deepEqual(JSON.parse(calls.at(-1).options.body).media,[42]);
});
test('review ticket cannot cross workspace, account, actor or be tampered with',async()=>{
 const {call,calls}=setup();const p=await call({operation:'prepare_send',conversation_id:'123',text:'x',attachments:[]});const ticket=p.body.data.ticket;
 for(const extra of [{creator_id:other},{workspace_id:other},{ticket:ticket.slice(0,-5)+'AAAAA'}])assert.equal((await call({operation:'send_message',ticket,...extra})).status,400);
 const a=await tickets('s','actor-a'),b=await tickets('s','actor-b');await assert.rejects(b.read(await a.sign('send',{}),'send'));assert.equal(calls.length,0);
});
test('expired and wrong-kind tickets rejected',async()=>{
 const original=Date.now;try{const t=await tickets('s','scope');const token=await t.sign('attachment',42);await assert.rejects(t.read(token,'send'));Date.now=()=>original()+3600001;await assert.rejects(t.read(token,'attachment'))}finally{Date.now=original}
});
test('disabled connector and revoked send permission never reach provider',async()=>{
 for(const options of [{enabled:false},{denied:true}]){const {call,calls}=setup(options);assert.ok((await call({operation:'prepare_send',conversation_id:'123',text:'x',attachments:[]})).status>=400);assert.equal(calls.length,0)}
 const source=setup();const p=await source.call({operation:'prepare_send',conversation_id:'123',text:'x',attachments:[]});const target=setup({revoke:true});assert.equal((await target.call({operation:'send_message',ticket:p.body.data.ticket})).status,403);assert.equal(target.calls.length,0);
});
test('media URLs restricted to the connected account; locked media never exposed',()=>{
 const x={id:1,canView:true,downloadUrl:'https://api.ofmapi.com/v1/accounts/acct_one/media/download?token=x'};assert.ok(mediaView(x,'acct_one').url);assert.equal(mediaView(x,'acct_other').url,null);assert.equal(mediaView({...x,canView:false},'acct_one').url,null);assert.equal(mediaView({...x,downloadUrl:'https://evil.test/media'},'acct_one').url,null);
});
test('multipart upload binds opaque result to this model without accepting arbitrary refs',async()=>{
 const {handler,call,calls}=setup();const form=new FormData();for(const [k,v] of Object.entries({workspace_id:w,creator_id:c,operation:'upload'}))form.set(k,v);form.set('file',new Blob(['test'],{type:'image/jpeg'}),'sample.jpg');
 const r=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer test'},body:form}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.data.name,'sample.jpg');assert.equal(JSON.stringify(result).includes('private-test-key'),false);
 const p=await call({operation:'prepare_send',conversation_id:'12',text:'',attachments:[result.data.attachment]});assert.equal(p.status,200);await call({operation:'send_message',ticket:p.body.data.ticket});assert.equal(JSON.parse(calls.at(-1).options.body).media[0].id,'process');
});
