export const INBOX_SPEND_TTL=60000;
export const spendFanId=fan=>String(fan.userId??fan.id);
export const spendTime=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
export function spendIsFresh(fan,now=Date.now(),ttl=INBOX_SPEND_TTL){const at=spendTime(fan?.spendCheckedAt);return typeof fan?.spend?.available==='boolean'&&Number.isFinite(at)&&now>=at&&now-at<ttl}
export function orderedSpendIds(rows,visibleIds){
 const known=new Set(rows.map(spendFanId));
 return [...new Set(visibleIds??rows.map(spendFanId))].filter(id=>typeof id==='string'&&/^\d{1,24}$/.test(id)&&known.has(id));
}
export function mergeInboxSpendPage(previous,values,checkedAt){
 if(!previous?.data?.conversations)return previous;
 const amounts=new Map(values.map(row=>[row.id,row.spend])),stamp=spendTime(checkedAt);let changed=false;
 if(!Number.isFinite(stamp))return previous;
 const conversations=previous.data.conversations.map(fan=>{const id=spendFanId(fan);if(!amounts.has(id)||spendTime(fan.spendCheckedAt)>stamp)return fan;changed=true;return {...fan,spend:amounts.get(id),spendCheckedAt:checkedAt}});
 return changed?{...previous,data:{...previous.data,conversations}}:previous;
}
// One authorized model, one replaceable read batch. Cached rows survive scrolling;
// a superseded viewport cannot hold up the newly visible fans.
export function createInboxSpendReader({workspace,account,request,onValue,onDenied=()=>{},now=Date.now,schedule=setTimeout,cancel=clearTimeout,visible=()=>true,cacheEpoch=()=>0,ttl=INBOX_SPEND_TTL}){
 let active=false,timer,wakeAt=Infinity,version=0,index=new Map(),inputRows=null,visibleIds=[],viewportActive=true,lastToken,tokenSeen=false,forced=new Set(),targets=[],checked=new Set(),retryAt=0,failures=0,denied=false,firstBatch=true,wave=0,selectedFan=null,job=null;
 let snapshot={busy:false,waiting:false,error:'',checked:0,total:0,done:true,refreshToken:undefined};const listeners=new Set();
 const emit=patch=>{snapshot={...snapshot,...patch,refreshToken:lastToken,checked:checked.size,total:targets.length,done:forced.size===0&&!job&&checked.size===targets.length};for(const listener of listeners)listener()};
 const ordered=ids=>[...new Set(ids)].filter(id=>typeof id==='string'&&/^\d{1,24}$/.test(id)&&index.has(id));
 const needed=()=>{
  if(!viewportActive)return [];
  const shown=ordered(visibleIds).filter(id=>forced.has(id)||!spendIsFresh(index.get(id),now(),ttl));
  return [...new Set([...shown,...targets.filter(id=>forced.has(id)&&index.has(id))])];
 };
 function wake(delay=400){if(!active||job||denied)return;const next=now()+Math.max(delay,retryAt-now());if(timer!==undefined&&wakeAt<=next)return;cancel(timer);wakeAt=next;timer=schedule(()=>{timer=undefined;wakeAt=Infinity;return tick()},Math.max(0,next-now()))}
 function abortBatch(){if(!job)return;const previous=job;job=null;previous.controller.abort();if(active)emit({busy:false,waiting:false})}
 async function tick(){
  if(!active||job||denied)return;
  if(!visible()||!viewportActive){wake(2000);return}
  if(now()<retryAt){wake(retryAt-now());return}
  const batch=needed().slice(0,20);
  if(!batch.length){emit({busy:false,waiting:false,error:forced.size?'La lista cambió; vuelve a actualizar los fans que faltan.':''});const ids=ordered(visibleIds);if(!ids.length)return;const times=ids.map(id=>spendTime(index.get(id).spendCheckedAt)+ttl-now()).filter(Number.isFinite);wake(times.length?Math.max(1000,Math.min(...times)):ttl);return}
  const item={batch,version,epoch:cacheEpoch(),wave,controller:new AbortController(),started:false};job=item;
  const owned=()=>active&&version===item.version&&job===item;
  const current=()=>owned()&&!item.controller.signal.aborted&&item.epoch===cacheEpoch();
  const priority=firstBatch?'fan-visible':'background';emit({busy:true,waiting:false,error:''});
  try{
   const response=await request(workspace,'fan_spend_batch',{creator_id:account,user_ids:batch},{signal:item.controller.signal,onStart:()=>{if(current())item.started=true},active:()=>{if(!current()||!visible()||!viewportActive)return false;const wanted=new Set(needed());return batch.some(id=>wanted.has(id))},priority});
   if(!current())return;
   if(wave===item.wave)firstBatch=false;
   if(!Array.isArray(response?.data?.fans))throw Error('No se recibió un resumen de gasto válido.');
   const values=response.data.fans.filter(row=>batch.includes(row?.id)&&row.spend&&typeof row.spend.available==='boolean'),unique=new Map(values.map(row=>[row.id,row])),stamp=new Date(now()).toISOString();
   for(const [id,value] of unique){const old=index.get(id);if(old&&!(spendTime(old.spendCheckedAt)>spendTime(stamp)))index.set(id,{...old,spend:value.spend,spendCheckedAt:stamp});if(forced.delete(id))checked.add(id)}
   if(unique.size)onValue([...unique.values()],stamp);
   if(unique.size!==batch.length)throw Error('Faltan importes de algunos fans; se conservan los datos y se reintentará.');
   failures=0;retryAt=0;emit({error:'',waiting:false});
  }catch(error){if(!owned()||item.epoch!==cacheEpoch())return;
   if(error?.name==='AbortError'||item.controller.signal.aborted){emit({error:'',waiting:false})}
   else if(error?.status===401||error?.status===403){denied=true;index.clear();inputRows=null;forced.clear();emit({error:'No tienes acceso al gasto de esta modelo.',waiting:false});onDenied()}
   else{if(wave===item.wave&&item.started)firstBatch=false;failures++;const limited=error?.status===429,seconds=Number(error?.retryAfter);retryAt=now()+(limited?(Number.isFinite(seconds)&&seconds>0?seconds:60)*1000:Math.min(60000,2000*2**Math.min(failures,5)));emit({waiting:limited,error:limited?'':error?.message||'No se pudo actualizar el gasto.'})}
  }finally{if(owned()){job=null;if(item.epoch!==cacheEpoch()){index.clear();inputRows=null;emit({busy:false,waiting:false})}else emit({busy:false});wake(Math.max(400,retryAt-now()))}}
 }
 return {
  getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  setInput(nextRows,nextVisibleIds,{refreshToken,refreshAll=false,selectedId=null,viewportActive:nextActive=true}={}){
   if(nextRows!==inputRows){const old=index;index=new Map(nextRows.map(row=>{const id=spendFanId(row),saved=old.get(id),savedAt=spendTime(saved?.spendCheckedAt),incomingAt=spendTime(row.spendCheckedAt);return [id,Number.isFinite(savedAt)&&(!Number.isFinite(incomingAt)||savedAt>incomingAt)?{...row,spend:saved.spend,spendCheckedAt:saved.spendCheckedAt}:row]}));inputRows=nextRows}
   const nextIds=ordered(nextVisibleIds??[...index.keys()]),manual=tokenSeen&&refreshToken!==lastToken,selectionChanged=selectedId!==selectedFan,demandChanged=JSON.stringify(nextIds)!==JSON.stringify(visibleIds);
   if(selectionChanged||manual||demandChanged){firstBatch=true;wave++}visibleIds=nextIds;selectedFan=selectedId;viewportActive=nextActive;
   tokenSeen=true;lastToken=refreshToken;
   if(manual){targets=ordered(refreshAll?[...visibleIds,...index.keys()]:visibleIds);forced=new Set(targets);checked=new Set()}
   if(job){const windowIds=visibleIds.filter(id=>id!==selectedFan),retained=job.batch.some(id=>id!==selectedFan&&windowIds.includes(id)),selectedMissing=selectionChanged&&selectedFan&&needed().includes(selectedFan)&&!job.batch.includes(selectedFan);
    if(!viewportActive||!visible()||selectedMissing||demandChanged&&!retained&&!(windowIds.length===0&&job.batch.includes(selectedFan)))abortBatch();
   }
   emit(manual?{error:''}:{});wake();
  },
  recheckVisibility(){if(!visible()||!viewportActive)abortBatch();wake(visible()&&viewportActive?0:2000)},
  start(){if(active)return;active=true;denied=false;version++;wake()},
  stop(){active=false;version++;cancel(timer);timer=undefined;wakeAt=Infinity;abortBatch();index.clear();inputRows=null;forced.clear()},
 };
}
