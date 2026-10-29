import React, { useState } from 'react';
import { canAssist } from '../policy.js';
export default function ConversationList({fans,config,current,onSelect,onBulk}) {
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const [selected,setSelected]=useState([]);
  const visible=fans.filter(f=>f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())&&(filter!=='active'||canAssist(config,f)));
  return <aside className="list">
    <input aria-label="Buscar fan" placeholder="Buscar conversación…" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="filters">{[['all','Todos'],['active','Con asistente']].map(([id,label])=><button key={id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{label}</button>)}</div>
    <div className="people">{visible.map(f=><div className="fan-row" key={f.id}>
      <input className="switch" type="checkbox" aria-label={`Seleccionar ${f.name}`} checked={selected.includes(f.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,f.id]:old.filter(id=>id!==f.id))}/>
      <button className={`person ${current===f.id?'selected':''}`} onClick={()=>onSelect(f.id)}><span className="avatar">{f.name[0]}</span><span><strong>{f.name}</strong><small>{f.tag}</small></span>{canAssist(config,f)&&<span className="dot" title="Asistente habilitado">●</span>}</button>
    </div>)}{!visible.length&&<div className="empty">No hay coincidencias.</div>}</div>
    {selected.length>0&&<div className="bulk"><p>{selected.length} fans seleccionados</p><div className="filters"><button disabled={config.mode!=='selected'} onClick={()=>onBulk(selected,true)}>Activar</button><button disabled={config.mode!=='selected'} onClick={()=>onBulk(selected,false)}>Desactivar</button><button onClick={()=>setSelected([])}>Limpiar</button></div>{config.mode!=='selected'&&<p className="hint">Cambia a selección manual en Mi asistente.</p>}</div>}
  </aside>;
}
