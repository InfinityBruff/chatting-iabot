import {mergePage} from './chat-sync.js';
const abort=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
export function mergeInboxRefresh(previous,page){
 return mergePage(previous,page,'conversations',{append:true,retain:true});
}
export function finishInboxRefresh(previous){
 // Provider pagination isn't an atomic snapshot. A concurrent head read can
 // introduce a new fan between pages, so absence from this scan isn't deletion.
 return previous?{...previous,data:{...previous.data,hasMore:false,cursor:null,_extended:true}}:previous;
}
export function createInboxRefresh({request,onPage=()=>{},onComplete=()=>{},onDenied=()=>{},cacheEpoch=()=>0,maxPages=500,wait=(ms,signal)=>new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(abort())};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve()},ms);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()})}){
 let state={busy:false,waiting:false,error:'',checked:0,pages:0,complete:false},controller=null,disposed=false;
 const listeners=new Set(),publish=patch=>{if(disposed)return;state={...state,...patch};for(const listener of listeners)listener()};
 async function start(){
  if(disposed||controller)return;const active=new AbortController(),epoch=cacheEpoch();controller=active;const signal=active.signal,ids=new Set(),cursors=new Set();let cursor=null,pages=0;
  const current=()=>!disposed&&controller===active&&!signal.aborted;
  publish({busy:true,waiting:false,error:'',checked:0,pages:0,complete:false});
  try{
   while(current()){
    let page;try{page=await request(cursor,{signal,priority:pages?'background':'interactive',active:current})}
    catch(error){if(!current())return;if(error.status===429){publish({waiting:true});await wait(Math.max(1,Number(error.retryAfter)||60)*1000,signal);if(current())publish({waiting:false});continue}throw error}
    if(!current())return;
    if(cacheEpoch()!==epoch)throw Error('El acceso ha cambiado. Vuelve a actualizar cuando termine la verificación de permisos.');
    if(!Array.isArray(page?.data?.conversations))throw Error('El proveedor no devolvió una lista de conversaciones válida.');
    for(const fan of page.data.conversations)ids.add(String(fan.userId??fan.id));pages++;onPage(page);
    publish({checked:ids.size,pages});
    if(page.data.hasMore===false){onComplete([...ids]);publish({complete:true});return}
    if(page.data.hasMore!==true||!page.data.cursor)throw Error('Actualización incompleta: el proveedor no entregó el siguiente cursor.');
    const next=String(page.data.cursor);if(cursors.has(next))throw Error('Actualización incompleta: el proveedor repitió el cursor.');
    if(pages>=maxPages)throw Error('Actualización parcial: se alcanzó el límite de páginas de seguridad. Puedes volver a actualizar.');
    cursors.add(next);cursor=page.data.cursor;
   }
  }catch(error){if(current()){if([401,403].includes(error.status))onDenied();publish({error:error.message||'No se pudieron actualizar todas las conversaciones.'})}}
  finally{if(controller===active){controller=null;publish({busy:false,waiting:false})}}
 }
 return {activate:()=>{disposed=false},start,cancel:()=>{controller?.abort();controller=null;publish({busy:false,waiting:false})},subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},getSnapshot:()=>state,dispose:()=>{disposed=true;controller?.abort();controller=null;listeners.clear()}};
}
