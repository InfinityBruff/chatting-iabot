import test from 'node:test';
import assert from 'node:assert/strict';
import {generationRequestError,safeGenerationDiagnostic,generationDiagnosticError} from './chat-direct-diagnostics.js';
const failure=(status,body,headers={})=>({context:new Response(JSON.stringify(body),{status,headers})});
test('safe backend codes separate disabled, sources, configuration, context and provider limits without exposing raw messages',async()=>{
 for(const [status,code,reason] of [[409,'AI_DISABLED','disabled'],[409,'AI_SOURCES','no_sources'],[409,'AI_CONTEXT_CHANGED','context_changed'],[503,'AI_CONFIG','config'],[503,'AI_DRAFT_RESPONSE','format'],[429,'AI_LOCAL_LIMIT','local_limit'],[429,'AI_PROVIDER_LIMIT','provider_limit'],[503,'AI_HISTORY','history']]){const error=await generationRequestError(failure(status,{code,error:'secret provider and SQL details'}));assert.equal(error.diagnostic.reason,reason);assert.ok(!error.message.includes('secret'))}
});
test('response status, unrecognized codes, invalid bodies and oversized errors cannot invent a cause or leak source text',async()=>{
 for(const [status,body] of [[503,{code:'AI_DISABLED'}],[409,{code:'AI_CONFIG'}],[503,{code:'UNKNOWN',error:'raw source'}],[500,{code:'AI_CONFIG'}],[503,'private'.repeat(2000)]]){const error=await generationRequestError(failure(status,body));assert.equal(error.diagnostic.reason,'unavailable');assert.ok(!error.message.includes('raw source'));assert.ok(!error.message.includes('private'))}
 const invalid=await generationRequestError({context:new Response('not json',{status:503})});assert.equal(invalid.diagnostic.reason,'unavailable');
});
test('authorization errors take priority over a forged provider classification',async()=>{
 for(const status of [401,403])assert.equal((await generationRequestError(failure(status,{code:'AI_CONFIG'}))).diagnostic.reason,'access');
});
test('Retry-After is bounded and preserved, without retries or returning an untrusted message',async()=>{
 const error=await generationRequestError(failure(429,{code:'AI_PROVIDER_LIMIT'},{'Retry-After':'45'}));assert.deepEqual(error.diagnostic,{engine:'generative',reason:'provider_limit',retryAfter:45});
 for(const value of ['0','-1','1.5','86401','infinite'])assert.equal((await generationRequestError(failure(429,{code:'AI_PROVIDER_LIMIT'},{'Retry-After':value}))).diagnostic.retryAfter,undefined);
});
test('diagnostic data admits only known fields and leaves no mutable object reference',()=>{
 for(const value of [null,{engine:'bank',reason:'disabled'},{engine:'generative',reason:'invented'},{engine:'generative',reason:'disabled',message:'injected'},{engine:'generative',reason:'disabled',retryAfter:-1}])assert.equal(safeGenerationDiagnostic(value),null);
 const d={engine:'generative',reason:'disabled'},safe=safeGenerationDiagnostic(d);d.reason='config';assert.equal(safe.reason,'disabled');assert.equal(Object.isFrozen(safe),true);assert.equal(generationDiagnosticError('unknown').diagnostic.reason,'unavailable');
});
test('aborted response readers are cancelled and late diagnostics do not consume an unlimited stream',async()=>{
 const controller=new AbortController(),response=new Response(new ReadableStream({pull(){return new Promise(()=>{})}}),{status:503}),job=generationRequestError({context:response},controller.signal);controller.abort();const error=await job;assert.equal(error.diagnostic.reason,'unavailable');
});
test('pending generation is a bounded wait instruction, never an automatic retry or a provider inference claim',async()=>{
 const error=await generationRequestError(failure(409,{code:'AI_PENDING'},{'Retry-After':'3'}));
 assert.deepEqual(error.diagnostic,{engine:'generative',reason:'pending',retryAfter:3});assert.ok(error.message.includes('no se repetirá automáticamente'));
 assert.equal((await generationRequestError(failure(503,{code:'AI_PENDING'}))).diagnostic.reason,'unavailable');
});
