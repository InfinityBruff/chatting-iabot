// Offline deployment artifacts only. No credentials, network or remote writes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
const output=process.argv[2];if(!output)throw Error('Usage: build-manual-ai-functions.mjs absolute-output-directory');
const root=fileURLToPath(new URL('../',import.meta.url)),destination=resolve(output);
if(!output.startsWith('/')||destination===root||destination.startsWith(root+'/'))throw Error('Choose a separate absolute artifact directory.');
const require=createRequire(import.meta.url),{rolldown}=await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('rolldown')).href);
await mkdir(destination,{recursive:true});const functions=[];
for(const name of ['bruff-drafts','bruff-control']){
 const build=await rolldown({input:join(root,'supabase/functions',name,'index.ts')});
 try{const result=await build.generate({format:'esm'});if(result.output.length!==1||result.output[0].type!=='chunk')throw Error('Expected one self-contained function.');const code=result.output[0].code;if(!code.includes('Deno.serve('))throw Error('Missing entry point.');const path=join(destination,name+'.js');await writeFile(path,code);functions.push({name,path,sha256:createHash('sha256').update(code).digest('hex'),bytes:Buffer.byteLength(code)})}finally{await build.close()}
}
const migration=await readFile(join(root,'supabase/migrations/202611060042_ai_generation_knowledge.sql'));
await writeFile(join(destination,'manifest.json'),JSON.stringify({functions,migrationSha256:createHash('sha256').update(migration).digest('hex'),remoteChanges:false,inferences:0,fanSends:0},null,2)+'\n');
console.log(JSON.stringify({functions,remoteChanges:false}));
