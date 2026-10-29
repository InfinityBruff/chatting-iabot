import React,{useState} from 'react';
import {validateConfig} from '../policy.js';
export default function AssistantSettings({config,onSave}) {
  const [draft,setDraft]=useState({...config});
  const [error,setError]=useState('');
  const update=(name,value)=>setDraft(old=>({...old,[name]:value}));
  return <form className="panel settings" onSubmit={e=>{e.preventDefault();const error=validateConfig(draft);setError(error);if(!error)onSave(draft)}}>
    <h2>El asistente, a tu manera</h2><div className="grid">
      <label>Activación<select value={draft.mode} onChange={e=>update('mode',e.target.value)}><option value="selected">Fans seleccionados</option><option value="all">Todos los fans</option><option value="off">Pausar asistente</option></select><div className="hint">Activa fans uno a uno o en grupo desde la bandeja.</div></label>
      <label>Tono<select value={draft.tone} onChange={e=>update('tone',e.target.value)}>{['Cercano y natural','Directo y breve','Cálido y expresivo','Personalizado'].map(v=><option key={v}>{v}</option>)}</select></label>
      {[['instructions','Instrucciones de comportamiento',12000],['words','Palabras y expresiones preferidas',3000],['avoid','Palabras y hábitos que evitar',3000]].map(([name,title,max])=><label key={name} className={name==='instructions'?'wide':''}>{title}<textarea maxLength={max} value={draft[name]} onChange={e=>update(name,e.target.value)}/></label>)}
      {[['min','Espera mínima (segundos)'],['max','Espera máxima (segundos)']].map(([name,title])=><label key={name}>{title}<input type="number" min="0" max="3600" step="1" required value={draft[name]} onChange={e=>update(name,e.target.value===''?'':Number(e.target.value))}/></label>)}
      <label className="wide row"><span>Respetar el tiempo de visualización de vídeos<div className="hint">Regla para una integración futura. No simula grabaciones en directo.</div></span><input className="switch" type="checkbox" checked={draft.video} onChange={e=>update('video',e.target.checked)}/></label>
    </div>{error&&<p className="error" role="alert">{error}</p>}<div className="row"><p style={{fontSize:12}}>Los ajustes se conservan en este navegador.<br/>Se aplicarán a la IA cuando esté conectada.</p><button className="primary">Guardar configuración</button></div>
  </form>;
}
