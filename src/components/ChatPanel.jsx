import React,{useEffect,useRef,useState} from 'react';
import {canAssist} from '../policy.js';
export default function ChatPanel({fan,config,onToggle,onMessage}) {
  const [draft,setDraft]=useState('');
  const scroll=useRef(null);
  useEffect(()=>{scroll.current.scrollTop=scroll.current.scrollHeight},[fan.messages]);
  return <section className="chat">
    <div className="chathead"><div><strong>{fan.name}</strong><p style={{fontSize:12}}>Conversación de ejemplo</p></div><label className="toggle-label"><input className="switch" type="checkbox" disabled={config.mode!=='selected'} checked={fan.on} onChange={e=>onToggle(fan.id,e.target.checked)}/>Asistente {canAssist(config,fan)?'habilitado':'desactivado'}</label></div>
    {config.mode!=='selected'&&<div className="note mode-hint">Para elegir fans individualmente, selecciona «Fans seleccionados» en Mi asistente.</div>}
    <div className="messages" ref={scroll}>{fan.messages.map((m,i)=><div key={i} className={`bubble ${m.mine?'mine':''}`}>{m.text}</div>)}</div>
    <form className="composer" onSubmit={e=>{e.preventDefault();if(!draft.trim())return;onMessage(fan.id,draft.trim());setDraft('')}}><input aria-label="Mensaje de prueba" placeholder="Escribe un mensaje de prueba…" value={draft} maxLength={3000} required onChange={e=>setDraft(e.target.value)}/><button className="primary">Añadir</button></form>
    <div className="note">Los mensajes se añaden solo a esta demostración. El asistente aún no genera respuestas.</div>
  </section>;
}
