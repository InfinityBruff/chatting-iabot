import React,{useEffect,useId,useRef,useState} from 'react';

const options=[
 ['custom','Nombre personalizado','El nombre personalizado que has asignado (si está disponible).'],
 ['fan','Nombre del fan','El nombre del perfil del fan (si está disponible).'],
 ['fan_custom','Nombre del fan → Nombre personalizado','Utiliza primero el nombre del fan. Si no está disponible, utiliza el nombre personalizado.'],
 ['custom_fan','Nombre personalizado → Nombre del fan','Utiliza primero el nombre personalizado. Si no está disponible, utiliza el nombre del fan.']
];

export default function DynamicName({step,index,onChange}){
 const [open,setOpen]=useState(false),[position,setPosition]=useState({}),root=useRef(null),trigger=useRef(null),popup=useRef(null),id=useId();
 const close=()=>{setOpen(false);trigger.current?.focus()};
 useEffect(()=>{
  if(!open)return;
  popup.current?.showPopover();
  const outside=e=>{if(!root.current?.contains(e.target))setOpen(false)};
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const choose=mode=>{
  onChange({...step,nameMode:mode,text:mode!=='none'&&!step.text.includes('{nombre}')?(step.text+' {nombre}').trim().slice(0,3000):step.text});close();
 };
 const toggle=()=>{if(!open){const r=trigger.current.getBoundingClientRect();setPosition({left:Math.max(12,Math.min(r.right-282,window.innerWidth-294)),top:Math.max(12,Math.min(r.bottom+8,window.innerHeight-680)),maxHeight:Math.min(660,window.innerHeight-24)})}setOpen(!open)};
 return <div className="am-dynamic-name" ref={root} onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();close()}}}>
  <div className="am-dynamic-controls">
   <button ref={trigger} type="button" className="am-dynamic-trigger" aria-expanded={open} aria-controls={id} onClick={toggle}>Nombre dinámico <span aria-hidden="true">⌄</span></button>
   <input aria-label={'Nombre alternativo del mensaje '+(index+1)} maxLength={80} placeholder="Nombre alternativo" value={step.fallback} onChange={e=>onChange({...step,fallback:e.target.value})}/>
  </div>
  {step.nameMode!=='none'&&<div className="am-dynamic-selected"><span>{options.find(([key])=>key===step.nameMode)?.[1]}</span><button type="button" aria-label="Quitar nombre dinámico" onClick={()=>choose('none')}>×</button></div>}
  {open&&<div ref={popup} popover="manual" id={id} style={position} className="am-dynamic-popup" role="group" aria-label="Opciones de nombre dinámico">
   <div className="am-dynamic-options" role="radiogroup" aria-label="Origen del nombre">{options.map(([mode,title,description],i)=><button type="button" key={mode} role="radio" aria-checked={step.nameMode===mode} onClick={()=>choose(mode)} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowDown'?1:3))%4;e.currentTarget.parentElement.children[next].focus()}}}><strong>{title}</strong><small>{description}</small></button>)}</div>
   <p>Establece un nombre alternativo para cuando no haya un nombre personalizado ni un nombre del fan. Utiliza un nombre cariñoso como «Cariño» o «Cielo» cuando no conozcas su nombre.</p>
   <label className="am-dynamic-first"><input type="checkbox" role="switch" checked={step.firstName} onChange={e=>onChange({...step,firstName:e.target.checked})}/><span className="am-switch"/><span>Primera palabra del nombre</span><span title="Por ejemplo: Alex García se convierte en Alex." aria-label="Por ejemplo: Alex García se convierte en Alex.">ⓘ</span></label>
  </div>}
 </div>;
}
