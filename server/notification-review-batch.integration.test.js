import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
let modulePath=process.env.BRUFF_PGLITE_MODULE;if(!modulePath)try{modulePath=fileURLToPath(import.meta.resolve('@electric-sql/pglite'))}catch{}
let available=false;if(modulePath)try{await access(modulePath);available=true}catch{}
test('actual review batch SQL preserves worker/model scope, legacy peers, fresh revocation and zero idle writes',{skip:available?false:'Set BRUFF_PGLITE_MODULE to an installed PGlite module; no dependency is downloaded.',timeout:120000},async t=>{
 const {stdout,stderr}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/check-notification-batch-database.mjs',import.meta.url)),modulePath],{timeout:110000,maxBuffer:1024*1024});assert.equal(stderr,'');const result=JSON.parse(stdout.trim().split('\n').at(-1));assert.equal(result.result,'passed');assert.ok(result.checks>=40);assert.equal(result.realNetworkCalls,0);assert.equal(result.realFanSends,0);t.diagnostic(JSON.stringify(result));
});
