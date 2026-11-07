// Server-only, parameterized Turso storage. Authorization and provider binding
// resolution belong to the caller and must be checked again before returning.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ID=/^[1-9][0-9]{0,23}$/u,HASH=/^[0-9a-f]{64}$/u,BINDING=/^acct_[A-Za-z0-9_-]{1,123}$/u;
const OPENED='ofmapi-openapi-20261107-ppv-opened',PURCHASED='ofmapi-webhooks-20261107-ppv-purchased';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&ID.test(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v)&&!/(?:https?:\/\/|data:|blob:|file:\/\/|Bearer\s+|\/Users\/|\/private\/|\/var\/|\/tmp\/)/iu.test(v);
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const orderIds=(a,b)=>a.length-b.length||(a<b?-1:a>b?1:0);
export class CommerceStoreError extends Error{
 constructor(code='MEMORY_STORE',status=503){super(code==='MEMORY_CONFIG'?'Memoria todavía no configurada.':code==='MEMORY_CONFLICT'?'El plan cambió. Vuelve a consultar su versión.':'No se pudo consultar o guardar la evidencia.');this.name='CommerceStoreError';this.code=code;this.status=status;}
}
const fail=()=>new CommerceStoreError();
const assert=value=>{if(!value)throw fail()};
const abort=signal=>{if(signal?.aborted)throw Object.assign(new Error('Consulta cancelada.'),{name:'AbortError'})};
function base(scope){assert(object(scope)&&['ownerId','workspaceId','creatorId','actorId'].every(k=>typeof scope[k]==='string'&&UUID.test(scope[k]))&&typeof scope.binding==='string'&&BINDING.test(scope.binding));return [scope.ownerId,scope.workspaceId,scope.creatorId,scope.binding]}
function catalogue(scope){const values=base(scope);assert(HASH.test(scope.batchHash));return [...values,scope.batchHash]}
function fan(scope){const values=catalogue(scope);assert(id(scope.fanId));return [...values.slice(0,4),scope.fanId,scope.batchHash]}
function plan(value){
 assert(exact(value,['folderId','steps'])&&text(value.folderId,256)&&Array.isArray(value.steps)&&value.steps.length>0&&value.steps.length<=1000);
 const ids=new Set();const steps=value.steps.map(step=>{assert(exact(step,['mediaId','priceCents'])&&id(step.mediaId)&&!ids.has(step.mediaId)&&(step.priceCents===null||natural(step.priceCents)));ids.add(step.mediaId);return {...step}});
 return {folderId:value.folderId,steps};
}
function evidence(value){
 assert(exact(value,['kind','messageId','mediaIds','offerPriceCents','paidAmountCents','paidAt','eventId','contract'])&&['paid_unlock_reported','ppv_purchase_event'].includes(value.kind)&&id(value.messageId)&&Array.isArray(value.mediaIds)&&value.mediaIds.length>0&&value.mediaIds.length<=1000&&value.mediaIds.every(id)&&new Set(value.mediaIds).size===value.mediaIds.length&&(value.offerPriceCents===null||natural(value.offerPriceCents)&&value.offerPriceCents>0));
 assert(value.kind==='paid_unlock_reported'?value.offerPriceCents!==null&&value.paidAmountCents===null&&value.paidAt===null&&value.eventId===null&&value.contract===OPENED:natural(value.paidAmountCents)&&value.paidAmountCents>0&&iso(value.paidAt)&&UUID.test(value.eventId)&&value.contract===PURCHASED);
 return {...value,mediaIds:[...value.mediaIds].sort(orderIds),paidAt:value.paidAt===null?null:new Date(value.paidAt).toISOString()};
}
function event(value){
 assert(exact(value,['eventId','fanId','messageId','amountCents','occurredAt','ingestedAt','contract'])&&UUID.test(value.eventId)&&id(value.fanId)&&id(value.messageId)&&natural(value.amountCents)&&value.amountCents>0&&iso(value.occurredAt)&&iso(value.ingestedAt)&&value.contract===PURCHASED);
 return {...value,occurredAt:new Date(value.occurredAt).toISOString(),ingestedAt:new Date(value.ingestedAt).toISOString()};
}
const typed=value=>value===null?{type:'null'}:typeof value==='number'?{type:'integer',value:String(value)}:{type:'text',value};
function cell(value){assert(object(value));if(value.type==='null')return null;if(value.type==='text'){assert(typeof value.value==='string');return value.value}if(value.type==='integer'){assert(typeof value.value==='string'&&/^-?\d+$/u.test(value.value));const number=Number(value.value);assert(Number.isSafeInteger(number));return number}throw fail()}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function readJson(response,signal){
 const reader=response.body?.getReader();assert(reader);let size=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true});const interrupted=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',interrupted,{once:true});
 try{while(true){signal.throwIfAborted();const result=await reader.read();signal.throwIfAborted();if(result.done)break;size+=result.value.byteLength;assert(size<=8*1024*1024);raw+=decoder.decode(result.value,{stream:true})}raw+=decoder.decode();return JSON.parse(raw)}finally{signal.removeEventListener('abort',interrupted);void reader.cancel().catch(()=>{});reader.releaseLock()}
}
const catalogWhere='owner_id=? AND workspace_id=? AND creator_id=? AND binding=? AND batch_hash=?';
const fanWhere='owner_id=? AND workspace_id=? AND creator_id=? AND binding=? AND fan_id=? AND batch_hash=?';
export function createCommerceStore({url,token,fetcher=fetch}={}){
 let endpoint;
 try{const parsed=new URL(url);if(!['https:','libsql:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.port||parsed.search||parsed.hash||parsed.pathname&&parsed.pathname!=='/'||!/(?:^[a-z0-9][a-z0-9.-]*)\.turso\.io$/u.test(parsed.hostname))throw Error();endpoint='https://'+parsed.hostname+'/v2/pipeline';if(typeof token!=='string'||!token||token.length>16384||/\s/u.test(token))throw Error()}catch{throw new CommerceStoreError('MEMORY_CONFIG')}
 const execute=async(sql,args,signal)=>{
  abort(signal);const deadline=AbortSignal.timeout(15000),linked=signal?AbortSignal.any([signal,deadline]):deadline;
  const body=JSON.stringify({requests:[{type:'execute',stmt:{sql:'PRAGMA foreign_keys=ON',args:[],want_rows:false}},{type:'execute',stmt:{sql,args:args.map(typed),want_rows:true}},{type:'close'}]});assert(new TextEncoder().encode(body).length<=1024*1024);
  try{
   const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,redirect:'error',signal:linked});linked.throwIfAborted();assert(response.ok);const data=await readJson(response,linked);linked.throwIfAborted();
   assert(Array.isArray(data?.results)&&data.results.length===3&&data.results[0]?.type==='ok'&&data.results[0].response?.type==='execute'&&data.results[1]?.type==='ok'&&data.results[1].response?.type==='execute'&&data.results[2]?.type==='ok'&&data.results[2].response?.type==='close');
   const pragma=data.results[0].response.result;assert(Array.isArray(pragma?.cols)&&pragma.cols.length===0&&Array.isArray(pragma.rows)&&pragma.rows.length===0);
   const result=data.results[1].response.result;assert(Array.isArray(result?.cols)&&result.cols.length<=32&&Array.isArray(result.rows)&&result.rows.length<=5001&&natural(result.affected_row_count));const names=result.cols.map(c=>c?.name);assert(names.every(name=>typeof name==='string'&&/^[a-z_][a-z0-9_]{0,79}$/u.test(name))&&new Set(names).size===names.length);
   return {rows:result.rows.map(row=>{assert(Array.isArray(row)&&row.length===names.length);return Object.fromEntries(row.map((value,i)=>[names[i],cell(value)]))}),affected:result.affected_row_count};
  }catch(error){abort(signal);throw fail()}
 };
 const storedPlan=async(scope,row)=>{
  assert(natural(row.version)&&row.version>0&&UUID.test(row.approved_by)&&iso(row.approved_at)&&row.binding===scope.binding&&HASH.test(row.plan_hash));let value;try{value=plan({folderId:row.folder_id,steps:JSON.parse(row.steps_json)})}catch{throw fail()}
  assert(row.plan_hash===await digest([...catalogue(scope),value.folderId,row.version,value.steps]));return {...value,version:row.version,planHash:row.plan_hash,approvedAt:row.approved_at,approvedBy:row.approved_by,binding:row.binding};
 };
 return {
  async readPlans(scope,signal){
   const values=catalogue(scope),{rows}=await execute(`WITH ranked AS(SELECT folder_id,version,plan_hash,approved_by,approved_at,binding,steps_json,row_number() OVER(PARTITION BY folder_id ORDER BY version DESC) AS n FROM bruff_script_plans WHERE ${catalogWhere}) SELECT folder_id,version,plan_hash,approved_by,approved_at,binding,steps_json FROM ranked WHERE n=1 ORDER BY folder_id LIMIT 101`,values,signal);assert(rows.length<=100);return Promise.all(rows.map(row=>storedPlan(scope,row)));
  },
  async savePlan(scope,expectedVersion,input,signal){
   const values=catalogue(scope),value=plan(input);assert(natural(expectedVersion)&&expectedVersion<Number.MAX_SAFE_INTEGER);const version=expectedVersion+1,hash=await digest([...values,value.folderId,version,value.steps]);abort(signal);
   const result=await execute(`INSERT INTO bruff_script_plans(owner_id,workspace_id,creator_id,binding,batch_hash,folder_id,version,plan_hash,approved_by,steps_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT max(version) FROM bruff_script_plans WHERE ${catalogWhere} AND folder_id=?),0)=? RETURNING folder_id,version,plan_hash,approved_by,approved_at,binding,steps_json`,[...values,value.folderId,version,hash,scope.actorId,JSON.stringify(value.steps),...values,value.folderId,expectedVersion],signal);
   if(result.rows.length!==1)throw new CommerceStoreError('MEMORY_CONFLICT',409);const saved=await storedPlan(scope,result.rows[0]);assert(saved.planHash===hash&&saved.version===version&&saved.approvedBy===scope.actorId);return saved;
  },
  async readEvidence(scope,signal){
   const values=fan(scope),{rows}=await execute(`SELECT evidence_hash,kind,message_id,media_ids_json,offer_price_cents,paid_amount_cents,paid_at,event_id,provider_contract,observed_at FROM bruff_purchase_evidence WHERE ${fanWhere} ORDER BY evidence_sequence LIMIT 5001`,values,signal);assert(rows.length<=5000);
   return Promise.all(rows.map(async row=>{let value;try{value=evidence({kind:row.kind,messageId:row.message_id,mediaIds:JSON.parse(row.media_ids_json),offerPriceCents:row.offer_price_cents,paidAmountCents:row.paid_amount_cents,paidAt:row.paid_at,eventId:row.event_id,contract:row.provider_contract})}catch{throw fail()}assert(iso(row.observed_at)&&HASH.test(row.evidence_hash)&&row.evidence_hash===await digest([...values,value.kind,value.messageId,value.mediaIds,value.offerPriceCents,value.paidAmountCents,value.paidAt,value.eventId,value.contract]));return {id:row.evidence_hash,...value,observedAt:row.observed_at}}));
  },
  async writeEvidence(scope,inputs,signal){
   const values=fan(scope);assert(Array.isArray(inputs)&&inputs.length<=1000);if(!inputs.length)return {written:0};const normalized=inputs.map(evidence),args=[],tuples=[];
   for(const value of normalized){abort(signal);const hash=await digest([...values,value.kind,value.messageId,value.mediaIds,value.offerPriceCents,value.paidAmountCents,value.paidAt,value.eventId,value.contract]);tuples.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');args.push(...values.slice(0,4),values[5],values[4],hash,value.kind,value.messageId,JSON.stringify(value.mediaIds),value.offerPriceCents,value.paidAmountCents,value.paidAt,value.eventId,value.contract,scope.actorId)}
   const result=await execute(`INSERT INTO bruff_purchase_evidence(owner_id,workspace_id,creator_id,binding,batch_hash,fan_id,evidence_hash,kind,message_id,media_ids_json,offer_price_cents,paid_amount_cents,paid_at,event_id,provider_contract,actor_id) VALUES ${tuples.join(',')} ON CONFLICT(owner_id,workspace_id,creator_id,binding,fan_id,batch_hash,evidence_hash) DO NOTHING`,args,signal);return {written:result.affected};
  },
  async readEvents(scope,signal){
   const values=base(scope);assert(id(scope.fanId));const {rows}=await execute('SELECT event_id,fan_id,message_id,amount_cents,occurred_at,ingested_at,provider_contract FROM bruff_ppv_events WHERE owner_id=? AND workspace_id=? AND creator_id=? AND binding=? AND fan_id=? ORDER BY event_sequence LIMIT 5001',[...values,scope.fanId],signal);assert(rows.length<=5000);return rows.map(row=>event({eventId:row.event_id,fanId:row.fan_id,messageId:row.message_id,amountCents:row.amount_cents,occurredAt:row.occurred_at,ingestedAt:row.ingested_at,contract:row.provider_contract}));
  },
  async writeEvent(scope,input,signal){
   const values=base(scope),value=event(input);assert(scope.fanId===undefined||scope.fanId===value.fanId);const hash=await digest([...values,value.eventId,value.fanId,value.messageId,value.amountCents,value.occurredAt,value.ingestedAt,value.contract]);abort(signal);
   const result=await execute('INSERT INTO bruff_ppv_events(owner_id,workspace_id,creator_id,binding,event_id,fan_id,message_id,amount_cents,occurred_at,ingested_at,provider_contract,event_hash,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,workspace_id,creator_id,binding,event_id) DO NOTHING RETURNING event_id',[...values,value.eventId,value.fanId,value.messageId,value.amountCents,value.occurredAt,value.ingestedAt,value.contract,hash,scope.actorId],signal);assert(result.affected<=1&&result.rows.length===result.affected);return {written:result.affected};
  },
 };
}
