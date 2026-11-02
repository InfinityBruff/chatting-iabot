import {filterSpend} from './spend-filter.js';
import {filterFinancialAudience} from './financial-audience.js';
export class AudienceError extends Error {}
export class AudiencePending extends AudienceError { constructor(message,retryAfter=5){super(message);this.retryAfter=retryAfter} }
// Server-only audience preparation. Reads provider data; never sends or activates.
const fanId=value=>typeof value==='string'&&/^[0-9]{1,24}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
export async function resolveMassAudience({config,binding,authorize,providerKey,fetcher=fetch,maxPages=200,maxFans=100000,checkpoint=null,saveCheckpoint=async()=>{},pageBudget=200,financialContext}){
 if(config?.trigger!=='mass'||!['all','selected','collections'].includes(config.bulk?.audience))throw new AudienceError('Audiencia de masivo inválida');
 if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]+$/.test(binding))throw new AudienceError('Modelo sin conexión');
 const ensure=async()=>{if(await authorize()!==binding)throw new AudienceError('Acceso retirado o conexión modificada')};
 const read=async path=>{
  await ensure();
  const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/'+path,{method:'GET',headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(response.status===429){const raw=response.headers?.get('retry-after');const seconds=/^\d+$/.test(raw||'')?Number(raw):Math.ceil((Date.parse(raw)-Date.now())/1000);throw new AudiencePending('El proveedor limita las consultas. Se conserva el avance.',Math.min(86400,Math.max(30,Number.isFinite(seconds)?seconds:60)))}
  if(!response.ok)throw new AudienceError('No se pudo completar la audiencia');
  const data=await response.json();await ensure();return data;
 };
 let lastCheckpoint=checkpoint;const persist=async value=>{await saveCheckpoint(value);lastCheckpoint=value};
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
  if(checkpoint&&(!Array.isArray(checkpoint.ids)||checkpoint.ids.some(id=>!fanId(id))||!Array.isArray(checkpoint.cursors)||checkpoint.cursors.some(c=>typeof c!=='string'||!c||c.length>2048)||!Number.isSafeInteger(checkpoint.pages)||checkpoint.pages<0||typeof checkpoint.complete!=='boolean'||(checkpoint.cursor!==null&&typeof checkpoint.cursor!=='string')))throw new AudienceError('Avance guardado inválido');
  const cursors=new Set(checkpoint?.cursors||[]);let cursor=checkpoint?.cursor||null,complete=checkpoint?.complete===true;
  for(const id of checkpoint?.ids||[])add(id);
  const startPage=checkpoint?.pages||0;
  for(let page=startPage;!complete&&page<maxPages;page++){
   if(page-startPage>=pageBudget)throw new AudiencePending('Avance guardado. La comprobación continuará desde la última página.',5);
   const params=new URLSearchParams({type:'all',pages:'1'});if(cursor)params.set('cursor',cursor);
   const data=await read('fans?'+params);
   if(!Array.isArray(data.fans)||typeof data.hasMore!=='boolean')throw new AudienceError('Directorio incompleto');
   for(const row of data.fans){const id=fanId(row.id);if(!id)throw new AudienceError('Identificador de fan inválido');add(id)}
   if(!data.hasMore){complete=true;await persist({ids:[...included],cursors:[...cursors],cursor,pages:page+1,complete:true});break}
   if(typeof data.cursor!=='string'||!data.cursor||data.cursor.length>2048||cursors.has(data.cursor))throw new AudienceError('No se puede continuar la paginación de fans');
   cursors.add(data.cursor);cursor=data.cursor;
   await persist({ids:[...included],cursors:[...cursors],cursor,pages:page+1,complete:false});
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
 const directoryIds=[...included];const before=included.size;for(const id of excluded)included.delete(id);
 let filtered=0;
 if(['agencySpend','modelPurchase','agencyPurchase'].some(k=>config.audience?.[k]?.enabled)){
  if(!financialContext)throw new AudienceError('Falta verificar el ámbito financiero de la agencia');
  let result;try{result=await filterFinancialAudience({ids:[...included],audience:config.audience,...financialContext,checkpoint:lastCheckpoint,save:async financial=>persist({...lastCheckpoint,ids:lastCheckpoint?.ids||directoryIds,complete:true,financial})})}catch(e){if(e instanceof AudienceError)throw e;throw new AudienceError(e.message)}
  if(!result.complete)throw new AudiencePending('Histórico financiero: avance guardado. Continuará automáticamente.',5);
  const wanted=new Set(result.ids);filtered+=included.size-wanted.size;for(const id of included)if(!wanted.has(id))included.delete(id);
 }
 if(config.audience?.modelSpend?.enabled||config.audience?.buyingPower?.enabled){
  let result;try{result=await filterSpend({ids:[...included],rule:config.audience.modelSpend,stars:config.audience.buyingPower,checkpoint:lastCheckpoint,read,save:async spendFilter=>persist({...lastCheckpoint,ids:lastCheckpoint?.ids||directoryIds,complete:true,spendFilter})});}catch(e){if(e instanceof AudienceError)throw e;throw new AudienceError(e.message)}
  if(!result.complete)throw new AudiencePending('Filtro de gasto: avance guardado. Continuará automáticamente.',5);
  const wanted=new Set(result.ids);filtered+=included.size-wanted.size;for(const id of included)if(!wanted.has(id))included.delete(id);
 }
 await ensure();
 return {complete:true,filteredCount:filtered,recipientIds:[...included].sort(),includedCount:before,excludedCount:before-included.size-filtered,count:included.size,observedAt:new Date().toISOString(),coverage:config.bulk.audience==='collections'?'selected-collections':'fans-directory',deliveryEligibility:'OnlyFans determina la elegibilidad al enviar. Esto es una audiencia verificada, no una garantía de entrega.'};
}
