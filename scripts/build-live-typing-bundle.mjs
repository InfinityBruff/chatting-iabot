// Update only the typing operation in a freshly verified production bundle.
// No credentials, network calls or deployment; inverse patches prove preservation.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
const [baseline,output,expected]=process.argv.slice(2),hash=s=>createHash('sha256').update(s).digest('hex');
if(!baseline||!output||!expected||resolve(baseline)===resolve(output))throw Error('Usage: build-live-typing-bundle.mjs baseline output expected-sha256');
const prior=await readFile(baseline,'utf8');if(hash(prior)!==expected)throw Error('Production baseline changed');
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {rolldown}=await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('rolldown')).href);
const dir=await mkdtemp(join(tmpdir(),'bruff-typing-module-'));let module;
try{const entry=join(dir,'entry.mjs');await writeFile(entry,`export * from ${JSON.stringify(join(root,'supabase/functions/bruff-live/typing-stream.js'))};`);const build=await rolldown({input:entry});try{module=(await build.generate({format:'iife',name:'BRUFFTyping'})).output[0].code.trimEnd()+'\n'}finally{await build.close()}}finally{await rm(dir,{recursive:true,force:true})}
let candidate=prior;const changes=[];
const patch=(label,before,after)=>{if(candidate.split(before).length!==2)throw Error('Ambiguous patch: '+label);candidate=candidate.replace(before,after);changes.push({label,before,after})};
patch('Optional injectable typing transport','advancedWriteEnabled=false,fetcher=fetch,','advancedWriteEnabled=false,typingConnect,fetcher=fetch,');
patch('Explicit typing operation',"'native_cancel','accounts',","'native_cancel','typing_stream','accounts',");
patch('Transient typing authorization outage',"throw Error(['accounts','inbox','messages'].includes(input.operation)","throw Error(['accounts','inbox','messages','typing_stream'].includes(input.operation)");
const source=await readFile(join(root,'supabase/functions/bruff-live/handler.js'),'utf8'),a=source.indexOf("   if(input.operation==='typing_stream'){"),b=source.indexOf('   firstMessageRead=',a);
if(a<0||b<a)throw Error('Missing reviewed typing branch');
patch('Authorized scope-limited SSE relay','   firstMessageRead=',source.slice(a,b).replace('createTypingResponse(','BRUFFTyping.createTypingResponse(')+'   firstMessageRead=');
let restored=candidate;for(const change of [...changes].reverse()){if(restored.split(change.after).length!==2)throw Error('Ambiguous inverse: '+change.label);restored=restored.replace(change.after,change.before)}
if(restored!==prior)throw Error('Unaccounted production changes');
const tail=s=>s.slice(s.lastIndexOf('Deno.serve('));if(tail(candidate)!==tail(prior))throw Error('Serve settings changed');
if(!candidate.includes("if(request.headers.has('x-bruff-automation-secret'))return reply(403,{error:'Ejecutor anterior deshabilitado'});"))throw Error('Legacy worker protection missing');
candidate=module+candidate;await writeFile(output,candidate);
await writeFile(output+'.manifest.json',JSON.stringify({baselineSha256:hash(prior),sha256:hash(candidate),bytes:Buffer.byteLength(candidate),patches:changes.map(x=>x.label),inverseRestoresBaseline:true,serveTailUnchanged:true,legacyWorkerDisabled:true,productionActions:false},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(candidate),bytes:Buffer.byteLength(candidate),inverseRestoresBaseline:true}));
