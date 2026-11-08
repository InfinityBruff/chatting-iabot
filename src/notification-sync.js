export const reviewSections=['sidebar','all','subscribed','purchases','tip','commented','mentioned','favorited','message','deactivated_media'];
export function cloudSections(state){return Object.fromEntries(reviewSections.map(k=>[k,[...new Set(state.sections?.[k]||state.reviewed||[])]]))}
export function mergeReviewState(local,remote){const a=cloudSections(local),b=cloudSections(remote);return {baseline:remote.baseline,reviewed:[],sections:Object.fromEntries(reviewSections.map(k=>[k,[...new Set([...a[k],...b[k]])]]))}}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const invalid=()=>Object.assign(Error('No se pudo comprobar la sincronización de avisos.'),{status:503});
function checkedSections(value){
 if(!object(value)||Object.keys(value).some(key=>!reviewSections.includes(key)))throw invalid();
 for(const ids of Object.values(value))if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||id.length<1||id.length>100))throw invalid();
 return cloudSections({sections:value});
}
export function reviewDelta(local,acknowledged){
 const before=acknowledged?cloudSections(acknowledged):{},after=cloudSections(local);
 return Object.fromEntries(reviewSections.map(key=>{const seen=new Set(before[key]||[]);return[key,after[key].filter(id=>!seen.has(id))]}).filter(([,ids])=>ids.length));
}
function rpcFailure(error,status){
 const code=error?.code;if(code==='PGRST202')return Object.assign(Error('Sincronización compacta todavía no publicada.'),{code,status:404});
 const denied=code==='42501'||[401,403].includes(status),retry=Number(error?.retryAfter),failure=Object.assign(Error(denied?'No tienes acceso a la revisión de esta modelo.':'No se pudo sincronizar la revisión entre dispositivos.'),{code:denied?'42501':'REVIEW_SYNC_FAILED',status:denied?403:Number(status)||503});
 if(failure.status===429)failure.retryAfter=Number.isFinite(retry)&&retry>0?Math.min(86400,Math.ceil(retry)):60;
 return failure;
}
export function createReviewSyncTransport(client,{actor,workspace}){
 return {
  async batch(entries){
   const {data,error,status}=await client.rpc('bruff_notification_sync_batch',{w:workspace,entries});if(error)throw rpcFailure(error,Number(status)||Number(error.status));
   if(!exact(data,['actorId','workspaceId','models'])||data.actorId!==actor||data.workspaceId!==workspace||!Array.isArray(data.models))throw Object.assign(invalid(),{code:'42501',status:403});return data.models;
  },
  async legacy(id,baseline,sections){
   const {data,error,status}=await client.rpc('bruff_notification_sync',{w:workspace,c:id,initial_baseline:baseline,review_sections:sections});if(error)throw rpcFailure(error,Number(status)||Number(error.status));
   if(!data||!natural(data.baseline))throw invalid();return{baseline:data.baseline,sections:checkedSections(data.sections),reviewed:[]};
  },
 };
}
function checkedRows(rows,sent,acknowledged){
 if(!Array.isArray(rows)||rows.length!==sent.length)throw invalid();const wanted=new Map(sent.map(item=>[item.creatorId,item])),seen=new Set();
 return rows.map(row=>{
  const request=wanted.get(row?.creatorId);if(!request||seen.has(row.creatorId))throw invalid();seen.add(row.creatorId);
  if(row.denied===true){if(!exact(row,['creatorId','denied']))throw invalid();return row}
  if(typeof row.unchanged!=='boolean'||!exact(row,['creatorId','baseline','version','unchanged',...(!row.unchanged?['sections']:[])])||!natural(row.baseline)||!natural(row.version)||row.version<1)throw invalid();
  if(row.unchanged){const ack=acknowledged.get(row.creatorId);if(!ack||request.knownVersion!==row.version||ack.baseline!==row.baseline||Object.keys(request.delta).length)throw invalid();return row}
  const sections=checkedSections(row.sections);for(const [key,ids]of Object.entries(request.delta))if(ids.some(id=>!sections[key].includes(id)))throw invalid();
  return{...row,sections};
 });
}
export function startReviewSync({ids,sync,syncBatch,read,write,status,visible=()=>true,interval=20000,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
 let stopped=false,timer,running=false,again=false,legacy=typeof syncBatch!=='function',retryUntil=0;
 const versions=new Map(),acknowledged=new Map();
 const report=(id,error)=>{if(error?.status===429)retryUntil=Math.max(retryUntil,now()+Math.max(1,error.retryAfter||60)*1000);if([401,403].includes(error?.status)||error?.code==='42501'){versions.delete(id);acknowledged.delete(id)}status(id,'No se pudo sincronizar la revisión entre dispositivos. Se reintentará automáticamente.',error)};
 async function legacyCycle(){for(const id of ids){if(stopped||!visible())return;try{const local=read(id),remote=await sync(id,local.baseline,cloudSections(local));if(stopped)return;write(id,mergeReviewState(read(id),remote));status(id,'')}catch(error){if(stopped)return;report(id,error);if(error?.status===429)return}}}
 async function tick(){
  if(stopped||!ids.length||!visible())return;if(running){again=true;return}if(now()<retryUntil){cancel(timer);timer=schedule(tick,retryUntil-now());return}running=true;
  try{
   if(legacy){await legacyCycle();return}
   const sent=ids.map(id=>{const local=read(id);if(!natural(local?.baseline))throw invalid();const delta=reviewDelta(local,acknowledged.get(id));checkedSections(delta);return{creatorId:id,initialBaseline:local.baseline,knownVersion:versions.get(id)??null,delta}});
   let response;try{response=await syncBatch(sent)}catch(error){
    // A missing RPC has not executed any SQL, so this is the only safe staged
    // fallback. Network errors, denials and ambiguous failures never dual-write.
    if(error?.code==='PGRST202'&&!stopped){legacy=true;await legacyCycle();return}throw error;
   }
   if(stopped)return;const rows=checkedRows(response,sent,acknowledged);
   for(const row of rows){
    if(stopped)return;const id=row.creatorId;
    if(row.denied){report(id,Object.assign(Error('No tienes acceso a esta modelo.'),{code:'42501',status:403}));continue}
    versions.set(id,row.version);if(!row.unchanged){const remote={baseline:row.baseline,reviewed:[],sections:row.sections};acknowledged.set(id,remote);write(id,mergeReviewState(read(id),remote))}
    status(id,'');
   }
  }catch(error){if(!stopped)for(const id of ids)report(id,error)}
  finally{running=false;if(!stopped){cancel(timer);timer=schedule(tick,Math.max(again?0:interval,retryUntil-now()));again=false}}
 }
 tick();return {refresh(){cancel(timer);tick()},stop(){stopped=true;cancel(timer);versions.clear();acknowledged.clear()}};
}
