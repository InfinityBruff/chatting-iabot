import {test} from 'node:test';import assert from 'node:assert/strict';
import {sendManualMessage} from './manual-send.js';
test('one action screens before sending the exact authorized ticket',async()=>{
 const calls=[];let saved;const draft={creator_id:'model-a',text:'Hola',price:5,attachments:['asset']};
 await sendManualMessage({draft,onPrepared:p=>saved=p,request:async(op,args)=>{calls.push([op,args]);return {data:op==='prepare_send'?{ticket:'signed',price:5}:{id:1}}}});
 assert.deepEqual(calls,[['prepare_send',draft],['send_message',{creator_id:'model-a',ticket:'signed'}]]);assert.equal(saved.ticket,'signed');
});
test('screening failure never sends and uncertain retries reuse the same ticket',async()=>{
 let sent=0,pending;const draft={creator_id:'a'};
 await assert.rejects(sendManualMessage({draft,onPrepared:()=>{},request:async(op)=>{if(op==='send_message')sent++;throw Error('blocked')}}));assert.equal(sent,0);
 await assert.rejects(sendManualMessage({draft,onPrepared:p=>pending=p,request:async(op)=>{if(op==='prepare_send')return {data:{ticket:'same'}};throw Error('timeout')}}));
 const calls=[];await sendManualMessage({draft,pending,onPrepared:()=>{},request:async(op,args)=>{calls.push([op,args]);return {data:{id:1}}}});assert.deepEqual(calls,[['send_message',{creator_id:'a',ticket:'same'}]]);
});
