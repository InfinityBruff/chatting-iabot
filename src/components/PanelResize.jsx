import React,{createContext,useContext,useRef,useState} from 'react';
const Layout=createContext(null);
const limits={nav:[190,340],inbox:[230,560],fan:[260,500]};
export function PanelLayout({scope,children}){
 const key='bruff-panel-widths:'+scope;
 const [sizes,setSizes]=useState(()=>{try{const value=JSON.parse(localStorage.getItem(key)||'{}');return Object.fromEntries(Object.entries(limits).filter(([k,[min,max]])=>Number.isFinite(value[k])&&value[k]>=min&&value[k]<=max).map(([k])=>[k,value[k]]))}catch{return {}}});
 const update=(name,value)=>setSizes(old=>{const next={...old};if(value==null)delete next[name];else next[name]=Math.round(Math.max(limits[name][0],Math.min(limits[name][1],value)));try{localStorage.setItem(key,JSON.stringify(next))}catch{}return next});
 return <Layout.Provider value={{sizes,update}}><div className="panel-layout" data-nav-sized={!!sizes.nav} data-chat-sized={!!(sizes.inbox||sizes.fan)} style={Object.fromEntries(Object.entries(sizes).map(([k,v])=>['--panel-'+k,v+'px']))}>{children}</div></Layout.Provider>
}
export default function PanelResize({name,label,reverse=false}){
 const {sizes,update}=useContext(Layout),drag=useRef(null),[active,setActive]=useState(false);
 const finish=(e,cancel=false)=>{if(!drag.current)return;const previous=drag.current.previous;drag.current=null;setActive(false);if(cancel)update(name,previous);if(e.currentTarget.hasPointerCapture?.(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)};
 return <div className={'panel-resize panel-resize-'+name+(active?' dragging':'')} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={label} aria-valuemin={limits[name][0]} aria-valuemax={limits[name][1]} aria-valuenow={sizes[name]||undefined} title="Arrastra para ajustar · Doble clic para restaurar · Flechas para ajustar" onDoubleClick={()=>update(name,null)} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();drag.current={x:e.clientX,width:e.currentTarget.parentElement.getBoundingClientRect().width,previous:sizes[name]};e.currentTarget.setPointerCapture(e.pointerId);setActive(true)}} onPointerMove={e=>{if(drag.current)update(name,drag.current.width+(e.clientX-drag.current.x)*(reverse?-1:1))}} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={()=>{drag.current=null;setActive(false)}} onKeyDown={e=>{if(e.key==='Escape'&&drag.current){update(name,drag.current.previous);drag.current=null;setActive(false)}if(e.key==='Home'){e.preventDefault();update(name,null)}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();update(name,(sizes[name]||e.currentTarget.parentElement.getBoundingClientRect().width)+(e.key==='ArrowRight'?1:-1)*(reverse?-1:1)*(e.shiftKey?40:10))}}}><span/></div>
}
