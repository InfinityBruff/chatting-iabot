import React,{useEffect,useMemo,useState} from 'react';
import {authClient} from '../auth.js';
import {pageCacheEpoch} from '../live-page-cache.js';
import {catalogScope,catalogProgressStats,createChatDirectCatalogSource,createCatalogReader} from '../chat-direct-catalog-source.js';
import './chat-direct-catalog.css';
const money=cents=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(cents/100);
const date=value=>value?new Date(value).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'}):'Sin comprobar';
const labels={photo:'Foto',video:'Vídeo',audio:'Audio',gif:'GIF'};
const itemLabel=item=>item?.label||`${labels[item?.type]||'Archivo'} · ID ${item?.id||''}`;
const kinds={offered:'Oferta con precio',free_sent:'Envío gratuito',sent_price_unknown:'Envío · Precio desconocido'};
const initial={data:null,busy:false,phase:null,error:'',denied:false,retryAt:0};
export default function ChatDirectCatalog({actor,workspace,context,source}){
 const scope=catalogScope(context);
 if(!scope||context?.actor!==actor||context.workspace!==workspace||context.canRead!==true)return <section className="chat-direct-catalog" role="tabpanel" aria-label="Catálogo y seguimiento"><div className="chat-direct-catalog-empty"><strong>Abre una conversación autorizada</strong><p>El catálogo y las coincidencias del historial se consultan por modelo y fan.</p></div></section>;
 return <CatalogScope key={JSON.stringify([scope,pageCacheEpoch()])} {...{actor,workspace,context,source}}/>;
}
function CatalogScope({actor,workspace,context,source:providedSource}){
 const source=useMemo(()=>providedSource||createChatDirectCatalogSource(authClient,{actor,workspace}),[providedSource,actor,workspace]);
 const [state,setState]=useState(initial),[folderId,setFolderId]=useState(null),[clock,setClock]=useState(Date.now);
 const reader=useMemo(()=>createCatalogReader(source,context,{onChange:setState,getEpoch:pageCacheEpoch}),[source,context.actor,context.workspace,context.account,context.fanId]);
 useEffect(()=>{const visibility=()=>reader.setVisible(document.visibilityState!=='hidden');visibility();reader.start();document.addEventListener('visibilitychange',visibility);return()=>{document.removeEventListener('visibilitychange',visibility);reader.stop()}},[reader]);
 useEffect(()=>{setClock(Date.now());if(state.retryAt<=Date.now())return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[state.retryAt]);
 const folders=state.data?.catalog.folders||[],folder=folders.find(row=>row.id===folderId)||folders[0],observations=state.data?.progress.observations||[],scan=state.data?.progress.scan;
 const stats=useMemo(()=>catalogProgressStats(observations),[observations]);
 const trace=useMemo(()=>observations.filter(row=>row.folderId===folder?.id).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.messageId.localeCompare(a.messageId,undefined,{numeric:true})),[observations,folder?.id]);
 const waiting=Math.max(0,Math.ceil((state.retryAt-clock)/1000)),disabled=state.busy||state.denied||waiting>0;
 return <section className="chat-direct-catalog" role="tabpanel" aria-label="Catálogo y seguimiento">
  <header className="chat-direct-catalog-heading"><div><small>SEGUIMIENTO PRIVADO · SIN ENVÍOS</small><h3>Catálogo y seguimiento</h3></div><span className="chat-direct-catalog-safe">Sin envíos</span></header>
  <p className="chat-direct-catalog-help">Contenido de esta modelo y coincidencias del historial de este fan. El orden y los precios de referencia son propuestas; no activan guiones ni modifican el chat.</p>
  <div className="chat-direct-catalog-actions"><button type="button" disabled={disabled} onClick={()=>reader.refresh('recent')}>{state.busy&&state.phase==='recent'?'Leyendo recientes…':'Actualizar recientes'}</button><button type="button" disabled={disabled||!scan?.cursor||scan.historyComplete} onClick={()=>reader.refresh('older')}>{state.busy&&state.phase==='older'?'Ampliando…':'Ampliar historial · 1 página'}</button></div>
  {state.busy&&<p className="chat-direct-catalog-status" role="status">{state.phase==='read'?'Consultando catálogo y seguimiento guardado…':state.phase==='older'?'Comprobando una página anterior del historial…':'Comprobando mensajes recientes en la fuente…'}</p>}
  {state.error&&<p className="chat-direct-catalog-error" role="alert">{state.error}{waiting>0&&` Espera ${waiting} s.`}</p>}
  {!state.data&&!state.busy&&!state.error&&<p className="chat-direct-catalog-status">La lectura comienza al abrir este apartado.</p>}
  {state.data&&<>
   <div className="chat-direct-catalog-stats" aria-label="Coincidencias observadas"><div><strong>{stats.messages}</strong><span>Mensajes con contenido</span></div><div><strong>{stats.offered}</strong><span>Mensajes con oferta</span></div><div><strong>{stats.free}</strong><span>Mensajes gratuitos</span></div><div><strong>Sin confirmar</strong><span>Compras</span></div></div>
   <p className="chat-direct-catalog-caption">Solo historial comprobado · Un mensaje con varios archivos cuenta una vez. Apertura no equivale a compra.{stats.unknown>0&&` ${stats.unknown} mensaje${stats.unknown===1?' tiene':'s tienen'} precio desconocido.`}</p>
   <div className="chat-direct-catalog-coverage"><span>Recientes: <b>{date(scan.recentCheckedAt)}</b></span><span>Historial: <b>{scan.pages} página{scan.pages===1?'':'s'} comprobada{scan.pages===1?'':'s'}</b></span><small>{scan.historyComplete?`Recorrido hasta el final según la fuente el ${date(scan.historyCheckedAt)}. No acredita compras ni un historial total garantizado.`:'Historial parcial. Ampliar consulta una página anterior; no recorre todo automáticamente.'}</small></div>
   {folders.length?<><label className="chat-direct-catalog-folder"><span>Carpeta · {folders.length} disponibles</span><select value={folder.id} onChange={event=>setFolderId(event.target.value)}>{folders.map(row=><option key={row.id} value={row.id}>{row.name} · {row.items.length} archivos</option>)}</select></label>
    <div className="chat-direct-catalog-folder-title"><strong>{folder.name}</strong><span>Orden sin confirmar</span></div>
    <div className="chat-direct-catalog-items">{folder.items.map(item=>{const matches=trace.filter(row=>row.mediaId===item.id),latest=matches[0];return <article key={item.id} className="chat-direct-catalog-item"><span className="chat-direct-catalog-type" aria-hidden="true">{item.type==='video'?'▷':item.type==='photo'?'▧':item.type==='audio'?'♫':'▦'}</span><div><strong>{itemLabel(item)}</strong><small>{labels[item.type]}{item.durationLabel?` · ${item.durationLabel}`:''}</small><span>{latest?kinds[latest.kind]:'Sin coincidencias en lo comprobado'}</span></div><div className="chat-direct-catalog-price"><b>{item.referencePriceCents===null?'Sin referencia':money(item.referencePriceCents)}</b><small>Referencia propuesta</small><span>Precio configurado sin confirmar</span></div></article>})}</div>
    <details className="chat-direct-catalog-trace"><summary>Trazabilidad · {trace.length} coincidencias de archivos</summary><p>Vinculaciones por archivo y mensaje; el precio corresponde al mensaje completo. Ninguna compra está confirmada.</p>{trace.length?<ol>{trace.slice(0,50).map(row=><li key={JSON.stringify([row.mediaId,row.messageId])}><strong>{itemLabel(folder.items.find(item=>item.id===row.mediaId))} · {kinds[row.kind]}</strong><span>{date(row.createdAt)} · Mensaje {row.messageId}</span><small>{row.priceCents===null?'Precio del mensaje desconocido':`${money(row.priceCents)} · Precio del mensaje completo`}{row.openedReported===true?' · Apertura reportada; compra sin confirmar':''}</small></li>)}</ol>:<p>No hay coincidencias en las páginas comprobadas. Esto no prueba que nunca se haya enviado este contenido.</p>}{trace.length>50&&<small>Se muestran las 50 coincidencias más recientes de esta carpeta.</small>}</details>
   </>:<div className="chat-direct-catalog-empty"><strong>Sin carpetas en el catálogo de esta modelo</strong><p>No se muestran ejemplos ni archivos inventados.</p></div>}
   <small className="chat-direct-catalog-updated">Lectura guardada: {date(state.data.observedAt)} · Recientes cada 60 s mientras este apartado está visible.</small>
  </>}
 </section>;
}
