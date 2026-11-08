// Build a self-contained deployment artifact; no credentials or remote changes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),output=process.argv[2];
if(process.argv.length!==3||!output?.startsWith('/')||resolve(output).startsWith(root))throw Error('Choose a separate absolute artifact directory.');
const require=createRequire(import.meta.url),{rolldown}=await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('rolldown')).href);
await mkdir(output,{recursive:true});
const build=await rolldown({input:join(root,'supabase/functions/bruff-memory/index.ts')});
try{
 const result=await build.generate({format:'esm'});
 if(result.output.length!==1||result.output[0].type!=='chunk'||!result.output[0].code.includes('Deno.serve('))throw Error('Expected one self-contained Edge Function.');
 const code=result.output[0].code,path=join(output,'bruff-memory.js'),schema=await readFile(join(root,'supabase/migrations/turso/202611070001_fan_script_progress.sql'));
 await writeFile(path,code);
 const manifest={function:{name:'bruff-memory',path,bytes:Buffer.byteLength(code),sha256:createHash('sha256').update(code).digest('hex')},schema:{name:'202611070001_fan_script_progress.sql',bytes:schema.byteLength,sha256:createHash('sha256').update(schema).digest('hex')},remoteChanges:false,fanSends:0};
 manifest.schemas=[];
 for(const name of ['202611070001_fan_script_progress.sql','202611070002_script_commerce.sql','202611080003_fan_context.sql']){const data=await readFile(join(root,'supabase/migrations/turso',name));manifest.schemas.push({name,bytes:data.byteLength,sha256:createHash('sha256').update(data).digest('hex')})}
 await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
}finally{await build.close()}
