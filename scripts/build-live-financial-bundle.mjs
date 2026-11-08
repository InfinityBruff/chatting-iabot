// Preserve deployed send safeguards; update explicitly bounded read/presentation helpers.
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
 for(const [name,files]of Object.entries({BRUFFLikes:['supabase/functions/bruff-live/message-like.js'],BRUFFReadGuard:['supabase/functions/bruff-live/provider-read-guard.js','supabase/functions/bruff-live/provider-read-coordinator.js'],BRUFFNotificationHeads:['supabase/functions/bruff-live/notification-heads.js'],BRUFFQueue:['server/native-queue.js'],BRUFFNative:['server/native-mass.js'],BRUFFAdvanced:['server/advanced-worker.js'],BRUFFPrep:['server/advanced-preparation.js'],BRUFFAudience:['supabase/functions/bruff-live/advanced-audience.js','supabase/functions/bruff-live/audience-discovery.js']})){
  const entry=join(dir,name+'.mjs');await writeFile(entry,files.map(p=>`export * from ${JSON.stringify(join(root,p))};`).join('\n'));
  const build=await rolldown({input:entry});
  try{const result=await build.generate({format:'iife',name});bundle+=result.output[0].code+'\n'}finally{await build.close()}
 }
 bundle+='const {resolveMassAudience,AudienceError,AudiencePending,discoverAudience}=BRUFFAudience;\n';
 bundle+='const {protectProviderReads,retrySeconds,coordinateProviderReads,createProviderReadCache}=BRUFFReadGuard;\n';
 // These exact helper bytes retain capability tickets, manual send and vault safeguards.
 let helpers=prior.slice(start,handlerStart);
 const actions=await readFile(join(root,'supabase/functions/bruff-live/actions.js'),'utf8'),handlerSource=await readFile(join(root,'supabase/functions/bruff-live/handler.js'),'utf8');
 // Replace only these two standalone functions. Ticket signing and manual-send
 // state transitions remain byte-for-byte from the verified deployed baseline.
 for(const [symbol,source]of [['mediaView',actions],['normalizeLive',handlerSource]]){
  const marker='export function '+symbol+'(',a=helpers.indexOf(marker),b=helpers.indexOf('\n}\n',a)+3,c=source.indexOf(marker),d=source.indexOf('\n}\n',c)+3;
  if(a<0||b<a||c<0||d<c)throw Error('Unexpected helper boundary: '+symbol);
  helpers=helpers.slice(0,a)+source.slice(c,d)+helpers.slice(b);
 }
 // Propagate read-only vault Retry-After without replacing any send/ticket code.
 const vaultReadLine=text=>text.split('\n').find(line=>line.trimStart().startsWith("const r=await upstream((op==='vault_media'?"));
 const priorVault=vaultReadLine(helpers),currentVault=vaultReadLine(actions);
 if(!priorVault||!currentVault)throw Error('Unexpected vault read boundary');
 helpers=helpers.replace(priorVault,currentVault);
 const communityStart=helpers.indexOf('export async function communityAction('),communityEnd=helpers.indexOf('\nconst origins=',communityStart);
 const community=await readFile(join(root,'supabase/functions/bruff-live/community.js'),'utf8');
 if(communityStart<0||communityEnd<communityStart)throw Error('Unexpected community helper boundary');
 bundle+=helpers.slice(0,communityStart)+community.slice(community.indexOf('export async function communityAction(')).trimEnd()+'\n'+helpers.slice(communityEnd);
 let handler=await readFile(join(root,'supabase/functions/bruff-live/handler.js'),'utf8');handler=handler.slice(handler.indexOf('export function createLiveHandler('));
 const legacy=handler.indexOf("  if(request.headers.has('x-bruff-automation-secret')){"),auth=handler.indexOf('  const authorization=',legacy);
 if(legacy<0||auth<legacy)throw Error('Unexpected legacy worker boundary');
 handler=handler.slice(0,legacy)+"  if(request.headers.has('x-bruff-automation-secret'))return reply(403,{error:'Ejecutor anterior deshabilitado'});\n"+handler.slice(auth);
 for(const [symbol,namespace]of Object.entries({likeFanMessage:'BRUFFLikes',readNotificationHeads:'BRUFFNotificationHeads',manageNativeQueue:'BRUFFQueue',submitNativeMass:'BRUFFNative',runAdvancedTick:'BRUFFAdvanced',preparationPlan:'BRUFFPrep'}))handler=handler.replaceAll(symbol+'(',namespace+'.'+symbol+'(');
 const serveSource=prior.slice(serve);
 bundle+=handler+'\n'+(serveSource.includes('readSlotEnabled:')?serveSource:serveSource.replace('createLiveHandler({','createLiveHandler({readSlotEnabled:true,'));
 await writeFile(output,bundle);
 console.log('Saved bundle; manual send/ticket safeguards preserved, explicit media/read/like helpers rebuilt. No deployment.');
}finally{await rm(dir,{recursive:true,force:true})}
