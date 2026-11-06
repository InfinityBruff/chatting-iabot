import React,{useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {materializeChatDirectSuggestion as materializeSuggestion} from '../chat-direct.js';
import {analyzeChatDirect} from '../chat-direct-analysis.js';
import {fitChatDirectWindow,changeChatDirectWindow} from '../chat-direct-window.js';
import {MediaImage} from './MediaPreview.jsx';
import ChatDirectKnowledge from './ChatDirectKnowledge.jsx';
import {mediaLabels,vaultDuration} from '../vault-library.js';
import {validateGenerationQuota,validateGenerationUsage} from '../chat-direct-source.js';

const viewport=()=>({left:window.visualViewport?.offsetLeft||0,top:window.visualViewport?.offsetTop||0,width:window.visualViewport?.width||window.innerWidth,height:window.visualViewport?.height||window.innerHeight});
const money=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(value):'Sin verificar';
const sourceReference=source=>source.kind==='document'?`${source.label} · ${source.referenceId}`:`${source.modelId} · ${source.conversationId} · ${source.messageId}`;
const generated=candidate=>candidate?.aiGenerated===true&&candidate.aiVerified===false&&candidate.source?.kind==='generated';
const valuesFor=(candidate,values)=>Object.fromEntries((candidate.variables||[]).filter(variable=>Object.hasOwn(values,variable.key)).map(variable=>[variable.key,values[variable.key]]));
const DIAGNOSTICS={
 pending:{title:'Consulta en curso',text:'Ya hay una consulta para este contexto. Espera y vuelve a comprobar manualmente; no se solicita otra inferencia automáticamente.'},
 disabled:{title:'Generación desactivada',text:'La IA no se ha consultado. El propietario debe revisar y habilitar las consultas manuales de esta modelo.',section:'generation'},
 no_sources:{title:'Faltan ejemplos aprobados',text:'Aprueba al menos un ejemplo documental real de esta modelo antes de generar borradores.',section:'examples'},
 rpc_missing:{title:'Generación no habilitada en el servicio',text:'Esta instalación todavía no puede comprobar la generación. No se ha utilizado el banco como alternativa.'},
 config:{title:'Configuración de IA pendiente',text:'No se ha podido iniciar el motor. El propietario debe revisar su conexión y los requisitos del plan gratuito.',section:'generation'},
 context_changed:{title:'El contexto ha cambiado',text:'Consulta de nuevo desde el chat actual. No se preparan borradores de una conversación anterior.'},
 local_limit:{title:'Límite de BRUFF alcanzado',text:'Espera antes de volver a generar. La consulta no se repetirá automáticamente.'},
 provider_limit:{title:'Proveedor temporalmente limitado',text:'El proveedor ha indicado un límite de uso. Respeta la espera antes de volver a consultar.'},
 provider:{title:'El proveedor no está disponible',text:'No se pudo completar la consulta de IA. Puedes reintentarlo manualmente más tarde.'},
 provider_auth:{title:'Conexión del motor rechazada',text:'El proveedor no ha aceptado la conexión configurada para el motor. El propietario debe revisar esa configuración antes de reintentar.',section:'generation'},
 provider_request:{title:'Petición al modelo rechazada',text:'El proveedor ha rechazado la petición al modelo configurado. El propietario debe revisar la conexión del motor antes de reintentar.',section:'generation'},
 format:{title:'Respuesta de IA no válida',text:'La respuesta del motor no tiene un formato que pueda validarse. No se muestran borradores sin comprobar.'},
 unavailable:{title:'Consulta de IA no disponible',text:'No se ha podido verificar el servicio. No se ha cambiado al banco de ejemplos.'},
 access:{title:'Acceso no disponible',text:'Revisa tu sesión y los permisos vigentes de esta modelo.'},
};
export default function ChatDirectPanel({context,entry,canManage,actor,workspace,sourceAvailable,captureEnabled,setCaptureEnabled,origin,frame,focusRequest,onFrame,onClose,onInput,onValue,onSelect,onConsult,onInsert,onKnowledgeChanged,onMode,onQuota}){
 const titleId=useId(),descriptionId=useId(),header=useRef(null),panel=useRef(null),drag=useRef(null),alive=useRef(false),copyVersion=useRef(0),insertLock=useRef(false);
 const [geometry,setGeometry]=useState(()=>fitChatDirectWindow(frame||{},viewport())),[tab,setTab]=useState('direct'),[knowledgeSection,setKnowledgeSection]=useState('examples'),[copy,setCopy]=useState(''),[inserting,setInserting]=useState(false),[insertion,setInsertion]=useState(null),[actionError,setActionError]=useState(''),[now,setNow]=useState(()=>Date.now());
 const geometryRef=useRef(geometry);geometryRef.current=geometry;
 const scope=context?.scope||'',revision=context?.revision||'',lease=JSON.stringify([scope,revision,entry.mode,entry.selectedId,entry.insertToken]),leaseRef=useRef(lease);leaseRef.current=lease;
 const candidates=sourceAvailable&&context?.canRead?entry.candidates:[],selected=candidates.find(item=>item.id===entry.selectedId),materialized=selected?materializeSuggestion(selected,valuesFor(selected,entry.values)):null;
 const latestIncoming=useMemo(()=>{
  let latest=null,latestAt=0;
  for(const message of context?.messages||[]){if(message?.isFromMe!==false||message.delivery||typeof message.text!=='string'||!message.text.trim())continue;const at=Date.parse(message.createdAt)||0;if(!latest||at>latestAt||at===latestAt&&String(message.id).localeCompare(String(latest.id),undefined,{numeric:true})>0){latest=message;latestAt=at}}
  return latest;
 },[context?.messages]);
 const mode=['generative','bank'].includes(entry.mode)?entry.mode:entry.knowledge?.engine==='generative'?'generative':'bank',generative=mode==='generative',hasIncoming=!!latestIncoming,unknowns=Array.isArray(entry.knowledge?.unknowns)?entry.knowledge.unknowns.filter(value=>typeof value==='string'&&!!value.trim()):[];
 const diagnostic=entry.diagnostic?.engine==='generative'&&Object.hasOwn(DIAGNOSTICS,entry.diagnostic.reason)?{...DIAGNOSTICS[entry.diagnostic.reason],reason:entry.diagnostic.reason,retryAfter:Number.isSafeInteger(entry.diagnostic.retryAfter)&&entry.diagnostic.retryAfter>0&&entry.diagnostic.retryAfter<=86400?entry.diagnostic.retryAfter:null}:null,failed=!!entry.error||!!diagnostic;
 const openKnowledge=section=>{if(!canManage)return;setKnowledgeSection(section);setTab('knowledge')};
 const currentGeneration=generative&&entry.knowledge?.engine==='generative'&&Number.isFinite(Date.parse(entry.knowledge.expiresAt))&&Date.parse(entry.knowledge.expiresAt)>now;
 const stateLabel=entry.busy?(generative?'Comprobando generación y contexto…':'Consultando ejemplos…'):failed?diagnostic?.title||'Consulta no completada':entry.knowledge?`${entry.knowledge.engine==='generative'?(entry.knowledge.reused?'Borradores reutilizados · Sin nueva inferencia':entry.knowledge.engineInvoked?'IA generativa consultada · Revisión pendiente':'Generación no acreditada'):entry.knowledge.engine==='semantic'?(entry.knowledge.engineInvoked?'IA semántica consultada':'Motor semántico configurado'):'Banco consultado'} · ${entry.knowledge.approvedCount} ${entry.knowledge.approvedCount===1?'ejemplo aprobado':'ejemplos aprobados'}`:sourceAvailable?(generative?'Crear con IA · Configuración por comprobar':'Banco · Pendiente de consulta'):'Asistencia sin conectar';
 const analysis=useMemo(()=>analyzeChatDirect(context?.messages,{historyComplete:context?.historyComplete===true}),[context?.messages,context?.historyComplete]);
 const variables=useMemo(()=>{const map=new Map();for(const item of candidates)for(const variable of item.variables||[])if(!map.has(variable.key))map.set(variable.key,variable);return [...map.values()]},[candidates]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;copyVersion.current++;drag.current=null}},[]);
 useEffect(()=>{
  const moment=Date.now();setNow(moment);
  const upcoming=[entry.knowledge?.expiresAt,...entry.candidates.map(candidate=>candidate.expiresAt)].map(value=>Date.parse(value)).filter(at=>Number.isFinite(at)&&at>moment);
  if(!upcoming.length)return;const timer=setTimeout(()=>setNow(Date.now()),Math.min(...upcoming)-moment+5);return()=>clearTimeout(timer);
 },[entry.candidates,entry.knowledge?.expiresAt]);
 useLayoutEffect(()=>{header.current?.focus({preventScroll:true})},[focusRequest]);
 useLayoutEffect(()=>{copyVersion.current++;setCopy('');setInsertion(null);setActionError('');insertLock.current=false;setInserting(false);if(panel.current?.contains(document.activeElement))header.current?.focus({preventScroll:true})},[scope,revision]);
 useEffect(()=>{copyVersion.current++;setCopy('');setInsertion(null);setActionError('')},[lease]);
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
  const text=materializeSuggestion(candidate,valuesFor(candidate,entry.values));if(entry.busy||!text.complete)return;const version=++copyVersion.current,currentLease=lease;
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
   <p id={descriptionId} className={'chat-direct-source-state '+(entry.knowledge&&!failed?'is-connected':'')}><span aria-hidden="true"/>{stateLabel}</p>
   <div className="chat-direct-context"><div><small>MODELO</small><strong>{context?.modelName||'Selecciona una modelo'}</strong></div><div><small>FAN ACTUAL</small><strong>{context?.fanName||'Abre una conversación autorizada'}</strong></div></div>
   <small className="chat-direct-active-chat">{context?.canRead?`Chat activo · ID ${context.fanId}`:"Sin conversación autorizada"}</small>
   <div className="chat-direct-tabs" role="tablist" aria-label="Panel Chat directo"><button type="button" role="tab" aria-selected={tab==='direct'} onClick={()=>setTab('direct')}>Chat directo</button><button type="button" role="tab" aria-selected={tab==='analysis'} onClick={()=>setTab('analysis')}>Análisis del contexto</button>{canManage&&<button type="button" role="tab" aria-selected={tab==='knowledge'} onClick={()=>openKnowledge('examples')}>Base de ejemplos</button>}</div>
   {tab==='direct'?<>
    <div className="chat-direct-request-modes" role="group" aria-label="Tipo de consulta"><button type="button" aria-pressed={generative} disabled={typeof onMode!=='function'||inserting} onClick={()=>onMode('generative')}><strong>Crear con IA</strong><small>Borradores nuevos · Revisión humana</small></button><button type="button" aria-pressed={!generative} disabled={typeof onMode!=='function'||inserting} onClick={()=>onMode('bank')}><strong>Buscar ejemplos</strong><small>Recuperar originales aprobados</small></button></div>
    <div className="chat-direct-toggle"><span><strong>{generative?'Historial reciente del chat':'Consulta del banco'}</strong><small>{generative?'La IA utiliza el historial reciente verificado en el servidor y las fuentes aprobadas de esta modelo. No sustituye una consulta fallida por ejemplos del banco.':'Escribe una consulta o usa el último mensaje recibido para buscar ejemplos originales. Este modo no redacta respuestas nuevas.'}</small></span></div>
    {selectedMessage&&<section className="chat-direct-received"><small>{generative?'MENSAJE SELECCIONADO · REFERENCIA VISUAL':'MENSAJE DEL FAN'}</small><p>{selectedMessage.text||'Mensaje sin texto disponible'}</p></section>}
    {latestIncoming&&String(selectedMessage?.id)!==String(latestIncoming.id)&&<section className="chat-direct-received chat-direct-latest" aria-label="Último mensaje recibido"><small>Último mensaje recibido</small><p>{latestIncoming.text}</p></section>}
    {!generative&&<label className="chat-direct-input"><span>MENSAJE DEL FAN · CONSULTA DEL BANCO</span><textarea rows="3" maxLength={2000} disabled={!context?.canRead||entry.busy} value={entry.input} onChange={event=>onInput(event.target.value)} placeholder="Opcional: usa el último mensaje recibido o escribe una consulta para el banco…"/></label>}
    <button type="button" className="chat-direct-primary chat-direct-consult" disabled={!sourceAvailable||!context?.canRead||!context?.canInsert||entry.busy||!generative&&!entry.input.trim()&&!hasIncoming} onClick={()=>void onConsult({force:false})}>{entry.busy?(generative?'Comprobando borradores…':'Buscando ejemplos…'):generative?'GENERAR RESPUESTAS':'CONSULTAR EJEMPLOS'}<span aria-hidden="true">↗</span></button>
    {currentGeneration&&<div className="chat-direct-guide-actions"><button type="button" disabled={!sourceAvailable||!context?.canRead||!context?.canInsert||entry.busy} onClick={()=>void onConsult({force:true})}>Regenerar · Nueva consulta</button><small className="chat-direct-explanation">Vigente hasta {new Date(entry.knowledge.expiresAt).toLocaleTimeString('es-ES')}. Regenerar consume una nueva consulta.</small></div>}
    {sourceAvailable&&<p className="chat-direct-explanation">{generative?'Generar reutiliza los borradores vigentes si el servidor confirma el mismo contexto y permisos. Regenerar solicita una inferencia nueva. Se ofrecen hasta tres borradores no explícitos según el límite guardado; nunca se envían automáticamente.':'El banco muestra únicamente originales comparables y revisados. Que una búsqueda no tenga coincidencias no activa la IA ni completa opciones inventadas.'}</p>}{!sourceAvailable&&<p className="chat-direct-explanation">La asistencia todavía no está conectada. No se muestran conversaciones de demostración como datos reales. Seleccionar nunca envía mensajes.</p>}
    {generative&&<GenerationUsage entry={entry} onQuota={onQuota} canRead={sourceAvailable&&context?.canRead&&context?.canInsert}/>}
    {failed&&<ConsultationFailure diagnostic={diagnostic} error={entry.error} canManage={canManage} onKnowledge={openKnowledge}/>}
    {!!unknowns.length&&<section className="chat-direct-unknowns" role="status"><strong>Datos sin confirmar</strong><ul>{unknowns.map((value,index)=><li key={index}>{value}</li>)}</ul><small>No se han completado con información inventada. Revisa las fuentes de esta modelo.</small></section>}
    {variables.length>0&&<fieldset className="chat-direct-variables"><legend>Completa los datos de la respuesta</legend><p>Solo se sustituyen los campos marcados por la fuente. Revisa cada dato; no se deduce del perfil.</p>{variables.map(variable=><label key={variable.key}><span>{variable.label}</span><input type={['bioAge','age'].includes(variable.type)?'number':'text'} min={['bioAge','age'].includes(variable.type)?18:undefined} max={['bioAge','age'].includes(variable.type)?100:undefined} maxLength={120} value={entry.values[variable.key]??''} onChange={event=>onValue(variable.key,event.target.value)}/></label>)}</fieldset>}
    <div className="chat-direct-results-heading"><h3>{generative?'Borradores IA · Revisión pendiente':'Respuestas documentadas'}</h3><span>{candidates.length} / 3</span></div>
    <div className="chat-direct-results">{candidates.map((candidate,index)=>{const text=materializeSuggestion(candidate,valuesFor(candidate,entry.values)),chosen=candidate.id===entry.selectedId;return <article className={'chat-direct-card '+(chosen?'is-selected':'')} key={candidate.id}><header><span>OPCIÓN {String(index+1).padStart(2,"0")}</span><span className={generated(candidate)?"chat-direct-generated":"chat-direct-verified"}>{generated(candidate)?"Borrador IA · Revisar":`Verificada · v${candidate.source.version}`}</span></header>{candidate.content&&<span className="chat-direct-content-badge">MENSAJE + CONTENIDO</span>}<small className="chat-direct-language-label">{generated(candidate)?"ENGLISH · BORRADOR IA":"ENGLISH · PARA ENVIAR"}</small><div className="chat-direct-english" lang="en">{text.english}</div><div className="chat-direct-spanish" lang="es"><small>{generated(candidate)?"ESPAÑOL · TRADUCCIÓN IA":"ESPAÑOL · TRADUCCIÓN"}</small><p>{text.spanish}</p></div>{!text.complete&&<p className="chat-direct-field-warning">{Object.values(text.errors).join(" ")||"Completa los campos marcados antes de copiar o insertar."}</p>}{candidate.content&&<ContentProposal candidate={candidate} canVault={context?.canVault===true}/>}<SuggestionProvenance candidate={candidate}/><footer><button type="button" disabled={entry.busy||!text.complete} onClick={()=>copyEnglish(candidate)}>Copiar inglés</button><button type="button" disabled={entry.busy} aria-pressed={chosen} onClick={()=>onSelect(candidate.id)}>{chosen?'✓ Seleccionada':'Seleccionar'}</button></footer></article>})}{!candidates.length&&!entry.busy&&!failed&&<ConsultationEmpty mode={mode} knowledge={entry.knowledge} sourceAvailable={sourceAvailable} contextReady={context?.canRead===true} canManage={canManage} onKnowledge={openKnowledge}/>} {entry.busy&&<div className="chat-direct-loading" role="status"><span/>Consultando el modo de esta modelo y verificando el contexto…</div>}</div>
    {copy&&<p className="chat-direct-status" role="status">{copy}</p>}
   </>:tab==='knowledge'&&canManage?<ChatDirectKnowledge key={JSON.stringify([actor,workspace,context?.account,knowledgeSection])} actor={actor} workspace={workspace} account={context?.account} initialSection={knowledgeSection} onChanged={onKnowledgeChanged}/>:<ChatAnalysis analysis={analysis} context={context}/>}
  </div>
  <footer className="chat-direct-footer">
   {selected&&<section className="chat-direct-picked"><strong>HAS ELEGIDO LA OPCIÓN {String(selectedIndex).padStart(2,"0")}{generated(selected)?" · BORRADOR IA":""}</strong><p lang="en">{materialized.english}</p>{selected.content&&<ContentProposal candidate={selected} canVault={context?.canVault===true} compact/>}<div><button type="button" disabled={!materialized.complete} onClick={()=>copyEnglish(selected)}>Copiar seleccionada</button><button type="button" disabled={inserting} onClick={()=>onSelect(null)}>Cambiar selección</button></div></section>}
   {entry.notice&&<p className="chat-direct-status" role="status">{entry.notice}</p>}{actionError&&<p className="chat-direct-alert" role="alert">{actionError}</p>}
   {insertion?.lease===lease?<div className="chat-direct-conflict"><strong>{selected?.content?"Ya hay una preparación en el chat":"Ya hay texto en el borrador"}</strong><p>{selected?.content?"Se reemplazarán el texto, los archivos y el precio por los de esta opción. La respuesta vinculada se conserva. No se envía nada.":"Conserva lo escrito y añade la respuesta, o reemplaza únicamente el texto. Los adjuntos y el precio se mantienen."}</p><div>{!selected?.content&&<button type="button" disabled={inserting||!canConfirm} onClick={()=>void confirm('append')}>Conservar y añadir</button>}<button type="button" disabled={inserting||!canConfirm} onClick={()=>void confirm(selected?.content?'replace-bundle':'replace')}>{selected?.content?"Reemplazar preparación":"Reemplazar texto"}</button><button type="button" disabled={inserting} onClick={()=>setInsertion(null)}>Cancelar</button></div></div>:<div className="chat-direct-confirm-row"><span>{entry.inserted?'Preparada en el borrador':selected?.content?'Mensaje y contenido seleccionados':selected?'Una respuesta seleccionada':'Selecciona una respuesta'}<small>{selected?.content?"Prepara texto y contenido · Sin enviar":generated(selected)?"Revisa el borrador IA · Preparar no envía":"Solo prepara texto · Tú decides cuándo enviarlo"}</small></span><button type="button" className="chat-direct-primary" disabled={!canConfirm} onClick={()=>void confirm()}>{inserting?'Comprobando…':entry.inserted?'Preparada':selected?.content?'Preparar en el chat':'Confirmar ✓'}</button></div>}
   <small className="chat-direct-window-help">Arrastra la cabecera o la esquina · Usa las flechas para ajustar</small>
  </footer>
  <button type="button" className="chat-direct-resize" aria-label="Cambiar tamaño del panel · usa las flechas" title="Arrastra para ajustar · Flechas para cambiar tamaño · Inicio para restaurar" onPointerDown={event=>startDrag(event,true)} onPointerMove={pointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={()=>{drag.current=null}} onKeyDown={event=>adjust(event,true)}><span aria-hidden="true">◢</span></button>
 </aside>,document.body);
}
function GenerationUsage({entry,onQuota,canRead}){
 let quota=null,usage=null;
 try{if(entry.quota)quota=validateGenerationQuota(entry.quota)}catch{/* Unknown metadata is not a zero balance. */}
 try{if(entry.knowledge?.usage)usage=validateGenerationUsage(entry.knowledge.usage)}catch{/* Never describe malformed estimates as observed usage. */}
 const number=value=>value.toLocaleString('es-ES');
 return <section className="chat-direct-analysis-prices" aria-label="Consumo de generación">
  <div className="chat-direct-results-heading"><h3>Uso de generación</h3><button type="button" disabled={!canRead||entry.busy||entry.quotaBusy||typeof onQuota!=='function'} onClick={()=>void onQuota?.()}>Actualizar cupo</button></div>
  <details><summary className="chat-direct-explanation">{entry.quotaBusy?'Comprobando cupo…':quota?`${number(quota.remainingNeurons)} neuronas disponibles · ${number(quota.modelQueries)}/${number(quota.modelDailyLimit)} consultas de esta modelo`:'Cupo sin confirmar'}</summary>
  {entry.quotaBusy?<small role="status">Comprobando cupo…</small>:quota?<>
   <p><span>Consultas de esta modelo · {quota.usageDay} UTC</span><b>{number(quota.modelQueries)} / {number(quota.modelDailyLimit)}</b></p>
   <p><span>Calculado con tokens informados</span><b>{number(quota.calculatedNeurons)} neuronas</b></p>
   <p><span title="Incluye consultas en curso, fallos inciertos y reservas antiguas sin tokens informados.">Reservas sin consumo confirmado</span><b>{number(quota.reservedNeurons)} neuronas</b></p>
   <p><span>Presupuesto BRUFF disponible</span><b>{number(quota.remainingNeurons)} / {number(quota.sharedBudgetNeurons)}</b></p>
   <small className="chat-direct-explanation">Día {quota.usageDay} · Reinicio {new Date(quota.resetsAt).toLocaleString('es-ES')}{Number.isFinite(entry.quotaAt)?` · Comprobado ${new Date(entry.quotaAt).toLocaleTimeString('es-ES')}`:''}.</small>
  </>:<p><span>{entry.quotaError||'Cupo sin confirmar'}</span><b>Sin confirmar</b></p>}
  {usage&&<p className="chat-direct-explanation">Esta generación: {usage.status==='observed'?`${number(usage.calculatedNeurons)} neuronas calculadas con ${number(usage.promptTokens)} tokens de entrada y ${number(usage.completionTokens)} de salida informados por el proveedor.`:`${number(usage.chargedNeurons)} neuronas de reserva estimada; consumo de tokens sin confirmar.`}{entry.knowledge?.reused?' El borrador se ha reutilizado; esta lectura no pidió una nueva inferencia.':''}</p>}
  <small className="chat-direct-explanation">Presupuesto compartido de generación BRUFF; no es una lectura del consumo global de la cuenta Cloudflare ni incluye otras aplicaciones o búsquedas semánticas.</small>
  </details>
 </section>;
}
function ConsultationFailure({diagnostic,error,canManage,onKnowledge}){
 return <section className="chat-direct-diagnostic" role="alert"><strong>{diagnostic?.title||'Consulta no completada'}</strong><p>{diagnostic?.text||error||'No se pudo comprobar la consulta. Puedes reintentarlo manualmente.'}</p>{diagnostic?.retryAfter&&<small>Espera indicada por el servicio: {diagnostic.retryAfter} s.</small>}{diagnostic?.reason==='disabled'&&<small>Para poder generar también deben existir ejemplos aprobados de esta modelo.</small>}{diagnostic?.section&&(canManage?<div className="chat-direct-guide-actions"><button type="button" onClick={()=>onKnowledge(diagnostic.section)}>{diagnostic.section==='generation'?'Revisar Generación':'Revisar ejemplos'}</button>{diagnostic.reason==='disabled'&&<button type="button" onClick={()=>onKnowledge('examples')}>Revisar ejemplos</button>}</div>:<small>Solicita al propietario que revise este apartado. No puedes activarlo desde tu rol.</small>)}</section>;
}
function ConsultationEmpty({mode,knowledge,sourceAvailable,contextReady,canManage,onKnowledge}){
 let title,text,needsExamples=false;
 if(!contextReady){title='Abre una conversación autorizada';text='Elige una modelo y un fan para consultar la asistencia en su contexto.'}
 else if(!sourceAvailable){title='Asistencia sin conectar';text='La consulta todavía no está disponible en este servicio.'}
 else if(!knowledge){title=mode==='generative'?'Listo para crear borradores IA':'Listo para buscar ejemplos';text=mode==='generative'?'Pulsa GENERAR RESPUESTAS para comprobar la configuración y solicitar borradores. Todavía no se ha consultado la IA.':'Consulta el banco aprobado con un mensaje. Todavía no se ha realizado ninguna búsqueda.'}
 else if(knowledge.engine==='generative'){title='La IA no propuso borradores';text='La consulta terminó sin opciones apropiadas para revisar. Comprueba los datos pendientes y las fuentes; no se rellena el número de respuestas.'}
 else if(knowledge.status==='empty'&&knowledge.approvedCount===0){title='Banco sin ejemplos aprobados';text='Todavía no hay ejemplos aprobados para esta modelo. Guardar un borrador no lo aprueba. Este modo no genera respuestas nuevas.';needsExamples=true}
 else{title='Sin coincidencias en el banco';text=`Hay ${knowledge.approvedCount} ${knowledge.approvedCount===1?'ejemplo aprobado':'ejemplos aprobados'}, pero esta consulta no devolvió opciones comparables. Prueba otro texto.`}
 return <div className="chat-direct-empty"><span aria-hidden="true">{knowledge?'⌕':'✧'}</span><strong>{title}</strong><p>{text}</p>{needsExamples&&(canManage?<div className="chat-direct-guide-actions"><button type="button" onClick={()=>onKnowledge('examples')}>Revisar ejemplos</button></div>:<p>El propietario debe incorporar y aprobar las fuentes de esta modelo.</p>)}</div>;
}
function SuggestionProvenance({candidate}){
 if(!generated(candidate))return <details><summary>Referencia del ejemplo</summary><p>{sourceReference(candidate.source)}</p></details>;
 return <details className="chat-direct-generated-provenance"><summary>Fuentes utilizadas y trazabilidad</summary><p>Este texto es un borrador nuevo de IA. Las fuentes utilizadas se aprobaron por separado; no acreditan que esta respuesta sea una cita literal ni que sus datos estén verificados.</p><p>Generación: {candidate.generationId}</p><strong>Ejemplos utilizados</strong><ul>{candidate.exampleIds.map(id=><li key={id}>{id}</li>)}</ul><strong>Conocimiento utilizado</strong>{candidate.knowledgeIds.length?<ul>{candidate.knowledgeIds.map(id=><li key={id}>{id}</li>)}</ul>:<p>Sin referencias de conocimiento declaradas para este borrador.</p>}<small>Disponible para revisión hasta {new Date(candidate.expiresAt).toLocaleString('es-ES')}. Se volverá a comprobar antes de preparar.</small></details>;
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
