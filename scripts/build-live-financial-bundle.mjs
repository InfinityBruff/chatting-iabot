// Preserve deployed chat/vault helpers while replacing only the mass feature modules.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const [baseline,output]=process.argv.slice(2);
if(!baseline||!output||resolve(baseline)===resolve(output))throw Error('Usage: node scripts/build-live-financial-bundle.mjs <baseline> <new-output>');
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {rolldown}=await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('rolldown')).href);
const prior=await readFile(baseline,'utf8');
const marker="const encode=value=>btoa(";
const start=prior.indexOf(marker),handlerStart=prior.indexOf('export function createLiveHandler('),serve=prior.lastIndexOf('Deno.serve(');
if(start<0||handlerStart<start||serve<handlerStart)throw Error('Unexpected baseline structure');
const dir=await mkdtemp(join(tmpdir(),'bruff-financial-bundle-'));
try{
 let bundle='';
 for(const [name,files]of Object.entries({BRUFFQueue:['server/native-queue.js'],BRUFFNative:['server/native-mass.js'],BRUFFAdvanced:['server/advanced-worker.js'],BRUFFPrep:['server/advanced-preparation.js'],BRUFFAudience:['supabase/functions/bruff-live/advanced-audience.js','supabase/functions/bruff-live/audience-discovery.js']})){
  const entry=join(dir,name+'.mjs');await writeFile(entry,files.map(p=>`export * from ${JSON.stringify(join(root,p))};`).join('\n'));
  const build=await rolldown({input:entry});
  try{const result=await build.generate({format:'iife',name});bundle+=result.output[0].code+'\n'}finally{await build.close()}
 }
 bundle+='const {resolveMassAudience,AudienceError,AudiencePending,discoverAudience}=BRUFFAudience;\n';
 // These exact helper bytes retain capability tickets, manual send and vault safeguards.
 bundle+=prior.slice(start,handlerStart);
 let handler=await readFile(join(root,'supabase/functions/bruff-live/handler.js'),'utf8');handler=handler.slice(handler.indexOf('export function createLiveHandler('));
 const legacy=handler.indexOf("  if(request.headers.has('x-bruff-automation-secret')){"),auth=handler.indexOf('  const authorization=',legacy);
 if(legacy<0||auth<legacy)throw Error('Unexpected legacy worker boundary');
 handler=handler.slice(0,legacy)+"  if(request.headers.has('x-bruff-automation-secret'))return reply(403,{error:'Ejecutor anterior deshabilitado'});\n"+handler.slice(auth);
 for(const [symbol,namespace]of Object.entries({manageNativeQueue:'BRUFFQueue',submitNativeMass:'BRUFFNative',runAdvancedTick:'BRUFFAdvanced',preparationPlan:'BRUFFPrep'}))handler=handler.replaceAll(symbol+'(',namespace+'.'+symbol+'(');
 bundle+=handler+'\n'+prior.slice(serve);
 await writeFile(output,bundle);
 console.log('Saved mass bundle; existing chat/vault helpers preserved byte-for-byte. No deployment.');
}finally{await rm(dir,{recursive:true,force:true})}
