export class AudienceError extends Error {}
// Server-only audience preparation. Reads provider data; never sends or activates.
const fanId=value=>typeof value==='string'&&/^[0-9]{1,24}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
export async function resolveMassAudience({config,binding,authorize,providerKey,fetcher=fetch,maxPages=200,maxFans=100000}){
 if(config?.trigger!=='mass'||!['all','selected','collections'].includes(config.bulk?.audience))throw new AudienceError('Audiencia de masivo inválida');
 if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]+$/.test(binding))throw new AudienceError('Modelo sin conexión');
 const ensure=async()=>{if(await authorize()!==binding)throw new AudienceError('Acceso retirado o conexión modificada')};
 const read=async path=>{
  await ensure();
  const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/'+path,{method:'GET',headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new AudienceError(response.status===429?'El proveedor limita las consultas. Reintenta más tarde.':'No se pudo completar la audiencia');
  const data=await response.json();await ensure();return data;
 };
 const lists=new Map();
 const members=async id=>{
  if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))throw new AudienceError('Colección inválida');
  if(lists.has(id))return lists.get(id);
  const row=await read('lists/'+encodeURIComponent(id));
  if(String(row.id)!==id||!Array.isArray(row.users)||!Number.isSafeInteger(row.usersCount)||row.usersCount<0)throw new AudienceError('Colección no verificable');
  const ids=row.users.map(x=>fanId(x.id));if(ids.some(x=>!x))throw new AudienceError('Colección contiene identificadores inválidos');
  const unique=[...new Set(ids)];if(unique.length!==row.usersCount)throw new AudienceError('El proveedor devolvió una colección incompleta; no se utilizará para enviar');
  lists.set(id,unique);return unique;
 };
 const included=new Set();
 const add=id=>{included.add(id);if(included.size>maxFans)throw new AudienceError('La audiencia requiere procesamiento por lotes; no se devolverá una selección parcial')};
 if(config.bulk.audience==='collections'){
  if(!Array.isArray(config.bulk.listIds)||!config.bulk.listIds.length||config.bulk.listIds.length>100)throw new AudienceError('Selecciona colecciones válidas');
  for(const id of config.bulk.listIds)for(const fan of await members(id))add(fan);
 }else{
  // Selected IDs are intersected with the complete account directory, not trusted from the client.
  const cursors=new Set();let cursor=null,complete=false;
  for(let page=0;page<maxPages;page++){
   const params=new URLSearchParams({type:'all',pages:'1'});if(cursor)params.set('cursor',cursor);
   const data=await read('fans?'+params);
   if(!Array.isArray(data.fans)||typeof data.hasMore!=='boolean')throw new AudienceError('Directorio incompleto');
   for(const row of data.fans){const id=fanId(row.id);if(!id)throw new AudienceError('Identificador de fan inválido');add(id)}
   if(!data.hasMore){complete=true;break}
   if(typeof data.cursor!=='string'||!data.cursor||data.cursor.length>2048||cursors.has(data.cursor))throw new AudienceError('No se puede continuar la paginación de fans');
   cursors.add(data.cursor);cursor=data.cursor;
  }
  if(!complete)throw new AudienceError('No se ha completado el directorio; no se devolverá una audiencia parcial');
  if(config.bulk.audience==='selected'){
   const selected=config.bulk.recipients;
   if(!Array.isArray(selected)||!selected.length||selected.length>10000||selected.some(id=>!fanId(id)||!included.has(id)))throw new AudienceError('Hay fans seleccionados que no se han podido verificar en esta modelo');
   const wanted=new Set(selected);for(const id of included)if(!wanted.has(id))included.delete(id);
  }
 }
 const excluded=new Set();if(!Array.isArray(config.audience?.excludeLists)||config.audience.excludeLists.length>100)throw new AudienceError('Exclusiones inválidas');
 for(const list of config.audience.excludeLists)for(const id of await members(list))excluded.add(id);
 const before=included.size;for(const id of excluded)included.delete(id);
 await ensure();
 return {complete:true,recipientIds:[...included].sort(),includedCount:before,excludedCount:before-included.size,count:included.size,observedAt:new Date().toISOString(),coverage:config.bulk.audience==='collections'?'selected-collections':'fans-directory',deliveryEligibility:'OnlyFans determina la elegibilidad al enviar. Esto es una audiencia verificada, no una garantía de entrega.'};
}
