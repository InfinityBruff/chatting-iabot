import React,{useEffect,useMemo,useRef,useState} from 'react';
import {authClient} from '../auth.js';
import {createFanMemorySource} from '../fan-memory-source.js';
import './chat-direct-fan-memory.css';
const categories={preferred_name:'Nombre preferido',language:'Idioma',interests:'Intereses declarados',availability:'Disponibilidad declarada',pending_question:'Pregunta pendiente',commitment:'Compromiso registrado'};
export default function ChatDirectFanMemory({actor,workspace,context,canManage,onChanged}){
 const key=JSON.stringify([actor,workspace,context?.account,context?.fanId,context?.canRead]);
 return <FanMemory key={key} {...{actor,workspace,context,canManage,onChanged}}/>;
}
function FanMemory({actor,workspace,context,canManage,onChanged}){
 const [snapshot,setSnapshot]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState(null),[value,setValue]=useState('');
 const alive=useRef(true),job=useRef(null),serial=useRef(0);
 const source=useMemo(()=>{try{return createFanMemorySource(authClient,{actor,workspace,account:context?.account,fanId:context?.fanId,canRead:context?.canRead})}catch{return null}},[actor,workspace,context?.account,context?.fanId,context?.canRead]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;serial.current++;job.current?.abort()}},[]);
 async function run(action){
  if(!source||job.current)return;const controller=new AbortController(),version=++serial.current;job.current=controller;setBusy(true);setError('');setNotice('');
  const live=()=>alive.current&&serial.current===version&&!controller.signal.aborted;
  try{
   let next;
   if(action==='history'){
    next=await source.read(controller.signal);let pages=0;
    if(next.coverage.pages===0){next=await source.sync('recent',controller.signal);pages++}
    while(!next.coverage.historyComplete&&!next.coverage.contextLimited&&pages<25){if(live())setSnapshot(next);next=await source.sync('older',controller.signal);pages++}
    if(live())setNotice(next.coverage.historyComplete?'Historial disponible recorrido hasta su inicio. Los recuerdos pendientes siguen necesitando revisión.':next.coverage.contextLimited?'Se alcanzó un límite de contexto. El avance se conserva y necesita revisión antes de ampliar el recorrido.':'Avance guardado. Puedes continuar el recorrido desde este punto.');
   }else if(typeof action==='object'){next=await source.edit({...action,expected_version:snapshot.version},controller.signal);if(live()){setEditing(null);setNotice('Cambio guardado en la nube. Genera de nuevo para usar el contexto actualizado.')}}
   else next=await (action==='recent'?source.sync('recent',controller.signal):source.read(controller.signal));
   if(live()){setSnapshot(next);if(action!=='read')onChanged?.()}
  }catch(e){if(live()){if([401,403].includes(e.status))setSnapshot(null);setError(e.message||'No se pudo consultar la memoria.')}}
  finally{if(job.current===controller){job.current=null;if(alive.current)setBusy(false)}}
 }
 useEffect(()=>{void run('read')},[source]);
 function stop(){serial.current++;job.current?.abort();job.current=null;setBusy(false);setNotice('Recorrido detenido. El avance ya guardado se conserva.');onChanged?.()}
 const coverage=snapshot?.coverage;
 return <section className="chat-direct-fan-memory" aria-label="Memoria privada del fan">
  <header><small>CONTEXTO POR FAN Y CUENTA</small><h3>Memoria del fan</h3><p>Recuerdos con procedencia. Las declaraciones del fan no acreditan pagos ni datos de la modelo.</p></header>
  <div className="fan-memory-summary"><div><small>HISTORIAL</small><strong>{!coverage?'Sin comprobar':coverage.historyComplete?'Inicio alcanzado':'Recorrido parcial'}</strong></div><div><small>MENSAJES OBSERVADOS</small><strong>{coverage?.messagesObserved??'—'}</strong></div><div><small>CONTEXTO APROBADO</small><strong>{snapshot?snapshot.items.filter(i=>i.status==='confirmed').length:'—'}</strong></div></div>
  {coverage?.contextLimited&&<p className="chat-direct-explanation">La memoria conserva un resumen limitado; recorrer el historial no significa incluir cada mensaje en cada consulta.</p>}
  <div className="fan-memory-actions"><button type="button" disabled={!source||busy} onClick={()=>run('recent')}>Actualizar reciente</button><button type="button" disabled={!source||busy||coverage?.historyComplete||coverage?.contextLimited} onClick={()=>run('history')}>{coverage?.pages?'Continuar historial':'Recorrer historial'}</button>{busy&&<button type="button" onClick={stop}>Detener</button>}</div>
  {busy&&<p role="status">Comprobando contexto… El chat permanece disponible.</p>}{error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>run('read')}>Actualizar</button></p>}{notice&&<p role="status">{notice}</p>}
  {!busy&&snapshot&&!snapshot.items.length&&<p className="chat-direct-explanation">Todavía no hay recuerdos extraídos. Actualiza los mensajes recientes o recorre el historial disponible.</p>}
  <div className="fan-memory-items">{snapshot?.items.map(item=><article key={item.key} data-conflict={item.key.includes('_conflict_')?'true':undefined}><div className="fan-memory-item-title"><small>{categories[item.category]}</small><span>{item.status==='confirmed'?'Revisado':'Pendiente'}{item.pinned?' · Fijado':''}</span></div><p>{item.value}</p>{item.key.includes('_conflict_')&&<p className="chat-direct-explanation">Dato contradictorio. Revisa y corrige o excluye el recuerdo anterior. Confirmar este registro no sustituye por sí solo al anterior.</p>}<details><summary>Ver procedencia</summary><blockquote>{item.source.quote}</blockquote><small>Mensaje {item.source.messageId} · {new Date(item.source.at).toLocaleString('es-ES')} · {item.origin==='manual'?'Corrección del propietario':item.source.author==='fan'?'Declaración del fan':'Mensaje de la cuenta'}</small></details>{canManage&&<div className="fan-memory-actions">{item.status==='pending'&&<button type="button" disabled={busy} onClick={()=>run({key:item.key,action:'confirm'})}>Confirmar recuerdo</button>}<button type="button" disabled={busy} onClick={()=>{setEditing(item.key);setValue(item.value)}}>Corregir</button>{!item.pinned&&<button type="button" disabled={busy} onClick={()=>run({key:item.key,action:'pin'})}>Fijar</button>}<button type="button" disabled={busy} onClick={()=>run({key:item.key,action:'delete'})}>Excluir</button></div>}{editing===item.key&&canManage&&<form onSubmit={e=>{e.preventDefault();void run({key:item.key,action:'correct',value})}}><label>Corrección del propietario<textarea maxLength={1000} value={value} onChange={e=>setValue(e.target.value)} required/></label><button type="submit" disabled={busy||!value.trim()}>Guardar corrección</button><button type="button" onClick={()=>setEditing(null)}>Cancelar</button></form>}</article>)}</div>
 </section>;
}
