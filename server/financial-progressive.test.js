import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await(async()=>{const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8');return(await import('data:text/javascript;base64,'+Buffer.from(code.slice(0,code.lastIndexOf('Deno.serve('))).toString('base64'))).createLiveHandler})():sourceHandler;
const w='00000000-0000-0000-0000-000000000001',c='20000000-0000-0000-0000-000000000001';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
const categories=['total','messages','tips','subscriptions','posts','streams','referrals'];
function fixture({denied=false,revoke=false,limited=false,quota=false,operation='earnings',wrongFilter=false}={}){
 const calls=[];let authorizations=0;
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'fixture-secret',serviceKey:quota?'service-fixture':undefined,onFailure:()=>{},fetcher:async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:'actor',email_confirmed_at:'yes'});
  if(url.includes('bruff_live_authorize')){assert.deepEqual(JSON.parse(options.body),{w,c,p:'analytics'});return denied||revoke&&++authorizations===2?json({},403):json('acct_current')}
  if(url.includes('bruff_provider_read_gate'))return json(JSON.parse(options.body).op==='block'?{allowed:false,retryAfter:11}:{allowed:true});
  const endpoint=new URL(url);calls.push({url:endpoint,options});assert.equal(endpoint.pathname.split('/')[3],'acct_current');
  const headers=quota?{'x-ratelimit-limit':'60','x-ratelimit-remaining':'20','x-ratelimit-reset':'1900000000','x-ratelimit-window':'60',...(limited?{'Retry-After':'11'}:{})}:{};
  if(limited)return json({},429,headers);
  if(operation==='monthly')return json({months:[{month:'2026-10',gross:10,net:8}]},200,headers);
  if(operation==='balances')return json({currentBalance:8},200,headers);
  if(operation==='transactions')return json({transactions:[]},200,headers);
  const category=endpoint.searchParams.get('filter')||'total';
  return json({filter:wrongFilter?'wrong':category,series:{[category]:{gross:category==='total'?50:25,total:category==='total'?40:20,raw:{secret:'private'}}}},200,headers);
 }});
 return {calls,request:extra=>handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,operation,start:'2026-10-01',end:'2026-10-31',...extra})}))};
}
test('each explicit financial category performs one model-bound GET and total is independent',async()=>{
 for(const category of categories){const f=fixture(),response=await f.request({category});assert.equal(response.status,200);const body=await response.json();assert.equal(f.calls.length,1);assert.deepEqual(Object.keys(body.data.series),[category]);assert.equal(body.data.series[category].total,category==='total'?40:20);assert.equal(f.calls[0].url.searchParams.get('filter'),category==='total'?null:category);assert.equal(f.calls[0].options.method,undefined);assert.equal(JSON.stringify(body).includes('private'),false)}
});
test('legacy financial clients retain the seven-read contract',async()=>{const f=fixture(),response=await f.request({});assert.equal(response.status,200);assert.equal(f.calls.length,7);assert.deepEqual(Object.keys((await response.json()).data.series),categories)});
test('invalid financial categories cannot reach the provider',async()=>{for(const category of ['../other','',123,{},['messages']]){const f=fixture();assert.equal((await f.request({category})).status,400);assert.equal(f.calls.length,0)}});
test('financial categories retain authorization and final revocation checks',async()=>{const denied=fixture({denied:true});assert.equal((await denied.request({category:'messages'})).status,403);assert.equal(denied.calls.length,0);const revoked=fixture({revoke:true}),response=await revoked.request({category:'messages'});assert.equal(response.status,403);assert.equal(revoked.calls.length,1);assert.equal((await response.text()).includes('series'),false)});
test('an explicit category rejects a mismatched upstream filter without fabricating totals',async()=>{const f=fixture({wrongFilter:true}),response=await f.request({category:'messages'});assert.equal(response.status,503);assert.equal(f.calls.length,1);assert.equal((await response.text()).includes('series'),false)});
test('all financial operations expose observed read budget to the shared client scheduler',async()=>{for(const operation of ['earnings','monthly','balances','transactions']){const f=fixture({quota:true,operation}),response=await f.request(operation==='earnings'?{category:'total'}:{});assert.equal(response.status,200);assert.deepEqual((await response.json()).readQuota,{limit:60,remaining:20,reset:1900000000,window:60});assert.equal(f.calls.length,1)}});
test('limited category reads preserve Retry-After and quota rather than silently omitting the category',async()=>{const f=fixture({quota:true,limited:true}),response=await f.request({category:'tips'});assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'11');const body=await response.json();assert.equal(body.retryAfter,11);assert.equal(body.readQuota.remaining,20);assert.equal(body.data,undefined);assert.equal(f.calls.length,1)});
