import React,{useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {authClient} from '../auth.js';
import ChatDirectModelKnowledge from './ChatDirectModelKnowledge.jsx';
import './ChatDirectKnowledge.css';

const blank=()=>({id:null,version:0,trigger:'',english:'',spanish:'',referenceId:'',label:'',sourceVersion:'',state:'draft'});
const limits={trigger:2000,english:10000,spanish:10000,referenceId:128,label:200,sourceVersion:96};
const labels={verified:'Aprobado',draft:'Borrador',archived:'Archivado'};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value);
const denied=error=>error?.code==='42501'||[401,403].includes(Number(error?.status));
const cancelled=error=>error?.name==='AbortError';
function snapshot(data){
 if(data?.schemaVersion!==1||!Array.isArray(data.items)||data.items.length>200||!Number.isSafeInteger(data.total)||data.total<data.items.length||data.limit!==200||typeof data.complete!=='boolean'||data.canEdit!==true)throw Error('invalid-response');
 const ids=new Set();
 for(const item of data.items){
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||!Number.isSafeInteger(item.version)||item.version<1||!Object.hasOwn(labels,item.state))throw Error('invalid-response');
  for(const [field,max] of Object.entries(limits))if(typeof item[field]!=='string'||!item[field].trim()||item[field].length>max)throw Error('invalid-response');
  if(!identifier(item.referenceId)||!identifier(item.sourceVersion))throw Error('invalid-response');ids.add(item.id);
 }
 return {...data,complete:data.complete&&data.total===data.items.length};
}
function editable(item){return Object.fromEntries(Object.keys(blank()).map(key=>[key,item[key]]))}
function readError(error){
 if(denied(error))return 'No tienes permiso para gestionar esta base. Se ha retirado la información de esta vista.';
 if(['PGRST202','42883'].includes(error?.code))return 'La base documental todavía no está habilitada en este servicio.';
 return 'No se pudo consultar la base de ejemplos. Puedes volver a intentarlo.';
}

export default function ChatDirectKnowledge({workspace,account,actor,onChanged,initialSection='examples'}){
 const w=typeof workspace==='string'?workspace:workspace?.id,c=typeof account==='string'?account:account?.id;
 const section=['examples','knowledge','generation'].includes(initialSection)?initialSection:'examples',scope=JSON.stringify([actor,w,c,section]);
 return <KnowledgeHub key={scope} workspace={w} account={c} actor={actor} onChanged={onChanged} initialSection={section}/>;
}

function KnowledgeHub(props){
 const [section,setSection]=useState(props.initialSection||'examples'),tabs=[['examples','Ejemplos'],['knowledge','Modelo'],['generation','Generación']];
 const navigate=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=tabs.findIndex(([key])=>key===section),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setSection(tabs[next][0]);event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus()};
 return <div className="chat-direct-knowledge-hub"><div className="chat-direct-knowledge-subtabs" role="tablist" aria-label="Administrar conocimiento de esta modelo" onKeyDown={navigate}>{tabs.map(([key,label])=><button type="button" role="tab" key={key} aria-selected={section===key} tabIndex={section===key?0:-1} onClick={()=>setSection(key)}>{label}</button>)}</div>{section==='examples'?<KnowledgeEditor {...props}/>:<ChatDirectModelKnowledge {...props} mode={section}/>}</div>;
}

