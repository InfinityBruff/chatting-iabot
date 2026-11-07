import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
let runtime=process.env.BRUFF_PGLITE_MODULE;
if(!runtime)try{runtime=fileURLToPath(import.meta.resolve('@electric-sql/pglite'))}catch{}
let available=false;if(runtime)try{await access(runtime);available=true}catch{}

test('actual SQL044 and Edge worker agree on automatic/manual delivery, revocation, idempotency and uncertainty offline',{skip:available?false:'Set BRUFF_PGLITE_MODULE to an already installed PGlite module; no dependency is downloaded.',timeout:120000},async t=>{
 const {stdout,stderr}=await execute(process.execPath,[fileURLToPath(new URL('../scripts/check-ai-runtime.mjs',import.meta.url)),runtime],{timeout:110000,maxBuffer:1024*1024});
 assert.equal(stderr,'');const result=JSON.parse(stdout.trim().split('\n').at(-1));assert.equal(result.result,'passed');assert.equal(result.scenarios,5);assert.equal(result.realNetworkCalls,0);assert.equal(result.realFanSends,0);assert.ok(result.checks>100);assert.equal(result.fakeProviderPostAttempts,3);t.diagnostic(JSON.stringify(result));
});
