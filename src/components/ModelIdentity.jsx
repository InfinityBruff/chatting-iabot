import React,{createContext,useContext,useEffect,useId,useRef,useState} from 'react';
import {liveRequest} from './LiveData.jsx';
import './model-identity.css';
const Profiles=createContext({});
export function ModelProfiles({workspace,accounts,children}){
 const [state,setState]=useState({});
 const signature=JSON.stringify(accounts.map(a=>[a.id,a.chat,a.analytics,a.vault]));
 useEffect(()=>{let active=true;setState({});
  let timer;const pending=[...accounts];
  async function next(){const a=pending.shift();if(!active||!a)return;try{const r=await liveRequest(workspace,'profile',{creator_id:a.id},{active:()=>active});if(active)setState(old=>({...old,[a.id]:r.data}))}catch(e){if(e.status===429){pending.unshift(a);if(active)timer=setTimeout(next,Math.max(1000,(e.retryAfter||60)*1000));return}}if(active)timer=setTimeout(next,200)}
  timer=setTimeout(next,750);
  return()=>{active=false;clearTimeout(timer)};
 },[workspace,signature]);
 return <Profiles.Provider value={state}>{children}</Profiles.Provider>;
}
export function ModelAvatar({account,size=36}){
 const profiles=useContext(Profiles),[failed,setFailed]=useState('');
 const src=profiles[account?.id]?.avatar;
 const initials=(account?.name||'Modelo').split(/[ ·@]+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();
 return <span className="model-avatar" style={{'--model-avatar-size':size+'px'}} aria-hidden="true">{src&&src!==failed?<img key={src} src={src} alt="" referrerPolicy="no-referrer" decoding="async" onError={()=>setFailed(src)}/>:initials}</span>;
}
export function ModelIdentity({account,size=36}){return <span className="model-identity"><ModelAvatar account={account} size={size}/><span className="model-identity-text">{account?.name||'Selecciona una modelo'}</span></span>}
export function ModelSelect({accounts,value,onChange,label='Modelo activa',allLabel,disabled=false}){
 const [open,setOpen]=useState(false),root=useRef(null),id=useId();
 const selected=accounts.find(a=>a.id===value);
 useEffect(()=>{const close=e=>{if(!root.current?.contains(e.target))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
 return <div className="model-select" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector('button')?.focus()}}}>
  <button type="button" className="model-select-trigger" disabled={disabled} aria-label={label} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>{value==='all'&&allLabel?<span className="model-identity"><span className="model-avatar" aria-hidden="true">◎</span><span>{allLabel}</span></span>:<ModelIdentity account={selected}/>}<span aria-hidden="true">⌄</span></button>
  {open&&<div id={id} className="model-select-options" role="group" aria-label={label}>{allLabel&&<button type="button" aria-pressed={value==='all'} onClick={()=>{onChange('all');setOpen(false)}}>{allLabel}</button>}{accounts.map(a=><button type="button" key={a.id} aria-pressed={value===a.id} onClick={()=>{onChange(a.id);setOpen(false)}}><ModelIdentity account={a}/><span aria-hidden="true">{value===a.id?'✓':''}</span></button>)}</div>}
 </div>;
}