function KnowledgeEditor({workspace,account,actor,onChanged}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[accessDenied,setAccessDenied]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[form,setForm]=useState(blank),[reviewed,setReviewed]=useState(false),[archiveConfirm,setArchiveConfirm]=useState(false),[filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[needsReload,setNeedsReload]=useState(false);
 const mounted=useRef(false),read=useRef(null),generation=useRef(0),writeGeneration=useRef(0),writeLock=useRef(false),changeRef=useRef(onChanged),prefix=useId();
 changeRef.current=onChanged;
 const valid=[workspace,account,actor].every(value=>typeof value==='string'&&value.length>0),canEdit=valid&&data?.canEdit===true&&!accessDenied;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;writeGeneration.current++;read.current?.abort()}},[]);
 const clearDenied=useCallback(()=>{setData(null);setAccessDenied(true);setForm(blank());setReviewed(false);setArchiveConfirm(false)},[]);
 const load=useCallback(async()=>{
  if(!valid||writeLock.current)return;
  read.current?.abort();const controller=new AbortController(),version=++generation.current;read.current=controller;
  const current=()=>mounted.current&&generation.current===version&&!controller.signal.aborted;
  setLoading(true);setError('');
  try{
   const {data:result,error:failure}=await authClient.rpc('bruff_chat_direct_knowledge',{w:workspace,c:account,op:'list',example_id:null,expected:null,value:null}).abortSignal(controller.signal);
   if(!current())return;if(failure)throw failure;
   setData(snapshot(result));setAccessDenied(false);setNeedsReload(false);
  }catch(failure){if(current()&&!cancelled(failure)){if(denied(failure))clearDenied();setError(readError(failure))}}
  finally{if(current()){setLoading(false);read.current=null}}
 },[workspace,account,valid,clearDenied]);
 useEffect(()=>{
  if(open)load();else{generation.current++;read.current?.abort();read.current=null;setLoading(false)}
  return()=>{generation.current++;read.current?.abort()};
 },[open,load]);

 const choose=useCallback(item=>{
  if(writeLock.current)return;setForm(item?editable(item):blank());setReviewed(false);setArchiveConfirm(false);setError('');setNotice('');
 },[]);
 const change=(field,value)=>{setForm(previous=>({...previous,[field]:value}));setReviewed(false);setArchiveConfirm(false);setNotice('')};
 const validation=()=>{
  for(const [field,max] of Object.entries(limits))if(typeof form[field]!=='string'||!form[field].trim()||form[field].length>max)return 'Completa los textos y la referencia antes de guardar. Se conservan tus espacios y saltos de línea.';
  if(!identifier(form.referenceId)||!identifier(form.sourceVersion))return 'La referencia y su versión solo admiten letras, números, guion, punto, dos puntos y guion bajo, sin espacios.';
  return '';
 };
 const mutate=async(op,state)=>{
  if(writeLock.current||!canEdit||needsReload)return;
  if(op==='save'){const problem=validation();if(problem){setError(problem);return}if(state==='verified'&&!reviewed){setError('Revisa la fuente y marca la comprobación humana antes de aprobar.');return}}
  if(op==='archive'&&!form.id)return;
  writeLock.current=true;read.current?.abort();read.current=null;generation.current++;const version=++writeGeneration.current;
  const current=()=>mounted.current&&writeGeneration.current===version;
  setLoading(false);setSaving(true);setError('');setNotice('');setArchiveConfirm(false);
  try{
   const value=op==='save'?{trigger:form.trigger,english:form.english,spanish:form.spanish,referenceId:form.referenceId,label:form.label,sourceVersion:form.sourceVersion,state,...(state==='verified'?{reviewed:true}:{})}:null;
   const {data:result,error:failure}=await authClient.rpc('bruff_chat_direct_knowledge',{w:workspace,c:account,op,example_id:form.id,expected:form.id?form.version:0,value});
   if(!current())return;if(failure)throw failure;
   const next=snapshot(result),savedId=typeof result.savedId==='string'?result.savedId:form.id;
   setData(next);setAccessDenied(false);setNeedsReload(false);const saved=next.items.find(item=>item.id===savedId);setForm(saved?editable(saved):blank());setReviewed(false);
   setNotice(op==='archive'?'Ejemplo archivado. Ya no estará disponible para nuevas sugerencias.':state==='verified'?'Ejemplo aprobado y guardado en esta modelo. No se ha enviado ningún mensaje.':'Borrador guardado. Todavía no se usará como sugerencia.');
   try{changeRef.current?.({workspace,account,actor,id:savedId,operation:op})}catch{/* The save is already confirmed; an optional UI callback cannot undo it. */}
  }catch(failure){
   if(current()){
    if(denied(failure)){clearDenied();setError(readError(failure))}
    else{setNeedsReload(true);setError(failure?.code==='40001'?'El ejemplo cambió en otra sesión. Actualiza la lista y abre su versión actual antes de guardar.':'No se pudo confirmar la operación. Actualiza la lista y comprueba si se guardó antes de repetirla. Tus textos siguen en el formulario.')}
   }
  }finally{writeLock.current=false;if(current())setSaving(false)}
 };
 const rows=data?.items||[],visible=useMemo(()=>{
  const text=query.trim().toLocaleLowerCase('es');return rows.filter(item=>(filter==='all'||item.state===filter)&&(!text||[item.label,item.trigger,item.referenceId].some(value=>value.toLocaleLowerCase('es').includes(text))));
 },[rows,filter,query]);
 const locked=saving||!canEdit,saveLocked=locked||needsReload;
 return <details className="chat-direct-knowledge" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><span><strong>Base de ejemplos</strong><small>Propietario</small></span><span className="chat-direct-knowledge-chevron" aria-hidden="true">⌄</span></summary>
  {open&&<div className="chat-direct-knowledge-body">
   <p className="chat-direct-knowledge-intro">Guarda respuestas no explícitas con una fuente documental y traducción revisadas. Aprobar un ejemplo lo habilita para recuperarlo; no entrena un modelo ni envía mensajes.</p>
   <div className="chat-direct-knowledge-toolbar"><span aria-live="polite">{loading?'Consultando la base…':data?`${rows.length} ${rows.length===1?'ejemplo recibido':'ejemplos recibidos'}`:'Base sin consultar'}</span><div><button type="button" onClick={load} disabled={!valid||loading||saving}>Actualizar</button><button type="button" onClick={()=>choose(null)} disabled={!canEdit||saving}>+ Nuevo</button></div></div>
   {data&&!data.complete&&<p className="chat-direct-knowledge-warning">Se muestran {rows.length} de {data.total} ejemplos. Esta vista tiene un límite de {data.limit}; no representa la base completa.</p>}
   {error&&<p className="chat-direct-knowledge-error" role="alert">{error}</p>}{notice&&<p className="chat-direct-knowledge-notice" role="status">{notice}</p>}
   {!valid&&<p className="chat-direct-knowledge-error" role="alert">Selecciona una modelo y verifica tu sesión para gestionar sus ejemplos.</p>}
   {data&&<><div className="chat-direct-knowledge-find"><label htmlFor={prefix+'-search'}><span>Buscar ejemplo</span><input id={prefix+'-search'} type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Título, mensaje o referencia"/></label><label htmlFor={prefix+'-filter'}><span>Estado</span><select id={prefix+'-filter'} value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Todos</option><option value="verified">Aprobados</option><option value="draft">Borradores</option><option value="archived">Archivados</option></select></label></div>
   <div className="chat-direct-knowledge-list" aria-label="Ejemplos documentados">{visible.map(item=><button type="button" key={item.id} className={'chat-direct-knowledge-item'+(form.id===item.id?' is-selected':'')} onClick={()=>choose(item)} disabled={saving} aria-pressed={form.id===item.id}><span><strong>{item.label}</strong><small>{item.trigger}</small><em>{item.referenceId} · {item.sourceVersion} · revisión {item.version}</em></span><b data-state={item.state}>{labels[item.state]}</b></button>)}{!visible.length&&<p className="chat-direct-knowledge-empty">{rows.length?'No hay ejemplos con este filtro.':'Todavía no hay ejemplos guardados para esta modelo. Puedes crear el primero con su fuente real.'}</p>}</div></>}
   <form className="chat-direct-knowledge-form" onSubmit={event=>event.preventDefault()}>
    <header><strong>{form.id?'Editar ejemplo':'Nuevo ejemplo'}</strong>{form.id&&<span>{labels[form.state]} · revisión {form.version}</span>}</header>
    <fieldset disabled={locked}><label htmlFor={prefix+'-label'}><span>Título o etiqueta de la fuente</span><input id={prefix+'-label'} value={form.label} maxLength={limits.label} onChange={event=>change('label',event.target.value)} placeholder="Un título que identifique tu documento"/></label>
     <label htmlFor={prefix+'-trigger'}><span>Mensaje del fan · Contexto de referencia</span><textarea id={prefix+'-trigger'} value={form.trigger} maxLength={limits.trigger} onChange={event=>change('trigger',event.target.value)} placeholder="Mensaje documentado al que responde el ejemplo"/></label>
     <label htmlFor={prefix+'-english'}><span>English · Original literal</span><textarea id={prefix+'-english'} value={form.english} maxLength={limits.english} lang="en" spellCheck={false} onChange={event=>change('english',event.target.value)} placeholder="Respuesta original no explícita, sin inventar ni reescribir"/></label>
     <label htmlFor={prefix+'-spanish'}><span>Español · Traducción revisada</span><textarea id={prefix+'-spanish'} value={form.spanish} maxLength={limits.spanish} lang="es" onChange={event=>change('spanish',event.target.value)} placeholder="Traducción fiel al original"/></label>
     <div className="chat-direct-knowledge-source"><label htmlFor={prefix+'-reference'}><span>Identificador documental</span><input id={prefix+'-reference'} value={form.referenceId} maxLength={limits.referenceId} autoCapitalize="none" spellCheck={false} onChange={event=>change('referenceId',event.target.value)} placeholder="Identificador de la fuente real"/></label><label htmlFor={prefix+'-version'}><span>Versión de la fuente</span><input id={prefix+'-version'} value={form.sourceVersion} maxLength={limits.sourceVersion} autoCapitalize="none" spellCheck={false} onChange={event=>change('sourceVersion',event.target.value)} placeholder="Versión comprobada"/></label></div>
     <p className="chat-direct-knowledge-hint">Usa identificadores sin espacios. No pegues contraseñas, claves ni enlaces de acceso. La referencia identifica una fuente revisada por ti; no acredita una importación automática de chats.</p>
     <label className="chat-direct-knowledge-review"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>He contrastado el original, la traducción y la referencia. Confirmo que el ejemplo es no explícito y pertenece a esta modelo.</span></label>
    </fieldset>
    {needsReload&&<p className="chat-direct-knowledge-warning">La escritura está en pausa hasta que actualices la lista. No se repetirá automáticamente.</p>}
    <div className="chat-direct-knowledge-actions"><button type="button" disabled={saveLocked} onClick={()=>mutate('save','draft')}>{saving?'Guardando…':'Guardar borrador'}</button><button className="chat-direct-knowledge-approve" type="button" disabled={saveLocked||!reviewed} onClick={()=>mutate('save','verified')}>Guardar aprobado</button>{form.id&&form.state!=='archived'&&<button className="chat-direct-knowledge-archive" type="button" disabled={saveLocked} onClick={()=>setArchiveConfirm(true)}>Archivar</button>}</div>
    {archiveConfirm&&<div className="chat-direct-knowledge-confirm" role="group" aria-label="Confirmar archivo"><p>Este ejemplo dejará de ofrecerse en nuevas consultas. El registro y su referencia se conservan.</p><div><button type="button" disabled={saveLocked} onClick={()=>mutate('archive')}>Confirmar archivo</button><button type="button" disabled={saving} onClick={()=>setArchiveConfirm(false)}>Cancelar</button></div></div>}
   </form>
  </div>}
 </details>;
}
