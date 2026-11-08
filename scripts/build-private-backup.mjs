// Offline private SOURCE backup, not a database export or credential archive.
import {readdir,realpath,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {resolve,relative,isAbsolute,join,dirname,basename,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

const TREES=new Set(['src','server','supabase','scripts','plugins']);
const ROOT_FILES=new Set(['package.json','pnpm-lock.yaml','package-lock.json','yarn.lock','README.md','README']);
const DOCS=new Set(['AI-MANUAL-DRAFTS.md','CATALOG-FAN-PROGRESS.md','CATALOG-CONTENT-PROPOSALS.md','AI-AUTOPILOT.md']);
const EXTENSIONS=new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.css','.sql','.json','.md','.yaml','.yml']);
const EXCLUDED=new Set(['node_modules','dist','.git','.bruff-private','.sites-runtime','logs','log','exports','fan-exports','backups','screenshots','captures']);
const FORBIDDEN_NAME=/(?:^|[._-])(?:env|tokens?|secrets?|credentials?|cookies?|sessions?)(?:[._-]|$)|^(?:fans?|sales|conversations?|messages?|purchases?)[-_](?:exports?|dumps?|snapshots?)(?:[-_.]|$)/iu;
const sha=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>{throw new Error(message)};
const inside=(root,path)=>{const rel=relative(root,path);return rel===''||!rel.startsWith('..'+posix.sep)&&rel!=='..'&&!isAbsolute(rel)};
export function allowedBackupPath(path){
 if(typeof path!=='string'||!path||path.includes('\\')||/[\u0000-\u001f\u007f]/u.test(path)||isAbsolute(path)||posix.normalize(path)!==path||path.split('/').some(part=>!part||part==='.'||part==='..'||EXCLUDED.has(part)||FORBIDDEN_NAME.test(part)))return false;
 const parts=path.split('/');if(parts.length===1)return ROOT_FILES.has(path);
 if(parts[0]==='docs')return parts.length===2&&DOCS.has(parts[1]);
 const dot=parts.at(-1).lastIndexOf('.'),extension=dot<0?'':parts.at(-1).slice(dot).toLowerCase();
 // JSON is configuration only, never an arbitrary fan/data snapshot disguised
 // as source. These are the reviewed plugin configuration entry points.
 if(extension==='.json')return parts[0]==='plugins'&&['plugin.json','.app.json','mcp.json','desktop-mcp.json'].includes(parts.at(-1));
 return TREES.has(parts[0])&&EXTENSIONS.has(extension);
}
function inspectText(data,path){
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{fail('Non-text source rejected: '+path)}
 if(text.includes('\0'))fail('Binary source rejected: '+path);
 // Detect credential material, not environment variable names or code references.
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{32,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)||/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u.test(text)||/\bgh[pousr]_[A-Za-z0-9]{30,}\b/u.test(text)||/\bsb_secret_[A-Za-z0-9_-]{20,}\b/u.test(text)||/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u.test(text))fail('Credential-like source rejected: '+path);
 if(path.endsWith('.json')){
  let value;try{value=JSON.parse(text)}catch{fail('Invalid source JSON: '+path)}
  const inspect=(node,depth=0)=>{if(depth>100)fail('Source JSON nesting rejected: '+path);if(!node||typeof node!=='object')return;for(const [key,item]of Object.entries(node)){if(/^(?:access_token|refresh_token|api_key|apikey|password|secret|authorization|private_key)$/iu.test(key)&&typeof item==='string'&&item.length>=12&&!/(?:fictional|fictitious|fixture|example|dummy|placeholder|test[-_]|\$\{|process\.env|Deno\.env)/iu.test(item))fail('Credential-like JSON rejected: '+path);inspect(item,depth+1)}};inspect(value);
 }
}
async function sourceFile(root,path){
 const absolute=join(root,...path.split('/')),handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size>2*1024*1024)fail('Source size/type rejected: '+path);const data=await handle.readFile(),after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||data.length>2*1024*1024)fail('Source changed during backup: '+path);inspectText(data,path);return data}finally{await handle.close()}
}
async function collect(root){
 const names=[];
 async function walk(path){
  const full=join(root,...path.split('/')),stat=await lstat(full);if(stat.isSymbolicLink())fail('Symlink source rejected: '+path);
  if(stat.isDirectory()){
   for(const entry of (await readdir(full,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(EXCLUDED.has(entry.name)||FORBIDDEN_NAME.test(entry.name))continue;
    await walk(path+'/'+entry.name);
   }
  }else if(stat.isFile()&&allowedBackupPath(path))names.push(path);
 }
 for(const tree of [...TREES].sort()){try{await walk(tree)}catch(e){if(e.code!=='ENOENT')throw e}}
 for(const path of [...ROOT_FILES,...[...DOCS].map(name=>'docs/'+name)]){try{const stat=await lstat(join(root,path));if(stat.isSymbolicLink())fail('Symlink source rejected: '+path);if(stat.isFile())names.push(path)}catch(e){if(e.code!=='ENOENT')throw e}}
 names.sort();if(names.length>10000)fail('Too many source files');
 const files=[];let bytes=0;
 for(const path of names){if(!allowedBackupPath(path))fail('Source path rejected');const data=await sourceFile(root,path);bytes+=data.length;if(bytes>64*1024*1024)fail('Source backup exceeds bound');files.push({path,bytes:data.length,sha256:sha(data),data:data.toString('base64')})}
 if(!files.length)fail('No allowlisted source files found');return files;
}
const ZIP_CODE=String.raw`import sys,json,base64,io,zipfile
payload=json.load(sys.stdin)
out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for row in payload['entries']:
  info=zipfile.ZipInfo(row['path'],date_time=(1980,1,1,0,0,0))
  info.create_system=3
  info.external_attr=(0o100600<<16)
  info.compress_type=zipfile.ZIP_DEFLATED
  archive.writestr(info,base64.b64decode(row['data']),compresslevel=9)
sys.stdout.buffer.write(out.getvalue())
`;
async function zip(entries){
 return new Promise((accept,reject)=>{const child=execFile('/usr/bin/python3',['-I','-c',ZIP_CODE],{encoding:'buffer',maxBuffer:128*1024*1024,timeout:60000},(error,stdout)=>error?reject(new Error('Offline ZIP construction failed')):accept(stdout));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({entries}))});
}
export async function buildPrivateBackup({root,output,baselineCommit}={}){
 if(typeof root!=='string'||!isAbsolute(root)||typeof output!=='string'||!isAbsolute(output)||typeof baselineCommit!=='string'||!/^[a-f0-9]{40}$/u.test(baselineCommit))fail('Use absolute root/output and an explicit 40-character baseline commit');
 const source=await realpath(root),parent=await realpath(dirname(output)),target=join(parent,basename(output));
 if(inside(source,target)||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.zip$/u.test(basename(target)))fail('ZIP output must be outside the real source root');
 const files=await collect(source),manifest={schemaVersion:1,format:'bruff-private-source-backup',baselineCommit,baselineProvidedByCaller:true,containsDatabaseExport:false,scope:'allowlisted_source_only',files:files.map(({path,bytes,sha256})=>({path,bytes,sha256})),fileCount:files.length,totalBytes:files.reduce((n,row)=>n+row.bytes,0)};
 const entries=[{path:'BACKUP-MANIFEST.json',data:Buffer.from(JSON.stringify(manifest,null,2)+'\n').toString('base64')},...files.map(({path,data})=>({path,data}))],archive=await zip(entries);
 const handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(archive)}finally{await handle.close()}
 return {output:target,archiveBytes:archive.length,archiveSha256:sha(archive),baselineCommit,fileCount:manifest.fileCount,sourceBytes:manifest.totalBytes};
}
async function cli(){
 const args=process.argv.slice(2),options={root:fileURLToPath(new URL('../',import.meta.url))},keys={'--root':'root','--output':'output','--baseline':'baselineCommit'},seen=new Set();
 for(let i=0;i<args.length;i+=2){if(!Object.hasOwn(keys,args[i])||seen.has(args[i])||!args[i+1])fail('Usage: --output /absolute/backup.zip --baseline <40hex> [--root /absolute/source]');seen.add(args[i]);options[keys[args[i]]]=args[i+1]}
 console.log(JSON.stringify(await buildPrivateBackup(options)));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(()=>{console.error('Private source backup failed; no credentials or source content are logged.');process.exitCode=1});
