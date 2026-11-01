import test from 'node:test';
import assert from 'node:assert/strict';
import {fanProfile,fanHistory} from '../supabase/functions/bruff-live/fan-profile.js';
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
test('fan data is explicitly scoped and raw/private fields excluded',()=>{
 const p=fanProfile({id:123,about:'Bio',subscribedOn:false,raw:{secret:'x'},email:'private'},'123');
 assert.equal(p.about,'Bio');assert.equal(p.subscribedOn,false);assert.equal(p.isVerified,null);assert.equal(JSON.stringify(p).includes('private'),false);
 assert.throws(()=>fanProfile({id:456},'123'));
 assert.throws(()=>fanHistory({fanId:456,history:{}},'123'));
});
test('history never fabricates dates, zero amounts or renewal; unknown shapes explicit',()=>{
 const h=fanHistory({fanId:123,history:{list:[{date:'2026-01-02',price:0,type:'renew',secret:'x'},{price:null,date:'bad'}],isRenew:false}},'123');
 assert.equal(h.events.length,1);assert.equal(h.events[0].amount,0);assert.equal(h.renew,false);assert.equal(h.since,null);assert.equal(JSON.stringify(h).includes('secret'),false);
 assert.equal(fanHistory({fanId:123,history:{unknown:[]}},'123').recognized,false);
});
test('profile and history use DB-bound model and reject results after permission revocation',async()=>{
 for(const operation of ['fan_profile','fan_history'])for(const revoke of [false,true]){
 let checks=0;const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'p',providerKey:'s',fetcher:async(url,o)=>{
 if(url.endsWith('/auth/v1/user'))return json({id:'u',email_confirmed_at:'yes'});
 if(url.includes('/rpc/')){assert.equal(JSON.parse(o.body).p,'read');return json('acct_safe',revoke&&++checks===2?403:200)}
 assert.equal(url,operation==='fan_profile'?'https://api.ofmapi.com/v1/accounts/acct_safe/user/123?':'https://api.ofmapi.com/v1/accounts/acct_safe/fans/123/subscription-history?');
 return json(operation==='fan_profile'?{id:123,name:'Fan'}:{fanId:123,history:{}});
 }});
 const r=await handler(new Request('https://app.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({workspace_id:'00000000-0000-0000-0000-000000000001',creator_id:'00000000-0000-0000-0000-000000000002',operation,conversation_id:'123'})}));assert.equal(r.status,revoke?403:200);
 }
});

test('fan activity only returns this fan, bounded fields and real valid amounts',async()=>{
 const {fanActivity}=await import('../supabase/functions/bruff-live/fan-profile.js');
 const r=fanActivity({hasMore:true,cursor:'next',transactions:[{id:'a',user:{id:123},type:'tip',amount:0,createdAt:'2026-10-30',raw:{secret:'x'}},{id:'b',user:{id:456},type:'tip',amount:999,createdAt:'2026-10-30'},{id:'c',user:{id:123},amount:-5,createdAt:'2026-10-30'},{id:'d',user:{id:123},amount:10,createdAt:'2025-01-01'}]},'123','2026-10-01');
 assert.equal(r.transactions.length,2);assert.equal(r.transactions[0].amount,0);assert.equal(r.transactions[1].amount,null);assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(r.hasMore,true);
});
test('fan activity binds the model on server and rejects revoked or invalid requests',async()=>{
 for(const revoke of [false,true]){let checks=0;const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'p',providerKey:'s',fetcher:async(url,o)=>{
 if(url.endsWith('/auth/v1/user'))return json({id:'u',email_confirmed_at:'yes'});
 if(url.includes('/rpc/'))return json('acct_safe',revoke&&++checks===2?403:200);
 assert.equal(url,'https://api.ofmapi.com/v1/accounts/acct_safe/transactions?pages=1&start=2026-10-01T00%3A00%3A00Z');
 return json({hasMore:false,transactions:[{id:'a',user:{id:123},type:'tip',amount:4,createdAt:'2026-10-30'},{id:'b',user:{id:456},amount:100,createdAt:'2026-10-30'}]});
 }});
 const r=await handler(new Request('https://app.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({workspace_id:'00000000-0000-0000-0000-000000000001',creator_id:'00000000-0000-0000-0000-000000000002',operation:'fan_activity',conversation_id:'123',start:'2026-10-01'})}));assert.equal(r.status,revoke?403:200);if(!revoke)assert.equal((await r.json()).data.transactions.length,1);
 }
});
