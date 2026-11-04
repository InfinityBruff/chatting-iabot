import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {startupReadError} from './startup-read-error.js';import {secondaryReads,foregroundReads} from './live-read-scheduler.js';
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
// Exercise the real transport adapter without importing the JSX UI or a real
// auth client. The function body is read directly; error conversion is not copied.
const source=await readFile(new URL('./components/LiveData.jsx',import.meta.url),'utf8'),start=source.indexOf('async function invokeLive('),end=source.indexOf('\nexport function More',start);
assert.ok(start>=0&&end>start);
const adapter=invoke=>new Function('authClient','startupReadError','liveReads','secondaryReads','foregroundReads',"let quotaLogKey='';return ("+source.slice(start,end)+');')({functions:{invoke}},startupReadError,{block:()=>{},observeQuota:()=>{}},secondaryReads,foregroundReads);
test('a real mocked handler HTTP error retains provider cursor status through invokeLive',async()=>{
 const w='00000000-0000-0000-0000-000000000001',c='20000000-0000-0000-0000-000000000001',json=(value,status=200)=>new Response(JSON.stringify(value),{status});
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public-fixture',providerKey:'provider-fixture',onFailure:()=>{},fetcher:async url=>url.endsWith('/auth/v1/user')?json({id:'actor',email_confirmed_at:'yes'}):url.includes('bruff_live_authorize')?json('acct_fixture'):json({},422)});
 const invoke=adapter(async(_name,{body})=>{const response=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal(response.status,502);return {data:null,error:{context:response}}});
 await assert.rejects(invoke(w,'fan_activity',{creator_id:c,conversation_id:'123',start:'2026-10-01',cursor:'expired'}),error=>error.status===502&&error.providerStatus===422);
});
test('provider status forwarding accepts only integer HTTP error statuses',async()=>{
 for(const providerStatus of [400,422,499,500,599]){const invoke=adapter(async()=>({data:null,error:{context:new Response(JSON.stringify({error:'fixture',providerStatus}),{status:502})}}));await assert.rejects(invoke('w','fan_activity',{}),error=>error.providerStatus===providerStatus&&error.status===502)}
 for(const providerStatus of [undefined,null,'422',399,600,422.5,true,[],{}]){const invoke=adapter(async()=>({data:null,error:{context:new Response(JSON.stringify({error:'fixture',providerStatus}),{status:502})}}));await assert.rejects(invoke('w','fan_activity',{}),error=>!Object.hasOwn(error,'providerStatus')&&error.status===502)}
});
