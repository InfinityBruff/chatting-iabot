import {summarizeScriptProgress} from './progress.js';

export const CATALOG_PROPOSAL_POLICY='bruff-catalog-proposal-v1';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const id=x=>typeof x==='string'&&/^[1-9]\d{0,23}$/u.test(x);
const name=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x===x.trim()&&!/[\u0000-\u001f\u007f]/u.test(x);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const invalid=()=>Object.assign(Error('No se pudo comprobar la selección del catálogo.'),{code:'MEMORY_RECOMMENDATION',status:503});
const selection=()=>Object.assign(Error('El archivo o la carpeta no pertenecen al catálogo de esta modelo.'),{code:'MEMORY_SELECTION',status:400});

function stable(value,depth=0){
 if(depth>20)throw invalid();
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(item=>stable(item,depth+1));
 if(record(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null))return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key],depth+1)]));
 throw invalid();
}
async function fingerprint(value){
 const bytes=new TextEncoder().encode(JSON.stringify(stable(value)));if(bytes.length>2*1024*1024)throw invalid();
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

// Previously authorized catalog and same-scope observations only. This chooses
// inventory metadata, never a commercial level, purchase or generated message.
export async function createCatalogRecommendation({catalog,observations,scope,folderId,mediaId}={}){
 if(!record(scope)||!['ownerId','actorId','workspaceId','creatorId'].every(key=>uuid(scope[key]))||typeof scope.binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,150}$/u.test(scope.binding)||!id(scope.fanId)||!hash(scope.batchHash)||!record(catalog)||catalog.ownerId!==scope.ownerId||catalog.workspaceId!==scope.workspaceId||catalog.creatorId!==scope.creatorId||catalog.batchHash!==scope.batchHash||!Array.isArray(observations)||observations.length>5000)throw invalid();
 if(folderId!==undefined&&!name(folderId)||mediaId!==undefined&&(!id(mediaId)||folderId===undefined))throw selection();
 // Reuse strict identity, folder mapping, observation and duplicate validation.
 summarizeScriptProgress({catalog,observations});
 const folders=new Map(catalog.folders.map(folder=>[folder.id,folder]));
 for(const folder of folders.values())for(const item of folder.items)if(item.referencePriceCents!==undefined&&item.referencePriceCents!==null&&(!Number.isSafeInteger(item.referencePriceCents)||item.referencePriceCents<0))throw invalid();
 const unique=new Map();
 for(const row of observations){
  const value={folderId:row.folderId,mediaId:row.mediaId,messageId:row.messageId,createdAt:new Date(row.createdAt).toISOString(),kind:row.kind,priceCents:row.priceCents,openedReported:row.openedReported,paidConfirmed:false};
  unique.set(JSON.stringify([value.folderId,value.mediaId,value.messageId]),value);
 }
 const semantic=[...unique.values()].sort((a,b)=>{const left=JSON.stringify(stable(a)),right=JSON.stringify(stable(b));return left<right?-1:left>right?1:0});
 let folder;
 if(folderId!==undefined){folder=folders.get(folderId);if(!folder)throw selection()}
 else{
  // Ties retain inventory order; source timestamps do not establish script order.
  let latest=-Infinity;
  for(const candidate of folders.values()){
   const dates=semantic.filter(row=>row.folderId===candidate.id).map(row=>Date.parse(row.createdAt)),at=dates.length?Math.max(...dates):-Infinity;
   if(at>latest){latest=at;folder=candidate}
  }
  folder??=catalog.folders[0];
 }
 if(!folder)return null;
 const observedIds=new Set(semantic.filter(row=>row.folderId===folder.id).map(row=>row.mediaId));
 const item=mediaId===undefined?folder.items.find(row=>row.type==='photo'&&!observedIds.has(row.id))||folder.items.find(row=>row.type==='video'&&!observedIds.has(row.id)):folder.items.find(row=>row.id===mediaId);
 if(!item){if(mediaId!==undefined)throw selection();return null}
 const matches=semantic.filter(row=>row.folderId===folder.id&&row.mediaId===item.id),observedCount=new Set(matches.map(row=>row.messageId)).size;
 const pendingOfferCount=new Set(semantic.filter(row=>row.folderId===folder.id&&row.kind==='offered').map(row=>row.messageId)).size;
 const priceCents=item.type==='photo'?0:item.type==='video'?item.referencePriceCents??null:null;
 const reason=[item.type==='photo'?'Foto gratuita según la instrucción del propietario.':priceCents===null?'El catálogo no informa un precio de referencia para este archivo.':'Precio de referencia del catálogo, sujeto a revisión humana.',observedCount?'Este archivo ya aparece en mensajes observados.':'No aparece en los mensajes observados; el historial puede ser parcial.',pendingOfferCount?'Hay ofertas registradas sin pago confirmado.':'No se afirma ningún pago ni desbloqueo.', 'El orden de inventario no acredita un nivel comercial.'].join(' ');
 const proposal={policyVersion:CATALOG_PROPOSAL_POLICY,folderId:folder.id,mediaId:item.id,priceCents,currency:'USD',reviewRequired:true,orderConfirmed:false,paidConfirmed:false,reason,observedCount,pendingOfferCount};
 const identity=Object.fromEntries(['ownerId','actorId','workspaceId','creatorId','binding','fanId','batchHash'].map(key=>[key,scope[key]]));
 return {id:await fingerprint({scope:identity,catalog,observations:semantic,selection:proposal}),...proposal};
}
