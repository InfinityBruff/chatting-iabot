import React,{useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {materializeSuggestion} from '../chat-direct.js';
import {analyzeChatDirect} from '../chat-direct-analysis.js';
import {fitChatDirectWindow,changeChatDirectWindow} from '../chat-direct-window.js';

const viewport=()=>({left:window.visualViewport?.offsetLeft||0,top:window.visualViewport?.offsetTop||0,width:window.visualViewport?.width||window.innerWidth,height:window.visualViewport?.height||window.innerHeight});
const money=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(value):'Sin verificar';
const sourceReference=source=>`${source.modelId} · ${source.conversationId} · ${source.messageId}`;
const valuesFor=(candidate,values)=>Object.fromEntries((candidate.variables||[]).filter(variable=>Object.hasOwn(values,variable.key)).map(variable=>[variable.key,values[variable.key]]));
export default function ChatDirectPanel({context,entry,sourceAvailable,captureEnabled,setCaptureEnabled,origin,frame,focusRequest,onFrame,onClose,onInput,onValue,onSelect,onConsult,onInsert}){
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
 async function apply(mode,expectedText){
  const result=await onInsert({mode,expectedText,text:materialized.english,token:entry.insertToken});if(!currentInsertion())return;
  if(result.status==='conflict'){setInsertion({expectedText:result.currentText??'',lease});setActionError('El borrador cambió. Revisa de nuevo cómo quieres incorporar la respuesta.');return}
  setInsertion(null);if(!['inserted','duplicate'].includes(result.status))setActionError(result.status==='stale'?'El contexto cambió. Selecciona una respuesta del chat actual.':'El compositor no permite editar ahora. Comprueba el acceso o el envío pendiente.');
 }
 async function confirm(mode){
  if(insertLock.current||!context?.canInsert||!materialized?.complete||entry.inserted||!entry.insertToken)return;
  const job={lease};insertLock.current=job;setInserting(true);setActionError('');
  try{
   if(mode&&insertion?.lease===lease){await apply(mode,insertion.expectedText);return}
   const result=await onInsert({mode:'check',text:materialized.english,token:entry.insertToken});if(!currentInsertion())return;
   if(result.status!=='checked'){setActionError(result.status==='stale'?'El contexto cambió. Revisa la selección actual.':'El compositor no está disponible para editar.');return}
   const expectedText=typeof result.currentText==='string'?result.currentText:'';
   if(expectedText){setInsertion({expectedText,lease});return}
   await apply('replace',expectedText);
  }catch{if(currentInsertion())setActionError('No se pudo insertar en el borrador. No se ha enviado ningún mensaje.')}
  finally{if(insertLock.current===job){insertLock.current=false;if(currentInsertion())setInserting(false)}}
 }
 const selectedIndex=selected?candidates.findIndex(item=>item.id===selected.id)+1:null;
 const canConfirm=!!context?.canInsert&&!!materialized?.complete&&!entry.busy&&!entry.inserted&&!inserting;
 const selectedMessage=context?.messages?.find(item=>String(item.id)===entry.selectedMessageId&&item.isFromMe===false);
 const style={left:geometry.x,top:geometry.y,width:geometry.width,height:geometry.height,'--chat-direct-origin-x':`${origin?Math.max(0,Math.min(geometry.width,origin.x-geometry.x)):geometry.width/2}px`,'--chat-direct-origin-y':`${origin?Math.max(0,Math.min(geometry.height,origin.y-geometry.y)):geometry.height/2}px`};
 return createPortal(<aside ref={panel} className="chat-direct-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={descriptionId} style={style} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.stopPropagation();onClose()}}}>
  <header className="chat-direct-header" onPointerDown={event=>startDrag(event)} onPointerMove={pointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={()=>{drag.current=null}}>
   <span className="chat-direct-brand"><img src="/brand/bruff-chat-direct-gorilla.png" width="40" height="40" alt="" draggable="false"/></span><div><small>ASISTENCIA CON CONTROL HUMANO</small><h2 ref={header} tabIndex={-1} id={titleId}>BRUFF IA <span>· CHAT DIRECTO</span></h2></div><button type="button" className="chat-direct-move" aria-label="Mover panel · usa las flechas" title="Arrastra la cabecera · Flechas para mover · Inicio para centrar" onKeyDown={event=>adjust(event)}>⠿</button><label className="chat-direct-header-toggle" title="Modo directo · Seleccionar mensajes recibidos"><span>Directo</span><input type="checkbox" role="switch" aria-label="Modo directo" checked={captureEnabled} disabled={!context?.canRead} onChange={event=>setCaptureEnabled(event.target.checked)}/></label><button type="button" className="chat-direct-close" aria-label="Cerrar Chat directo" onClick={onClose}>×</button>
  </header>
  <div className="chat-direct-content">
   <p id={descriptionId} className={'chat-direct-source-state '+(sourceAvailable?'is-connected':'')}><span aria-hidden="true"/>{sourceAvailable?'Fuente de referencias configurada':'Fuente verificada sin conectar'}</p>
   <div className="chat-direct-context"><div><small>MODELO</small><strong>{context?.modelName||'Selecciona una modelo'}</strong></div><div><small>FAN ACTUAL</small><strong>{context?.fanName||'Abre una conversación autorizada'}</strong></div></div>
   <small className="chat-direct-active-chat">{context?.canRead?`Chat activo · ID ${context.fanId}`:"Sin conversación autorizada"}</small>
   <div className="chat-direct-tabs" role="tablist" aria-label="Panel Chat directo"><button type="button" role="tab" aria-selected={tab==='direct'} onClick={()=>setTab('direct')}>Chat directo</button><button type="button" role="tab" aria-selected={tab==='analysis'} onClick={()=>setTab('analysis')}>Análisis del contexto</button></div>
   {tab==='direct'?<>
    <div className="chat-direct-toggle"><span><strong>Modo directo</strong><small>Activa el interruptor de la cabecera y selecciona un mensaje recibido en el chat para consultar sus referencias.</small></span></div>
    {selectedMessage&&<section className="chat-direct-received"><small>MENSAJE DEL FAN</small><p>{selectedMessage.text||'Mensaje sin texto disponible'}</p></section>}
    <label className="chat-direct-input"><span>MENSAJE DEL FAN</span><textarea rows="3" maxLength={10000} disabled={!context?.canRead||entry.busy} value={entry.input} onChange={event=>onInput(event.target.value)} placeholder="Escribe aquí o selecciona un mensaje en modo directo…"/></label>
    <button type="button" className="chat-direct-primary chat-direct-consult" disabled={!context?.canRead||entry.busy||!entry.input.trim()} onClick={()=>void onConsult({force:true})}>{entry.busy?'Consultando referencias…':'GENERAR 3 RESPUESTAS'}<span aria-hidden="true">↗</span></button>
    {!sourceAvailable&&<p className="chat-direct-explanation">El banco de ejemplos todavía no está conectado. Aquí no se inventan respuestas ni se muestran conversaciones de demostración. La selección nunca envía mensajes.</p>}
    {entry.error&&<p className="chat-direct-alert" role="alert">{entry.error}</p>}
    {variables.length>0&&<fieldset className="chat-direct-variables"><legend>Completa los datos de la respuesta</legend><p>Solo se sustituyen los campos marcados por la fuente. Revisa cada dato; no se deduce del perfil.</p>{variables.map(variable=><label key={variable.key}><span>{variable.label}</span><input type={['bioAge','age'].includes(variable.type)?'number':'text'} min={['bioAge','age'].includes(variable.type)?18:undefined} max={['bioAge','age'].includes(variable.type)?100:undefined} maxLength={120} value={entry.values[variable.key]??''} onChange={event=>onValue(variable.key,event.target.value)}/></label>)}</fieldset>}
    <div className="chat-direct-results-heading"><h3>Respuestas documentadas</h3><span>{candidates.length} / 3</span></div>
    <div className="chat-direct-results">{candidates.map((candidate,index)=>{const text=materializeSuggestion(candidate,valuesFor(candidate,entry.values)),chosen=candidate.id===entry.selectedId;return <article className={'chat-direct-card '+(chosen?'is-selected':'')} key={candidate.id}><header><span>OPCIÓN {String(index+1).padStart(2,"0")}</span><span className="chat-direct-verified">Verificada · v{candidate.source.version}</span></header><small className="chat-direct-language-label">ENGLISH · PARA ENVIAR</small><div className="chat-direct-english" lang="en">{text.english}</div><div className="chat-direct-spanish" lang="es"><small>ESPAÑOL · TRADUCCIÓN</small><p>{text.spanish}</p></div>{!text.complete&&<p className="chat-direct-field-warning">{Object.values(text.errors).join(" ")||"Completa los campos marcados antes de copiar o insertar."}</p>}<details><summary>Referencia del ejemplo</summary><p>{sourceReference(candidate.source)}</p></details><footer><button type="button" disabled={!text.complete} onClick={()=>copyEnglish(candidate)}>Copiar inglés</button><button type="button" aria-pressed={chosen} onClick={()=>onSelect(candidate.id)}>{chosen?'✓ Seleccionada':'Seleccionar'}</button></footer></article>})}{!candidates.length&&!entry.busy&&<div className="chat-direct-empty"><span aria-hidden="true">⌕</span><strong>{sourceAvailable?'Sin respuestas verificadas disponibles':'Esperando una fuente verificada'}</strong><p>{sourceAvailable?'Se mostrarán únicamente ejemplos comparables con su procedencia.':'Podrás consultar hasta tres opciones originales cuando el banco de referencias esté conectado.'}</p></div>}{entry.busy&&<div className="chat-direct-loading" role="status"><span/>Recuperando ejemplos y comprobando su procedencia…</div>}</div>
    {copy&&<p className="chat-direct-status" role="status">{copy}</p>}
   </>:<ChatAnalysis analysis={analysis} context={context}/>}
  </div>
  <footer className="chat-direct-footer">
   {selected&&<section className="chat-direct-picked"><strong>HAS ELEGIDO LA OPCIÓN {String(selectedIndex).padStart(2,"0")}</strong><p lang="en">{materialized.english}</p><div><button type="button" disabled={!materialized.complete} onClick={()=>copyEnglish(selected)}>Copiar seleccionada</button><button type="button" disabled={inserting} onClick={()=>onSelect(null)}>Cambiar selección</button></div></section>}
   {entry.notice&&<p className="chat-direct-status" role="status">{entry.notice}</p>}{actionError&&<p className="chat-direct-alert" role="alert">{actionError}</p>}
   {insertion?.lease===lease?<div className="chat-direct-conflict"><strong>Ya hay texto en el borrador</strong><p>Conserva lo escrito y añade la respuesta, o reemplaza únicamente el texto. Los adjuntos y el precio se mantienen.</p><div><button type="button" disabled={inserting} onClick={()=>void confirm('append')}>Conservar y añadir</button><button type="button" disabled={inserting} onClick={()=>void confirm('replace')}>Reemplazar texto</button><button type="button" disabled={inserting} onClick={()=>setInsertion(null)}>Cancelar</button></div></div>:<div className="chat-direct-confirm-row"><span>{entry.inserted?'Preparada en el borrador':selected?'Una respuesta seleccionada':'Selecciona una respuesta'}<small>Solo prepara texto · Tú decides cuándo enviarlo</small></span><button type="button" className="chat-direct-primary" disabled={!canConfirm} onClick={()=>void confirm()}>{inserting?'Comprobando…':entry.inserted?'Insertada':'Confirmar ✓'}</button></div>}
   <small className="chat-direct-window-help">Arrastra la cabecera o la esquina · Usa las flechas para ajustar</small>
  </footer>
  <button type="button" className="chat-direct-resize" aria-label="Cambiar tamaño del panel · usa las flechas" title="Arrastra para ajustar · Flechas para cambiar tamaño · Inicio para restaurar" onPointerDown={event=>startDrag(event,true)} onPointerMove={pointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={()=>{drag.current=null}} onKeyDown={event=>adjust(event,true)}><span aria-hidden="true">◢</span></button>
 </aside>,document.body);
}
function ChatAnalysis({analysis,context}){
 const entries=[['Fotos gratis','freePhotos'],['Vídeos gratis','freeVideos'],['PPV ofrecidos','ppvOffered'],['PPV desbloqueados','ppvUnlocked']];
 return <section className="chat-direct-analysis"><header><small>DATOS OBSERVADOS</small><h3>Estado de esta conversación</h3><p>{analysis.coverageLabel}</p></header><div className="chat-direct-analysis-stage"><span>Etapa de conversación</span><strong>{analysis.phase||'Sin verificar'}</strong><span>Nivel del guion</span><strong>{analysis.lastScriptLevel||'Sin verificar'}</strong></div><div className="chat-direct-metrics">{entries.map(([label,key])=><article key={key}><small>{label}</small><strong>{context?analysis[key]??'—':'—'}</strong><span>{analysis.countLabels?.[key]||'En los mensajes cargados'}</span></article>)}</div><div className="chat-direct-analysis-prices"><p><span>{analysis.lastOfferedPriceLabel||'Último precio ofrecido'}</span><b>{money(analysis.lastOfferedPrice)}</b></p><p><span>{analysis.lastConfirmedPriceLabel||'Precio del mensaje desbloqueado'}</span><b>{money(analysis.lastConfirmedPrice)}</b></p></div><p className="chat-direct-explanation">Los mensajes vistos no acreditan una compra. Los recuentos describen los datos recibidos; un historial parcial no representa el total del fan.</p><div className="chat-direct-next"><small>SIGUIENTE ACCIÓN</small><p>{analysis.nextAction||'Revisar el contexto disponible y las referencias verificadas antes de decidir.'}</p></div></section>;
}
