import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerDispatch} from '../supabase/functions/bruff-control/worker-dispatch.js';
const job='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('worker wake-up schedules only a fixed own HTTPS job and never waits for delivery',async()=>{
 const calls=[],work=[];let finish;const dispatch=createWorkerDispatch({url:'https://private.example/',serviceKey:'fake-service-key',runtime:{waitUntil:p=>work.push(p)},fetcher:(url,options)=>{calls.push({url,options});return new Promise(resolve=>{finish=()=>resolve(new Response('{"status":"sent"}'))})}});
 assert.equal(dispatch(job.toUpperCase()),undefined);assert.equal(work.length,1);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://private.example/functions/v1/bruff-ai-runner');assert.equal(calls[0].options.redirect,'error');assert.deepEqual(JSON.parse(calls[0].options.body),{job_id:job});assert.deepEqual(calls[0].options.headers,{Authorization:'Bearer fake-service-key','Content-Type':'application/json'});assert.ok(calls[0].options.signal instanceof AbortSignal);finish();await Promise.all(work);
});
test('invalid wake-up configuration or identifiers cannot fetch or become user-controlled transport',()=>{
 for(const change of [{url:'http://private.example'},{url:'https://user:pass@private.example'},{url:'https://private.example/path'},{url:'https://private.example?token=x'},{serviceKey:'key with spaces'},{runtime:{}},{serviceKey:''}]){let calls=0;const dispatch=createWorkerDispatch({url:'https://private.example',serviceKey:'fake',runtime:{waitUntil:()=>{}},fetcher:()=>{calls++;throw Error('must not fetch')},...change});assert.throws(()=>dispatch(job),/background_unavailable/u);assert.equal(calls,0)}
 for(const bad of ['https://attacker.example',job+'?x',{},null]){let calls=0;const dispatch=createWorkerDispatch({url:'https://private.example',serviceKey:'fake',runtime:{waitUntil:()=>{}},fetcher:()=>{calls++}});assert.throws(()=>dispatch(bad));assert.equal(calls,0)}
});
test('failed optional wake-up is absorbed once and does not retry or manufacture a receipt',async()=>{
 const work=[];let calls=0;const dispatch=createWorkerDispatch({url:'https://private.example',serviceKey:'fake',runtime:{waitUntil:p=>work.push(p)},fetcher:async()=>{calls++;throw Error('private detail')}});assert.equal(dispatch(job),undefined);await Promise.all(work);assert.equal(calls,1);
});
