import {test} from 'node:test';import assert from 'node:assert/strict';
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002';
test('failure diagnostics contain only operation, allowlisted kind and upstream status, never private payloads',async()=>{
 for(const mode of ['provider','schema','private','reference','input']){
  const reports=[];let reads=0;
  const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'SECRET_KEY',onFailure:r=>reports.push(r),fetcher:async(url,o)=>{
   const json=x=>new Response(JSON.stringify(x));
   if(url.endsWith('/auth/v1/user'))return json({id:'PRIVATE_USER',email_confirmed_at:'yes'});
   if(url.includes('bruff_my_workspaces'))return json([{id:w,role:'owner'}]);
   if(url.includes('bruff_live_authorize'))return json('acct_PRIVATE');
   assert.equal(o.method,'GET');reads++;
   if(mode==='provider')return new Response('PRIVATE_UPSTREAM_BODY',{status:402});
   if(mode==='private')throw Error('PRIVATE_MESSAGE SECRET_KEY');
   if(mode==='reference')throw new ReferenceError('PRIVATE_VARIABLE');
   return json({unexpected:'PRIVATE_DATA'});
  }});
  const res=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer SECRET_SESSION','Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,operation:'notifications',...(mode==='input'?{type:'PRIVATE_BAD_TYPE'}:{})})}));
  assert.equal(res.status,mode==='input'?400:503);if(mode==='input'){assert.equal(reports.length,0);assert.equal(reads,0);continue}assert.equal(reports.length,1);
  assert.deepEqual(reports[0],{event:'bruff_live_failure',operation:'notifications',kind:{provider:'provider',schema:'schema',private:'unexpected',reference:'ReferenceError',input:'input'}[mode],...(mode==='provider'?{providerStatus:402}:{})});
  assert.ok(!JSON.stringify(reports).includes('PRIVATE'));assert.ok(!JSON.stringify(reports).includes('SECRET'));if(mode==='input')assert.equal(reads,0);
 }
});
test('diagnostic sink failures do not change or suppress the actual HTTP failure',async()=>{
 const handler=createLiveHandler({onFailure:()=>{throw Error('sink')}});
 const response=await handler(new Request('https://bruff.test',{method:'POST'}));assert.equal(response.status,503);
});
