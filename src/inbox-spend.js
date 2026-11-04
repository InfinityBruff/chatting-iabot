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
// One scoped reader survives list updates. It retains a single in-flight batch,
// selected-first order and confirmed freshness without restarting after each row.
export function createInboxSpendReader({workspace,account,request,onValue,onDenied=()=>{},now=Date.now,schedule=setTimeout,cancel=clearTimeout,visible=()=>true,ttl=INBOX_SPEND_TTL}){
 let active=false,running=false,timer,version=0,rows=[],visibleIds=[],lastToken,tokenSeen=false,forced=new Set(),targets=[],checked=new Set(),retryAt=0,failures=0,denied=false,firstBatch=true,wave=0,selectedFan=null;
 let snapshot={busy:false,waiting:false,error:'',checked:0,total:0,done:true,refreshToken:undefined};const listeners=new Set();
 const emit=patch=>{snapshot={...snapshot,...patch,refreshToken:lastToken,checked:checked.size,total:targets.length,done:forced.size===0&&!running&&checked.size===targets.length};for(const listener of listeners)listener()};
 const byId=()=>new Map(rows.map(row=>[spendFanId(row),row]));
 const needed=()=>{const map=byId();return [...new Set([...targets.filter(id=>forced.has(id)),...orderedSpendIds(rows,visibleIds).filter(id=>!spendIsFresh(map.get(id),now(),ttl))])].filter(id=>map.has(id))};
 function wake(delay=400){if(!active||running||denied)return;cancel(timer);timer=schedule(tick,Math.max(delay,retryAt-now()))}
 async function tick(){
  if(!active||running||denied)return;
  if(!visible()){wake(2000);return}
  if(now()<retryAt){wake(retryAt-now());return}
  const batch=needed().slice(0,20);
  if(!batch.length){firstBatch=true;emit({busy:false,waiting:false,error:forced.size?'La lista cambió; vuelve a actualizar los fans que faltan.':''});const ids=orderedSpendIds(rows,visibleIds);if(!ids.length)return;const map=byId(),times=ids.map(id=>spendTime(map.get(id).spendCheckedAt)+ttl-now()).filter(Number.isFinite);wake(times.length?Math.max(1000,Math.min(...times)):ttl);return}
  running=true;const turn=version,batchWave=wave,priority=firstBatch?'selected':'background';emit({busy:true,waiting:false,error:''});
  const current=()=>active&&version===turn;
  try{
   const response=await request(workspace,'fan_spend_batch',{creator_id:account,user_ids:batch},{active:()=>current()&&visible()&&batch.some(id=>needed().includes(id)),priority});
   if(!current())return;
   if(wave===batchWave)firstBatch=false;
   if(!Array.isArray(response?.data?.fans))throw Error('No se recibió un resumen de gasto válido.');
   const values=response.data.fans.filter(row=>batch.includes(row?.id)&&row.spend&&typeof row.spend.available==='boolean');
   const unique=new Map(values.map(row=>[row.id,row]));const stamp=new Date(now()).toISOString();
   rows=mergeInboxSpendPage({data:{conversations:rows}},[...unique.values()],stamp).data.conversations;
   for(const id of unique.keys()){if(forced.delete(id))checked.add(id)}
   if(unique.size)onValue([...unique.values()],stamp);
   if(unique.size!==batch.length)throw Error('Faltan importes de algunos fans; se conservan los datos y se reintentará.');
   failures=0;retryAt=0;emit({error:'',waiting:false});
  }catch(error){if(!current())return;
   if(error?.name==='AbortError'){emit({error:'',waiting:false})}
   else if(error?.status===401||error?.status===403){if(wave===batchWave)firstBatch=false;denied=true;rows=[];forced.clear();emit({error:'No tienes acceso al gasto de esta modelo.',waiting:false});onDenied()}
   else{if(wave===batchWave)firstBatch=false;failures++;const limited=error?.status===429,seconds=Number(error?.retryAfter);retryAt=now()+(limited?(Number.isFinite(seconds)&&seconds>0?seconds:60)*1000:Math.min(60000,2000*2**Math.min(failures,5)));emit({waiting:limited,error:limited?'':error?.message||'No se pudo actualizar el gasto.'})}
  }finally{if(current()){running=false;emit({busy:false});wake(Math.max(750,retryAt-now()))}}
 }
 return {
  getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  setInput(nextRows,nextVisibleIds,{refreshToken,refreshAll=false,selectedId=null}={}){
   const old=byId();rows=nextRows.map(row=>{const saved=old.get(spendFanId(row)),savedAt=spendTime(saved?.spendCheckedAt),incomingAt=spendTime(row.spendCheckedAt);return Number.isFinite(savedAt)&&(!Number.isFinite(incomingAt)||savedAt>incomingAt)?{...row,spend:saved.spend,spendCheckedAt:saved.spendCheckedAt}:row});
   const nextIds=nextVisibleIds??rows.map(spendFanId),manual=tokenSeen&&refreshToken!==lastToken;
   if(selectedId!==selectedFan||manual){firstBatch=true;wave++}visibleIds=nextIds;selectedFan=selectedId;
   tokenSeen=true;lastToken=refreshToken;
   if(manual){targets=orderedSpendIds(rows,refreshAll?[...visibleIds,...rows.map(spendFanId)]:visibleIds);forced=new Set(targets);checked=new Set()}
   emit(manual?{error:''}:{});wake();
  },
  start(){if(active)return;active=true;denied=false;version++;wake()},
  stop(){active=false;version++;cancel(timer);running=false;rows=[];forced.clear()},
 };
}
