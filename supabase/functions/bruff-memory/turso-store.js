// Server-only storage adapter. It does not authorize callers or contact OFMAPI.
// The handler must derive owner/actor/binding and recheck current permissions.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ID=/^[1-9][0-9]{0,23}$/u,HASH=/^[0-9a-f]{64}$/u;
const forbidden=/(?:https?:\/\/|data:|blob:|file:\/\/|Bearer\s+|\/Users\/|\/private\/|\/var\/|\/tmp\/|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.)/iu;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const cleanText=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v)&&!forbidden.test(v);
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString().slice(0,19)===v.slice(0,19);
const blankScan=()=>({version:0,cursor:null,historyComplete:false,recentCheckedAt:null,historyCheckedAt:null,pages:0});
export class MemoryStoreError extends Error{
 constructor(code='MEMORY_STORE',status=503){super(code==='MEMORY_CONFIG'?'Memoria todavía no configurada.':code==='MEMORY_CONFLICT'?'El recorrido cambió. Vuelve a consultar su estado.':'No se pudo consultar o guardar la memoria.');this.name='MemoryStoreError';this.code=code;this.status=status;}
}
const fail=()=>new MemoryStoreError();
const assert=value=>{if(!value)throw fail()};
const abort=signal=>{if(signal?.aborted)throw Object.assign(new Error('Consulta cancelada.'),{name:'AbortError'})};
function scoped(scope){
 assert(object(scope)&&['ownerId','workspaceId','creatorId','actorId'].every(k=>UUID.test(scope[k]))&&typeof scope.binding==='string'&&/^acct_[A-Za-z0-9_-]{1,123}$/u.test(scope.binding)&&ID.test(scope.fanId)&&HASH.test(scope.batchHash));
 return [scope.ownerId,scope.workspaceId,scope.creatorId,scope.binding,scope.fanId,scope.batchHash];
}
function observation(value){
 assert(exact(value,['folderId','mediaId','messageId','createdAt','kind','priceCents','openedReported','paidConfirmed'])&&cleanText(value.folderId,256)&&ID.test(value.mediaId)&&ID.test(value.messageId)&&iso(value.createdAt)&&['offered','free_sent','sent_price_unknown'].includes(value.kind)&&[true,false,null].includes(value.openedReported)&&value.paidConfirmed===false);
 assert(value.kind==='offered'?natural(value.priceCents)&&value.priceCents>0:value.kind==='free_sent'?value.priceCents===0:value.priceCents===null);
 return {...value,createdAt:new Date(value.createdAt).toISOString()};
}
function scan(value){
 assert(exact(value,['version','cursor','historyComplete','recentCheckedAt','historyCheckedAt','pages'])&&natural(value.version)&&natural(value.pages)&&value.pages<=1000000&&typeof value.historyComplete==='boolean'&&(value.cursor===null||cleanText(value.cursor,2048))&&(value.recentCheckedAt===null||iso(value.recentCheckedAt))&&(value.historyCheckedAt===null||iso(value.historyCheckedAt))&&(!value.historyComplete||value.cursor===null&&value.historyCheckedAt!==null));
 return {...value};
}
const scopeWhere='owner_id=? AND workspace_id=? AND creator_id=? AND binding=? AND fan_id=? AND batch_hash=?';
const scanFields='version,cursor,history_complete,recent_checked_at,history_checked_at,pages';
const scanFromRow=row=>scan({version:row.version,cursor:row.cursor,historyComplete:row.history_complete===1,recentCheckedAt:row.recent_checked_at,historyCheckedAt:row.history_checked_at,pages:row.pages});
const typed=value=>value===null?{type:'null'}:typeof value==='number'?{type:'integer',value:String(value)}:{type:'text',value};
function cell(value){
 assert(object(value));
 if(value.type==='null')return null;
 if(value.type==='text'){assert(typeof value.value==='string');return value.value}
 if(value.type==='integer'){assert(typeof value.value==='string'&&/^-?\d+$/u.test(value.value));const number=Number(value.value);assert(Number.isSafeInteger(number));return number}
 throw fail();
}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function json(response,signal){
 const reader=response.body?.getReader();assert(reader);let size=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true});
 const interrupted=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',interrupted,{once:true});
 try{while(true){signal.throwIfAborted();const result=await reader.read();signal.throwIfAborted();if(result.done)break;size+=result.value.byteLength;assert(size<=8*1024*1024);raw+=decoder.decode(result.value,{stream:true})}raw+=decoder.decode();return JSON.parse(raw)}
 finally{signal.removeEventListener('abort',interrupted);void reader.cancel().catch(()=>{});reader.releaseLock()}
}
export function createTursoMemoryStore({url,token,fetcher=fetch}={}){
 let endpoint;
 try{const parsed=new URL(url);if(!['https:','libsql:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.port||parsed.search||parsed.hash||parsed.pathname&&parsed.pathname!=='/'||!/(?:^[a-z0-9][a-z0-9.-]*)\.turso\.io$/u.test(parsed.hostname))throw Error();parsed.protocol='https:';endpoint='https://'+parsed.hostname+'/v2/pipeline';if(typeof token!=='string'||!token||token.length>16384||/\s/u.test(token))throw Error()}catch{throw new MemoryStoreError('MEMORY_CONFIG')}
 const execute=async(sql,args,signal)=>{
  abort(signal);const deadline=AbortSignal.timeout(15000),linked=signal?AbortSignal.any([signal,deadline]):deadline;
  // PRAGMA is per connection; an earlier schema installation does not enable
  // FK checks on this new HTTP connection. No transaction spans requests.
  const body=JSON.stringify({requests:[{type:'execute',stmt:{sql:'PRAGMA foreign_keys=ON',args:[],want_rows:false}},{type:'execute',stmt:{sql,args:args.map(typed),want_rows:true}},{type:'close'}]});assert(new TextEncoder().encode(body).length<=1024*1024);
  try{
   const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,redirect:'error',signal:linked});linked.throwIfAborted();assert(response.ok);
   const data=await json(response,linked);linked.throwIfAborted();
   assert(Array.isArray(data?.results)&&data.results.length===3&&data.results[0]?.type==='ok'&&data.results[0].response?.type==='execute'&&data.results[1]?.type==='ok'&&data.results[1].response?.type==='execute'&&data.results[2]?.type==='ok'&&data.results[2].response?.type==='close');
   const pragma=data.results[0].response.result;assert(Array.isArray(pragma?.cols)&&pragma.cols.length===0&&Array.isArray(pragma.rows)&&pragma.rows.length===0);
   const result=data.results[1].response.result;assert(Array.isArray(result?.cols)&&result.cols.length<=40&&Array.isArray(result.rows)&&result.rows.length<=6001&&natural(result.affected_row_count));
   const names=result.cols.map(c=>c?.name);assert(names.every(n=>typeof n==='string'&&/^[a-z_][a-z0-9_]{0,79}$/u.test(n))&&new Set(names).size===names.length);
   return {rows:result.rows.map(row=>{assert(Array.isArray(row)&&row.length===names.length);return Object.fromEntries(row.map((v,i)=>[names[i],cell(v)]))}),affected:result.affected_row_count};
  }catch(error){abort(signal);throw fail()}
 };
 return {
  async readCatalog({workspaceId,creatorId,batchHash},signal){
   assert(UUID.test(workspaceId)&&UUID.test(creatorId)&&HASH.test(batchHash));
   const {rows}=await execute(`SELECT model.owner_id,model.workspace_id,model.creator_id,model.batch_hash,model.source_username,
    model.status AS model_status,model.enabled AS model_enabled,b.status AS batch_status,b.enabled AS batch_enabled,
    f.folder_key,f.source_name,f.complete AS folder_complete,f.status AS folder_status,f.enabled AS folder_enabled,
    f.step_order_confirmed AS folder_order,f.position_confirmed AS folder_position,
    m.media_id,m.media_type,m.observed_label,m.observed_index,m.reference_example_price_cents,m.configured_price_cents,
    m.status AS media_status,m.enabled AS media_enabled,m.step_order_confirmed AS media_order,m.position_confirmed AS media_position,m.final_price_confirmed,
    json_extract(m.source_metadata_json,'$.observed.durationLabel') AS duration_label
    FROM bruff_catalog_models model JOIN bruff_catalog_batches b USING(owner_id,workspace_id,batch_hash)
    LEFT JOIN bruff_catalog_folders f USING(owner_id,workspace_id,batch_hash,creator_id)
    LEFT JOIN bruff_catalog_media m USING(owner_id,workspace_id,batch_hash,creator_id,folder_key)
    WHERE model.workspace_id=? AND model.creator_id=? AND model.batch_hash=?
    ORDER BY model.owner_id,f.folder_key,m.observed_index,m.media_id LIMIT 1101`,[workspaceId,creatorId,batchHash],signal);
   assert(rows.length>0&&rows.length<=1100);const ownerId=rows[0].owner_id,sourceUsername=rows[0].source_username;
   assert(UUID.test(ownerId)&&(sourceUsername===null||cleanText(sourceUsername,128)));
   const folders=new Map(),mediaIds=new Set();let total=0;
   for(const row of rows){
    assert(row.owner_id===ownerId&&row.workspace_id===workspaceId&&row.creator_id===creatorId&&row.batch_hash===batchHash&&row.source_username===sourceUsername&&row.model_status==='draft'&&row.model_enabled===0&&row.batch_status==='draft'&&row.batch_enabled===0);
    if(row.folder_key===null){assert(row.media_id===null&&rows.length===1);continue}
    assert(cleanText(row.folder_key,256)&&cleanText(row.source_name,256)&&row.folder_complete===1&&row.folder_status==='draft'&&row.folder_enabled===0&&row.folder_order===0&&row.folder_position===null);
    let folder=folders.get(row.folder_key);if(!folder){assert(folders.size<100);folder={id:row.folder_key,name:row.source_name,orderConfirmed:false,items:[]};folders.set(row.folder_key,folder)}else assert(folder.name===row.source_name);
    if(row.media_id===null){assert(folder.items.length===0);continue}
    assert(ID.test(row.media_id)&&!mediaIds.has(row.media_id)&&['photo','video','audio','gif'].includes(row.media_type)&&natural(row.observed_index)&&row.media_status==='draft'&&row.media_enabled===0&&row.media_order===0&&row.media_position===null&&row.final_price_confirmed===0&&row.configured_price_cents===null&&(row.reference_example_price_cents===null||natural(row.reference_example_price_cents))&&(row.observed_label===null||cleanText(row.observed_label,256))&&(row.duration_label===null||cleanText(row.duration_label,100)));
    mediaIds.add(row.media_id);assert(++total<=1000);folder.items.push({id:row.media_id,type:row.media_type,label:row.observed_label,durationLabel:row.duration_label,referencePriceCents:row.reference_example_price_cents,configuredPriceCents:null});
   }
   return {ownerId,workspaceId,creatorId,batchHash,sourceUsername,folders:[...folders.values()]};
  },
  async writeObservations(scope,observations,signal){
   const values=scoped(scope);assert(Array.isArray(observations)&&observations.length<=1000);if(!observations.length)return {written:0};
   const normalized=observations.map(observation),args=[],tuples=[];
   for(const item of normalized){abort(signal);const hash=await digest([...values,item.folderId,item.mediaId,item.messageId,item.createdAt,item.kind,item.priceCents,item.openedReported,false]);tuples.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');args.push(...values,item.folderId,item.mediaId,item.messageId,item.createdAt,item.kind,item.priceCents,item.openedReported===null?null:item.openedReported?1:0,0,scope.actorId,hash)}
   const result=await execute(`INSERT INTO bruff_fan_script_observations(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,folder_id,media_id,message_id,message_created_at,kind,price_cents,opened_reported,paid_confirmed,actor_id,observation_hash) VALUES ${tuples.join(',')} ON CONFLICT(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,observation_hash) DO NOTHING`,args,signal);
   return {written:result.affected};
  },
  async readProgress(scope,signal){
   const values=scoped(scope);
   // One SQL snapshot prevents a newer complete cursor being paired with older
   // observations from a separate HTTP read while another scanner commits.
   const {rows}=await execute(`WITH latest AS(SELECT folder_id,media_id,message_id,message_created_at,kind,price_cents,opened_reported,paid_confirmed,observation_id,row_number() OVER(PARTITION BY folder_id,media_id,message_id ORDER BY observation_id DESC) AS n FROM bruff_fan_script_observations WHERE ${scopeWhere}), observed AS(SELECT * FROM latest WHERE n=1 ORDER BY observation_id LIMIT 5001)
    SELECT 'observation' AS row_type,folder_id,media_id,message_id,message_created_at,kind,price_cents,opened_reported,paid_confirmed,NULL AS version,NULL AS cursor,NULL AS history_complete,NULL AS recent_checked_at,NULL AS history_checked_at,NULL AS pages FROM observed
    UNION ALL SELECT 'scan',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,${scanFields} FROM bruff_fan_script_scans WHERE ${scopeWhere}`,[...values,...values],signal);
   assert(rows.every(row=>['observation','scan'].includes(row.row_type)));const observed=rows.filter(row=>row.row_type==='observation'),scans=rows.filter(row=>row.row_type==='scan');assert(observed.length<=5000&&scans.length<=1);
   const observations=observed.map(row=>{assert([null,0,1].includes(row.opened_reported)&&row.paid_confirmed===0);return observation({folderId:row.folder_id,mediaId:row.media_id,messageId:row.message_id,createdAt:row.message_created_at,kind:row.kind,priceCents:row.price_cents,openedReported:row.opened_reported===null?null:row.opened_reported===1,paidConfirmed:false})});
   if(scans.length)assert([0,1].includes(scans[0].history_complete));
   return {observations,scan:scans.length?scanFromRow(scans[0]):blankScan()};
  },
  async saveScan(scope,expectedVersion,next,signal){
   const values=scoped(scope);assert(natural(expectedVersion)&&expectedVersion<Number.MAX_SAFE_INTEGER&&exact(next,['cursor','historyComplete','recentCheckedAt','historyCheckedAt','pages']));const value=scan({version:expectedVersion+1,...next});
   const data=[value.cursor,value.historyComplete?1:0,value.recentCheckedAt,value.historyCheckedAt,value.pages,scope.actorId];
   const result=expectedVersion===0?await execute(`INSERT INTO bruff_fan_script_scans(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,version,cursor,history_complete,recent_checked_at,history_checked_at,pages,actor_id) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?) ON CONFLICT(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash) DO NOTHING RETURNING ${scanFields}`,[...values,...data],signal):await execute(`UPDATE bruff_fan_script_scans SET version=version+1,cursor=?,history_complete=?,recent_checked_at=?,history_checked_at=?,pages=?,actor_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${scopeWhere} AND version=? RETURNING ${scanFields}`,[...data,...values,expectedVersion],signal);
   if(result.rows.length!==1)throw new MemoryStoreError('MEMORY_CONFLICT',409);assert([0,1].includes(result.rows[0].history_complete));const saved=scanFromRow(result.rows[0]);assert(saved.version===expectedVersion+1);return saved;
  },
 };
}
