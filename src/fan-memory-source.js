// Fixed BRUFF endpoint only. Private memory is scoped and projected before UI use.
const id=x=>typeof x==='string'&&/^[1-9][0-9]{0,23}$/u.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const text=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x);
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const failure=(message='No se pudo comprobar la memoria de este fan.',status=503)=>Object.assign(Error(message),{status});
export function validateFanMemory(value,scope){
 if(value?.actorId!==scope.actor||value.workspaceId!==scope.workspace||value.creatorId!==scope.account||value.fanId!==scope.fanId||!/^acct_[A-Za-z0-9_-]+$/u.test(value.binding||''))throw failure('La memoria no corresponde a esta sesión, modelo y fan.',403);
 if(!natural(value.version)||!(/^[a-f0-9]{64}$/u).test(value.contextRevision||'')||!Array.isArray(value.items)||value.items.length>1000)throw failure();
 const keys=new Set(),items=value.items.map(item=>{
  if(!item||!text(item.key,80)||keys.has(item.key)||!['preferred_name','language','interests','availability','pending_question','commitment','personal_context'].includes(item.category)||!text(item.value,1000)||!['pending','confirmed'].includes(item.status)||!['analysis','manual'].includes(item.origin)||typeof item.pinned!=='boolean'||!id(item.source?.messageId)||!text(item.source.quote,1000)||!date(item.source.at)||!['fan','model'].includes(item.source.author))throw failure();
  keys.add(item.key);return {key:item.key,category:item.category,value:item.value,status:item.status,origin:item.origin,pinned:item.pinned,source:{messageId:item.source.messageId,quote:item.source.quote,at:item.source.at,author:item.source.author}};
 });
 const c=value.coverage;
 if(!c||typeof c.historyComplete!=='boolean'||!(c.cursor===null||text(c.cursor,2048))||!natural(c.pages)||!natural(c.messagesObserved)||typeof c.contextLimited!=='boolean'||!(c.recentCheckedAt===null||date(c.recentCheckedAt))||!(c.historyCheckedAt===null||date(c.historyCheckedAt))||c.historyComplete&&c.cursor!==null)throw failure();
 return {actorId:value.actorId,workspaceId:value.workspaceId,creatorId:value.creatorId,fanId:value.fanId,binding:value.binding,version:value.version,contextRevision:value.contextRevision,items,coverage:{historyComplete:c.historyComplete,cursor:c.cursor,pages:c.pages,messagesObserved:c.messagesObserved,contextLimited:c.contextLimited,recentCheckedAt:c.recentCheckedAt,historyCheckedAt:c.historyCheckedAt}};
}
export function createFanMemorySource(client,scope){
 if(!uuid(scope?.actor)||!uuid(scope.workspace)||!uuid(scope.account)||!id(scope.fanId)||scope.canRead!==true)throw failure('Abre una conversación autorizada.',403);
 const call=async(operation,extra={},signal)=>{
  signal?.throwIfAborted();const {data,error}=await client.functions.invoke('bruff-memory',{body:{operation,workspace_id:scope.workspace,creator_id:scope.account,conversation_id:scope.fanId,...extra},signal});signal?.throwIfAborted();
  if(error){const status=error.context?.status||error.status||503;if([401,403].includes(status))throw failure('Tu sesión o los permisos de esta modelo han cambiado.',status);if(status===409)throw failure('La memoria cambió en otra sesión. Actualiza antes de editar.',409);if(status===429)throw failure('El proveedor pide esperar. El recorrido se ha detenido conservando el avance.',429);throw failure()}
  return validateFanMemory(data,scope);
 };
 return {read:signal=>call('fan_memory_read',{},signal),sync:(scan,signal)=>{if(!['recent','older'].includes(scan))throw failure('Recorrido no válido.',400);return call('fan_memory_sync',{scan},signal)},edit:(edit,signal)=>{if(!edit||!text(edit.key,80)||!['confirm','correct','pin','delete'].includes(edit.action)||!natural(edit.expected_version)||edit.action==='correct'&&!text(edit.value,1000))throw failure('Revisa el cambio de memoria.',400);return call('fan_memory_edit',{edit:{key:edit.key,action:edit.action,expected_version:edit.expected_version,...(edit.action==='correct'?{value:edit.value}:{})}},signal)}};
}
