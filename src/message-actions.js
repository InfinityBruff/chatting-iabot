const validId=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value));
export function replyTarget(message,name='Fan'){
 const id=String(message?.id??'');
 if(!validId(id)||message?.isFromMe!==false||message.delivery)return null;
 return {id,name:String(name).slice(0,100),text:String(message.text||'Contenido adjunto').slice(0,280)};
}
export function restoreReply(value){
 if(!value||!validId(value.id))return null;
 return {id:value.id,name:String(value.name||'Fan').slice(0,100),text:String(value.text||'Contenido adjunto').slice(0,280)};
}
export function createMessageLikes({request,onConfirmed=()=>{},now=Date.now,uuid=()=>crypto.randomUUID()}){
 let state={},alive=true,generation=0;const listeners=new Set(),locks=new Set();
 const publish=next=>{if(!alive)return;state=next;for(const listener of listeners)listener()};
 async function toggle(message){
  const id=String(message?.id??'');if(!alive||!validId(id)||message.isFromMe!==false||message.delivery||locks.has(id))return;
  const previous=state[id],retry=previous?.phase==='uncertain',retryIntent=retry||previous?.phase==='error';
  const current=previous?.phase==='confirmed'?previous.desired:message.isLiked===true;
  const action={desired:retryIntent?previous.desired:!current,previous:retryIntent?previous.previous:current,actionId:retry?previous.actionId:uuid(),startedAt:now(),phase:'pending',error:''};
  const version=generation,isCurrent=()=>alive&&generation===version;locks.add(id);publish({...state,[id]:action});
  try{
   const result=await request({message_id:id,liked:action.desired,action_id:action.actionId});
   if(!isCurrent())return;
   if(String(result?.data?.id)!==id||result?.data?.isLiked!==action.desired)throw Error('No se pudo confirmar el cambio de Me gusta.');
   onConfirmed(id,action.desired);publish({...state,[id]:{...action,phase:'confirmed',confirmedAt:now()}});
  }catch(error){if(isCurrent())publish({...state,[id]:{...action,phase:[400,401,403,404].includes(error?.status)?'error':'uncertain',error:error?.message||'No se pudo confirmar el cambio de Me gusta.'}})}
  finally{if(isCurrent())locks.delete(id)}
 }
 function reconcile(messages,resultStartedAt,observedIds){
  if(!alive||!Number.isFinite(resultStartedAt))return;
  let next=state;const observed=observedIds===undefined?null:new Set(observedIds||[]),byId=new Map(messages.map(m=>[String(m.id),m]));
  for(const [id,action] of Object.entries(state)){
   if(observed&&!observed.has(id))continue;
   const m=byId.get(id);if(!m||typeof m.isLiked!=='boolean')continue;
   if(action.phase==='confirmed'&&resultStartedAt>action.confirmedAt&&(m.isLiked===action.desired||resultStartedAt-action.confirmedAt>30000)||['uncertain','error'].includes(action.phase)&&resultStartedAt>action.startedAt&&m.isLiked===action.desired){if(next===state)next={...state};delete next[id]}
  }
  if(next!==state)publish(next);
 }
 return {start:()=>{alive=true},toggle,reconcile,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},getSnapshot:()=>state,dispose:()=>{alive=false;generation++;locks.clear();listeners.clear()}};
}
