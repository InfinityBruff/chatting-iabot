import {emptyFanContext,validateFanContext,validateFanMemoryScope} from './fan-context.js';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(x);
const fail=(code='MEMORY_CONTEXT_STORE',status=503)=>Object.assign(Error(status===409?'La memoria cambió en otra sesión.':'No se pudo consultar o guardar la memoria contextual.'),{code,status});
const abort=signal=>{if(signal?.aborted)throw signal.reason||Object.assign(Error('Cancelado'),{name:'AbortError'})};
const fields=scope=>Object.values(validateFanMemoryScope(scope));
const where='owner_id=? AND workspace_id=? AND creator_id=? AND binding=? AND fan_id=?';
const typed=x=>typeof x==='number'?{type:'integer',value:String(x)}:{type:'text',value:x};
function cell(x){if(!object(x))throw fail();if(x.type==='text'&&typeof x.value==='string')return x.value;if(x.type==='integer'&&typeof x.value==='string'&&/^\d+$/u.test(x.value)&&Number.isSafeInteger(Number(x.value)))return Number(x.value);throw fail()}
async function digest(x){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x))))].map(v=>v.toString(16).padStart(2,'0')).join('')}
// No authorization is inferred by this adapter. Callers provide a current,
// server-derived owner/model/binding scope and recheck it before/after access.
export function createFanMemoryStore({url,token,fetcher=fetch}={}){
 let endpoint;try{const u=new URL(url);if(!['https:','libsql:'].includes(u.protocol)||u.username||u.password||u.port||u.search||u.hash||!['','/'].includes(u.pathname)||!/(?:^[a-z0-9][a-z0-9.-]*)\.turso\.io$/u.test(u.hostname)||typeof token!=='string'||!token||token.length>16384||/\s/u.test(token))throw Error();endpoint='https://'+u.hostname+'/v2/pipeline'}catch{throw fail('MEMORY_CONFIG')}
 async function execute(sql,args,signal){
  abort(signal);const linked=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
  const body=JSON.stringify({requests:[{type:'execute',stmt:{sql,args:args.map(typed),want_rows:true}},{type:'close'}]});if(new TextEncoder().encode(body).length>3*1024*1024)throw fail();
  try{
   const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,redirect:'error',signal:linked});if(!response.ok)throw fail();
   const reader=response.body?.getReader();if(!reader)throw fail();let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true}),cancel=()=>{void reader.cancel().catch(()=>{})};linked.addEventListener('abort',cancel,{once:true});
   try{while(true){linked.throwIfAborted();const part=await reader.read();linked.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4*1024*1024)throw fail();text+=decoder.decode(part.value,{stream:true})}text+=decoder.decode()}finally{linked.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock()}
   const data=JSON.parse(text);if(!Array.isArray(data?.results)||data.results.length!==2||data.results[0]?.type!=='ok'||data.results[0].response?.type!=='execute'||data.results[1]?.type!=='ok'||data.results[1].response?.type!=='close')throw fail();const result=data.results[0].response.result;
   if(!Array.isArray(result?.cols)||result.cols.length>5||!Array.isArray(result.rows)||result.rows.length>1||!natural(result.affected_row_count))throw fail();
   const keys=result.cols.map(x=>x.name);if(keys.some(x=>!['version','memory_json','scan_json','content_hash'].includes(x))||new Set(keys).size!==keys.length)throw fail();
   return {rows:result.rows.map(row=>{if(!Array.isArray(row)||row.length!==keys.length)throw fail();return Object.fromEntries(row.map((v,i)=>[keys[i],cell(v)]))}),affected:result.affected_row_count};
  }catch(e){abort(signal);throw fail()}
 }
 async function decode(scope,row){let record;try{record={memory:JSON.parse(row.memory_json),scan:JSON.parse(row.scan_json)}}catch{throw fail()}if(row.version!==record.memory?.version||row.content_hash!==await digest([fields(scope),record]))throw fail();return validateFanContext(scope,record)}
 return {
  async read(scope,signal){const result=await execute(`SELECT version,memory_json,scan_json,content_hash FROM bruff_fan_context_current WHERE ${where} LIMIT 1`,fields(scope),signal);return result.rows.length?decode(scope,result.rows[0]):emptyFanContext(scope)},
  async write(scope,expectedVersion,record,signal){
   if(!natural(expectedVersion)||expectedVersion===Number.MAX_SAFE_INTEGER||!uuid(scope.actorId))throw fail();const value=validateFanContext(scope,record);if(value.memory.version!==expectedVersion+1)throw fail();const values=fields(scope),checksum=await digest([values,value]),memory=JSON.stringify(value.memory),scan=JSON.stringify(value.scan);if(memory.length+scan.length>1048576)throw fail('MEMORY_CONTEXT_LIMIT',409);
   // One current row avoids copying a growing history on every sync. The
   // suppressed keys remain in that same CAS-protected state after deletion.
   const result=await execute(`INSERT INTO bruff_fan_context_current(owner_id,workspace_id,creator_id,binding,fan_id,version,memory_json,scan_json,content_hash,actor_id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM bruff_fan_context_current WHERE ${where} AND version=?) ON CONFLICT(owner_id,workspace_id,creator_id,binding,fan_id) DO UPDATE SET version=excluded.version,memory_json=excluded.memory_json,scan_json=excluded.scan_json,content_hash=excluded.content_hash,actor_id=excluded.actor_id,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE bruff_fan_context_current.version=? RETURNING version,memory_json,scan_json,content_hash`,[...values,value.memory.version,memory,scan,checksum,scope.actorId,expectedVersion,...values,expectedVersion,expectedVersion],signal);if(result.rows.length!==1)throw fail('MEMORY_CONFLICT',409);return decode(scope,result.rows[0]);
  },
 };
}
