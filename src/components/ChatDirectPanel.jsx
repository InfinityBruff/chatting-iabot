import React,{useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {materializeSuggestion} from '../chat-direct.js';
import {analyzeChatDirect} from '../chat-direct-analysis.js';
import {fitChatDirectWindow,changeChatDirectWindow} from '../chat-direct-window.js';
import {MediaImage} from './MediaPreview.jsx';
import ChatDirectKnowledge from './ChatDirectKnowledge.jsx';
import {mediaLabels,vaultDuration} from '../vault-library.js';

const viewport=()=>({left:window.visualViewport?.offsetLeft||0,top:window.visualViewport?.offsetTop||0,width:window.visualViewport?.width||window.innerWidth,height:window.visualViewport?.height||window.innerHeight});
const money=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(value):'Sin verificar';
const sourceReference=source=>source.kind==='document'?`${source.label} · ${source.referenceId}`:`${source.modelId} · ${source.conversationId} · ${source.messageId}`;
const valuesFor=(candidate,values)=>Object.fromEntries((candidate.variables||[]).filter(variable=>Object.hasOwn(values,variable.key)).map(variable=>[variable.key,values[variable.key]]));
export default function ChatDirectPanel({context,entry,canManage,actor,workspace,sourceAvailable,captureEnabled,setCaptureEnabled,origin,frame,focusRequest,onFrame,onClose,onInput,onValue,onSelect,onConsult,onInsert,onKnowledgeChanged}){
 const titleId=useId(),descriptionId=useId(),header=useRef(null),panel=useRef(null),drag=useRef(null),alive=useRef(false),copyVersion=useRef(0),insertLock=useRef(false);
 const [geometry,setGeometry]=useState(()=>fitChatDirectWindow(frame||{},viewport())),[tab,setTab]=useState('direct'),[copy,setCopy]=useState(''),[inserting,setInserting]=useState(false),[insertion,setInsertion]=useState(null),[actionError,setActionError]=useState('');
 const geometryRef=useRef(geometry);geometryRef.current=geometry;
 const scope=context?.scope||'',revision=context?.revision||'',lease=JSON.stringify([scope,revision,entry.selectedId,entry.insertToken]),leaseRef=useRef(lease);leaseRef.current=lease;
 const candidates=sourceAvailable&&context?.canRead?entry.candidates:[],selected=candidates.find(item=>item.id===entry.selectedId),materialized=selected?materializeSuggestion(selected,valuesFor(selected,entry.values)):null;
 const analysis=useMemo(()=>analyzeChatDirect(context?.messages,{historyComplete:context?.historyComplete===true}),[context?.messages,context?.historyComplete]);
 const variables=useMemo(()=>{const map=new Map();for(const item of candidates)for(const variable of item.variables||[])if(!map.has(variable.key))map.set(variable.key,variable);return [...map.values()]},[candidates]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;copyVersion.current++;drag.current=null}},[]);
 useLayoutEffect(()=>{header.current?.focus({preventScroll:true})},[focusRequest]);
 useLayoutEffect(()=>{copyVersion.current++;setCopy('');setInsertion(null);setActionError('');insertLock.current=false;setInserting(false);if(panel.current?.contains(document.activeElement))header.current?.focus({preventScroll:true})},[scope,revision]);
 useEffect(()=>{setInsertion(null);setActionError('')},[lease]);
 useEffect(()=>{if(!canManage&&tab==='knowledge')setTab('direct')},[canManage,tab]);
 useEffect(()=>{
  const fit=()=>setGeometry(previous=>fitChatDirectWindow(previous,viewport()));
  window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);window.visualViewport?.addEventListener('scroll',fit);
  return()=>{window.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('scroll',fit)};
 },[]);
 const move=next=>{geometryRef.current=next;setGeometry(next);onFrame(next)};
 function startDrag(event,resize=false){
  if(event.button!==0||event.target.closest('label,input,textarea,select,a')||!resize&&event.target.closest('button:not(.chat-direct-move)'))return;
  event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,box:geometryRef.current,resize};
 }
 function pointerMove(event){const current=drag.current;if(!current||current.id!==event.pointerId)return;move(changeChatDirectWindow(current.box,{dx:event.clientX-current.x,dy:event.clientY-current.y,resize:current.resize},viewport()))}
 function endDrag(event){if(drag.current?.id!==event.pointerId)return;drag.current=null;if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}
 function adjust(event,resize=false){
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();
  if(event.key==='Home'){move(fitChatDirectWindow({},viewport()));return}
  const step=event.shiftKey?30:10;move(changeChatDirectWindow(geometryRef.current,{dx:event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy:event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0,resize},viewport()));
 }
 async function copyEnglish(candidate){
  const text=materializeSuggestion(candidate,valuesFor(candidate,entry.values));if(!text.complete)return;const version=++copyVersion.current,currentLease=lease;
  try{if(!navigator.clipboard?.writeText)throw Error('Sin portapapeles');await navigator.clipboard.writeText(text.english);if(alive.current&&copyVersion.current===version&&leaseRef.current===currentLease)setCopy('Inglés copiado. No se ha enviado nada.')}
  catch{if(alive.current&&copyVersion.current===version&&leaseRef.current===currentLease)setCopy('No se pudo copiar. Puedes seleccionar el texto de la respuesta.')}
 }
 const currentInsertion=()=>alive.current&&leaseRef.current===lease;
 async function apply(mode,expectedText,expectedSnapshot){
  const result=await onInsert({mode,expectedText,expectedSnapshot,text:materialized.english,token:entry.insertToken});if(!currentInsertion())return;
  if(result.status==='conflict'){setInsertion({expectedText:result.currentText??'',expectedSnapshot:result.draftSnapshot,hasPrepared:result.hasPrepared===true,lease});setActionError('La preparación del chat cambió. Revisa de nuevo cómo quieres incorporar la opción.');return}
  setInsertion(null);if(!['inserted','duplicate'].includes(result.status))setActionError(result.status==='unavailable'?result.message||'La referencia no está disponible. Vuelve a comprobarla.':result.status==='stale'?'El contexto cambió. Selecciona una respuesta del chat actual.':'El compositor no permite editar ahora. Comprueba el acceso o el envío pendiente.');
 }
 async function confirm(mode){
  if(insertLock.current||!context?.canInsert||!materialized?.complete||entry.inserted||!entry.insertToken)return;
  const job={lease};insertLock.current=job;setInserting(true);setActionError('');
  try{
   if(mode&&insertion?.lease===lease){await apply(mode,insertion.expectedText,insertion.expectedSnapshot);return}
   const result=await onInsert({mode:'check',text:materialized.english,token:entry.insertToken});if(!currentInsertion())return;
   if(result.status!=='checked'){setActionError(result.status==='stale'?'El contexto cambió. Revisa la selección actual.':'El compositor no está disponible para editar.');return}
   const expectedText=typeof result.currentText==='string'?result.currentText:'';
   if(selected.content?result.hasPrepared===true:!!expectedText){setInsertion({expectedText,expectedSnapshot:result.draftSnapshot,hasPrepared:result.hasPrepared===true,lease});return}
   await apply(selected.content?'replace-bundle':'replace',expectedText,result.draftSnapshot);
  }catch{if(currentInsertion())setActionError('No se pudo insertar en el borrador. No se ha enviado ningún mensaje.')}
  finally{if(insertLock.current===job){insertLock.current=false;if(alive.current)setInserting(false)}}
 }
 const selectedIndex=selected?candidates.findIndex(item=>item.id===selected.id)+1:null;
 const canConfirm=!!context?.canInsert&&!!materialized?.complete&&(!selected?.content||context?.canVault===true&&selected.content.priceCents!==null&&selected.resolvedContent?.status==='resolved'&&selected.resolvedContent.items?.length===selected.content.mediaIds.length)&&!entry.busy&&!entry.inserted&&!inserting;
 const selectedMessage=context?.messages?.find(item=>String(item.id)===entry.selectedMessageId&&item.isFromMe===false);
 const style={left:geometry.x,top:geometry.y,width:geometry.width,height:geometry.height,'--chat-direct-origin-x':`${origin?Math.max(0,Math.min(geometry.width,origin.x-geometry.x)):geometry.width/2}px`,'--chat-direct-origin-y':`${origin?Math.max(0,Math.min(geometry.height,origin.y-geometry.y)):geometry.height/2}px`};
 return createPortal(<aside ref={panel} className="chat-direct-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={descriptionId} style={style} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.stopPropagation();onClose()}}}>
  <header className="chat-direct-header" onPointerDown={event=>startDrag(event)} onPointerMove={pointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={()=>{drag.current=null}}>
   <span className="chat-direct-brand"><img src="/brand/bruff-chat-direct-gorilla-transparent-red.png" width="40" height="40" alt="" draggable="false"/></span><div><small>ASISTENCIA CON CONTROL HUMANO</small><h2 ref={header} tabIndex={-1} id={titleId}>BRUFF IA <span>· CHAT DIRECTO</span></h2></div><button type="button" className="chat-direct-move" aria-label="Mover panel · usa las flechas" title="Arrastra la cabecera · Flechas para mover · Inicio para centrar" onKeyDown={event=>adjust(event)}>⠿</button><label className="chat-direct-header-toggle" title="Modo directo · Seleccionar mensajes recibidos"><span>Directo</span><input type="checkbox" role="switch" aria-label="Modo directo" checked={captureEnabled} disabled={!context?.canRead} onChange={event=>setCaptureEnabled(event.target.checked)}/></label><button type="button" className="chat-direct-close" aria-label="Cerrar Chat directo" onClick={onClose}>×</button>
  </header>
  <div className="chat-direct-content">
   <p id={descriptionId} className={'chat-direct-source-state '+(sourceAvailable?'is-connected':'')}><span aria-hidden="true"/>{entry.knowledge?`${entry.knowledge.engine==='semantic'?(entry.knowledge.engineInvoked?'IA semántica consultada':'Motor semántico configurado'):'Banco conectado'} · ${entry.knowledge.approvedCount} ${entry.knowledge.approvedCount===1?'ejemplo aprobado':'ejemplos aprobados'}`:sourceAvailable?'Banco configurado · consulta para comprobar':'Fuente verificada sin conectar'}</p>
   <div className="chat-direct-context"><div><small>MODELO</small><strong>{context?.modelName||'Selecciona una modelo'}</strong></div><div><small>FAN ACTUAL</small><strong>{context?.fanName||'Abre una conversación autorizada'}</strong></div></div>
   <small className="chat-direct-active-chat">{context?.canRead?`Chat activo · ID ${context.fanId}`:"Sin conversación autorizada"}</small>
   <div className="chat-direct-tabs" role="tablist" aria-label="Panel Chat directo"><button type="button" role="tab" aria-selected={tab==='direct'} onClick={()=>setTab('direct')}>Chat directo</button><button type="button" role="tab" aria-selected={tab==='analysis'} onClick={()=>setTab('analysis')}>Análisis del contexto</button>{canManage&&<button type="button" role="tab" aria-selected={tab==='knowledge'} onClick={()=>setTab('knowledge')}>Base de ejemplos</button>}</div>
   {tab==='direct'?<>
    <div className="chat-direct-toggle"><span><strong>Modo directo</strong><small>Activa el interruptor de la cabecera y selecciona un mensaje recibido en el chat para consultar sus referencias.</small></span></div>
    {selectedMessage&&<section className="chat-direct-received"><small>MENSAJE DEL FAN</small><p>{selectedMessage.text||'Mensaje sin texto disponible'}</p></section>}
    <label className="chat-direct-input"><span>MENSAJE DEL FAN</span><textarea rows="3" maxLength={2000} disabled={!context?.canRead||entry.busy} value={entry.input} onChange={event=>onInput(event.target.value)} placeholder="Escribe aquí o selecciona un mensaje en modo directo…"/></label>
    <button type="button" className="chat-direct-primary chat-direct-consult" disabled={!context?.canRead||entry.busy||!entry.input.trim()} onClick={()=>void onConsult({force:true})}>{entry.busy?'Consultando referencias…':'GENERAR 3 RESPUESTAS'}<span aria-hidden="true">↗</span></button>
    {sourceAvailable&&<p className="chat-direct-explanation">Recuperación de ejemplos revisados, sin generación ni entrenamiento. Hasta 2.000 caracteres por consulta. El modo semántico compara en Cloudflare la consulta y los contextos aprobados. No se envía nada al fan.</p>}{!sourceAvailable&&<p className="chat-direct-explanation">El banco de ejemplos todavía no está conectado. Aquí no se inventan respuestas ni se muestran conversaciones de demostración. La selección nunca envía mensajes.</p>}
    {entry.error&&<p className="chat-direct-alert" role="alert">{entry.error}</p>}
    {variables.length>0&&<fieldset className="chat-direct-variables"><legend>Completa los datos de la respuesta</legend><p>Solo se sustituyen los campos marcados por la fuente. Revisa cada dato; no se deduce del perfil.</p>{variables.map(variable=><label key={variable.key}><span>{variable.label}</span><input type={['bioAge','age'].includes(variable.type)?'number':'text'} min={['bioAge','age'].includes(variable.type)?18:undefined} max={['bioAge','age'].includes(variable.type)?100:undefined} maxLength={120} value={entry.values[variable.key]??''} onChange={event=>onValue(variable.key,event.target.value)}/></label>)}</fieldset>}
    <div className="chat-direct-results-heading"><h3>Respuestas documentadas</h3><span>{candidates.length} / 3</span></div>
    <div className="chat-direct-results">{candidates.map((candidate,index)=>{const text=materializeSuggestion(candidate,valuesFor(candidate,entry.values)),chosen=candidate.id===entry.selectedId;return <article className={'chat-direct-card '+(chosen?'is-selected':'')} key={candidate.id}><header><span>OPCIÓN {String(index+1).padStart(2,"0")}</span><span className="chat-direct-verified">Verificada · v{candidate.source.version}</span></header>{candidate.content&&<span className="chat-direct-content-badge">MENSAJE + CONTENIDO</span>}<small className="chat-direct-language-label">ENGLISH · PARA ENVIAR</small><div className="chat-direct-english" lang="en">{text.english}</div><div className="chat-direct-spanish" lang="es"><small>ESPAÑOL · TRADUCCIÓN</small><p>{text.spanish}</p></div>{!text.complete&&<p className="chat-direct-field-warning">{Object.values(text.errors).join(" ")||"Completa los campos marcados antes de copiar o insertar."}</p>}{candidate.content&&<ContentProposal candidate={candidate} canVault={context?.canVault===true}/>}<details><summary>Referencia del ejemplo</summary><p>{sourceReference(candidate.source)}</p></details><footer><button type="button" disabled={!text.complete} onClick={()=>copyEnglish(candidate)}>Copiar inglés</button><button type="button" aria-pressed={chosen} onClick={()=>onSelect(candidate.id)}>{chosen?'✓ Seleccionada':'Seleccionar'}</button></footer></article>})}{!candidates.length&&!entry.busy&&<div className="chat-direct-empty"><span aria-hidden="true">⌕</span><strong>{sourceAvailable?'Sin respuestas verificadas disponibles':'Esperando una fuente verificada'}</strong><p>{sourceAvailable?'Se mostrarán únicamente ejemplos comparables con su procedencia.':'Podrás consultar hasta tres opciones originales cuando el banco de referencias esté conectado.'}</p></div>}{entry.busy&&<div className="chat-direct-loading" role="status"><span/>Recuperando ejemplos y comprobando su procedencia…</div>}</div>
    {copy&&<p className="chat-direct-status" role="status">{copy}</p>}
   </>:tab==='knowledge'&&canManage?<ChatDirectKnowledge key={JSON.stringify([actor,workspace,context?.account])} actor={actor} workspace={workspace} account={context?.account} onChanged={onKnowledgeChanged}/>:<ChatAnalysis analysis={analysis} context={context}/>}
  </div>
  <footer className="chat-direct-footer">
   {selected&&<section className="chat-direct-picked"><strong>HAS ELEGIDO LA OPCIÓN {String(selectedIndex).padStart(2,"0")}</strong><p lang="en">{materialized.english}</p>{selected.content&&<ContentProposal candidate={selected} canVault={context?.canVault===true} compact/>}<div><button type="button" disabled={!materialized.complete} onClick={()=>copyEnglish(selected)}>Copiar seleccionada</button><button type="button" disabled={inserting} onClick={()=>onSelect(null)}>Cambiar selección</button></div></section>}
   {entry.notice&&<p className="chat-direct-status" role="status">{entry.notice}</p>}{actionError&&<p className="chat-direct-alert" role="alert">{actionError}</p>}
   {insertion?.lease===lease?<div className="chat-direct-conflict"><strong>{selected?.content?"Ya hay una preparación en el chat":"Ya hay texto en el borrador"}</strong><p>{selected?.content?"Se reemplazarán el texto, los archivos y el precio por los de esta opción. La respuesta vinculada se conserva. No se envía nada.":"Conserva lo escrito y añade la respuesta, o reemplaza únicamente el texto. Los adjuntos y el precio se mantienen."}</p><div>{!selected?.content&&<button type="button" disabled={inserting||!canConfirm} onClick={()=>void confirm('append')}>Conservar y añadir</button>}<button type="button" disabled={inserting||!canConfirm} onClick={()=>void confirm(selected?.content?'replace-bundle':'replace')}>{selected?.content?"Reemplazar preparación":"Reemplazar texto"}</button><button type="button" disabled={inserting} onClick={()=>setInsertion(null)}>Cancelar</button></div></div>:<div className="chat-direct-confirm-row"><span>{entry.inserted?'Preparada en el borrador':selected?.content?'Mensaje y contenido seleccionados':selected?'Una respuesta seleccionada':'Selecciona una respuesta'}<small>{selected?.content?"Prepara texto y contenido · Sin enviar":"Solo prepara texto · Tú decides cuándo enviarlo"}</small></span><button type="button" className="chat-direct-primary" disabled={!canConfirm} onClick={()=>void confirm()}>{inserting?'Comprobando…':entry.inserted?'Preparada':selected?.content?'Preparar en el chat':'Confirmar ✓'}</button></div>}
   <small className="chat-direct-window-help">Arrastra la cabecera o la esquina · Usa las flechas para ajustar</small>
  </footer>
  <button type="button" className="chat-direct-resize" aria-label="Cambiar tamaño del panel · usa las flechas" title="Arrastra para ajustar · Flechas para cambiar tamaño · Inicio para restaurar" onPointerDown={event=>startDrag(event,true)} onPointerMove={pointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={()=>{drag.current=null}} onKeyDown={event=>adjust(event,true)}><span aria-hidden="true">◢</span></button>
 </aside>,document.body);
}
function ContentProposal({candidate,canVault,compact=false}){
 const content=candidate.content,resolution=candidate.resolvedContent;
 const items=canVault&&resolution?.status==='resolved'&&Array.isArray(resolution.items)?resolution.items:[],shown=compact?items.slice(0,3):items;
 const price=content.priceCents===null?'Precio sin verificar':content.priceCents===0?'Gratis':money(content.priceCents/100)+' · PPV propuesto';
 const available=canVault&&resolution?.status==='resolved',message=!canVault?'No tienes acceso al baúl de esta modelo.':resolution?.message||'El contenido todavía no se ha podido comprobar en el baúl.';
 return <section className={'chat-direct-proposal '+(compact?'is-compact':'')} aria-label="Contenido propuesto para preparar">
  <header><strong>{price}</strong><span>{content.mediaIds.length} {content.mediaIds.length===1?'archivo':'archivos'} · Precio del conjunto</span></header>
  {!!shown.length&&<div className="chat-direct-proposal-media">{shown.map(item=>{const type=item.media?.type,label=mediaLabels[type]||'Archivo',duration=['video','audio'].includes(type)?vaultDuration(item.media?.duration):null;return <article key={item.id} className="chat-direct-proposal-item"><div><span className="chat-direct-proposal-kind" aria-hidden="true">{type==='video'?'▶':type==='audio'?'♫':'▧'}</span><MediaImage item={item.media||{type:"file"}} alt={'Vista previa · '+label}/>{duration&&<small className="chat-direct-proposal-duration">{duration}</small>}</div><span>{label}</span></article>})}{compact&&items.length>shown.length&&<span className="chat-direct-proposal-more">+{items.length-shown.length}</span>}</div>}
  {!available&&<p className="chat-direct-proposal-unavailable" role="status">{message}</p>}
  {content.priceCents===null&&<p className="chat-direct-proposal-unavailable">Falta un precio propuesto verificable para preparar este contenido. Puedes copiar el texto por separado.</p>}
  {!compact&&<><p className="chat-direct-proposal-reason">{content.reason}</p><small className="chat-direct-proposal-reference">Referencia de la propuesta: {content.reference.id} · v{content.reference.version}</small><small className="chat-direct-proposal-footnote">Preparar añade esta opción al editor. No acredita un envío ni una compra.</small></>}
 </section>;
}
function ChatAnalysis({analysis,context}){
 const entries=[['Fotos gratis','freePhotos'],['Vídeos gratis','freeVideos'],['PPV ofrecidos','ppvOffered'],['PPV desbloqueados','ppvUnlocked']];
 return <section className="chat-direct-analysis"><header><small>DATOS OBSERVADOS</small><h3>Estado de esta conversación</h3><p>{analysis.coverageLabel}</p></header><div className="chat-direct-analysis-stage"><span>Etapa de conversación</span><strong>{analysis.phase||'Sin verificar'}</strong><span>Nivel del guion</span><strong>{analysis.lastScriptLevel||'Sin verificar'}</strong></div><div className="chat-direct-metrics">{entries.map(([label,key])=><article key={key}><small>{label}</small><strong>{context?analysis[key]??'—':'—'}</strong><span>{analysis.countLabels?.[key]||'En los mensajes cargados'}</span></article>)}</div><div className="chat-direct-analysis-prices"><p><span>{analysis.lastOfferedPriceLabel||'Último precio ofrecido'}</span><b>{money(analysis.lastOfferedPrice)}</b></p><p><span>{analysis.lastConfirmedPriceLabel||'Precio del mensaje desbloqueado'}</span><b>{money(analysis.lastConfirmedPrice)}</b></p></div><p className="chat-direct-explanation">Los mensajes vistos no acreditan una compra. Los recuentos describen los datos recibidos; un historial parcial no representa el total del fan.</p><div className="chat-direct-next"><small>SIGUIENTE ACCIÓN</small><p>{analysis.nextAction||'Revisar el contexto disponible y las referencias verificadas antes de decidir.'}</p></div></section>;
}
