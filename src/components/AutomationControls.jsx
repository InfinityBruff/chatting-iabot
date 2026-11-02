import React,{useEffect,useId,useRef,useState} from 'react';
import AutomationSchedule from './AutomationSchedule.jsx';

// Every source is supplied by the selected model's directory. No cross-model cache.
export function AudiencePicker({label,rows,value,onChange,loading=false,error='',allOption=false}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),root=useRef(null),id=useId();
 useEffect(()=>{const close=e=>{if(!root.current?.contains(e.target))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
 const options=[...(allOption?[{id:'__all',name:'Todos los fans',detail:'Directorio completo al ejecutar'}]:[]),...rows];
 const selected=options.filter(r=>value.includes(String(r.id))),matches=options.filter(r=>[r.name,r.username,r.id].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <div className="am-audience-picker" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector('button')?.focus()}}}>
  <label id={id}>{label}</label><button type="button" aria-labelledby={id} aria-expanded={open} aria-controls={id+'-options'} onClick={()=>setOpen(!open)}><span>{selected.length?selected.slice(0,3).map(r=>r.name||r.username||r.id).join(', ')+(selected.length>3?' +'+(selected.length-3):''):'Haz clic y selecciona…'}</span><span>⌄</span></button>
  {open&&<div id={id+'-options'} className="am-audience-popover"><input autoFocus aria-label={'Buscar en '+label} placeholder="Buscar…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="am-audience-results" role="group" aria-label={label}>{matches.map(r=><label key={r.id}><input type="checkbox" checked={value.includes(String(r.id))} onChange={e=>onChange(e.target.checked?[...value,String(r.id)]:value.filter(v=>v!==String(r.id)))}/>{r.avatar&&<img src={r.avatar} alt="" loading="lazy"/>}<span>{r.name||r.username||r.id}<small>{r.detail|| (r.usersCount!=null?r.usersCount+' fans':r.username?'@'+r.username:'')}</small></span></label>)}{!matches.length&&<p>{error|| (loading?'Sincronizando el directorio…':'Sin resultados')}</p>}</div><footer>{value.length} seleccionados <button type="button" onClick={()=>setOpen(false)}>Listo</button></footer></div>}
 </div>;
}
export function BulkAudience({draft,set,directory,lists}){
 const b=draft.bulk;
 return <><div className="am-include-heading"><span>✓</span><h3>Incluir fans</h3></div><p className="am-help">Recibirían el mensaje los fans que coincidan con esta selección.</p>
 <div className="am-audience-mode" role="group" aria-label="Modo de audiencia">{[['all','Todos los fans'],['collections','Colecciones'],['selected','Elegir fans']].map(([id,label])=><button key={id} type="button" aria-pressed={b.audience===id} onClick={()=>set('bulk',{...b,audience:id})}>{label}</button>)}</div>
 {b.audience==='all'?<div className="am-all-fans"><strong>Todos los fans de esta modelo</strong><span>{directory.complete?directory.rows.length+' perfiles sincronizados':directory.rows.length+' perfiles disponibles · sincronizando'}</span><small>Se consultará el directorio completo, incluidos caducados. OnlyFans decide qué destinatarios pueden recibir mensajes; una lista parcial no se considera completa.</small></div>:b.audience==='collections'?<AudiencePicker label="Colecciones a incluir" rows={lists.rows} value={b.listIds} onChange={v=>set('bulk',{...b,listIds:v})} loading={!lists.complete} error={lists.error}/>:<AudiencePicker label="Fans a incluir" rows={directory.rows} value={b.recipients} onChange={v=>set('bulk',{...b,recipients:v})} loading={!directory.complete} error={directory.error}/>}
 </>;
}
export function BulkSchedule({bulk,onChange}){return <div className="am-bulk-schedule"><AutomationSchedule draft={{...bulk,type:'mass'}} set={(key,value)=>onChange({...bulk,[key]:value})}/></div>}
export function DurationFields({value,onChange,disabled=false}){
 const minutes=Number(value)||0;
 return <div className="am-duration-fields">{[['Días',1440,Math.floor(minutes/1440),365],['Horas',60,Math.floor(minutes%1440/60),23],['Minutos',1,minutes%60,59]].map(([label,mult,n,max])=><label key={label}>{label}<input aria-label={'Duración · '+label.toLowerCase()} type="number" min="0" max={max} value={n} disabled={disabled} onChange={e=>onChange(minutes-n*mult+Number(e.target.value)*mult)}/></label>)}</div>;
}
