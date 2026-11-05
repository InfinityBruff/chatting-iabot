import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import Brand from './Brand.jsx';
import {clampVaultDialogSize,readVaultDialogSize,resetVaultDialogSize,resizeVaultDialogByKey,resizeVaultDialogFromPointer,vaultDialogBounds,writeVaultDialogSize} from '../vault-dialog-size.js';
import './composer-vault-dialog.css';
const storage=()=>{try{return window.localStorage}catch{return null}};
const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
const sameSize=(a,b)=>a?.width===b?.width&&a?.height===b?.height;

export default function ComposerVaultDialog({scope,model,count=0,busy=false,onClose,children,footer}){
 const dialog=useRef(null),drag=useRef(null),backdrop=useRef(false),closing=useRef(false),closeHandler=useRef(onClose),busyRef=useRef(busy),scopeRef=useRef(scope);
 closeHandler.current=onClose;busyRef.current=busy;scopeRef.current=scope;
 const title=useId(),help=useId(),keyboardHelp=useId();
 const [preference,setPreference]=useState(()=>({scope,size:readVaultDialogSize(storage(),scope)})),[preview,setPreview]=useState(null),[view,setView]=useState(viewport),[resizing,setResizing]=useState(false),[announcement,setAnnouncement]=useState('');
 const bounds=vaultDialogBounds(view),boundsRef=useRef(bounds);boundsRef.current=bounds;
 const saved=preference.scope===scope?preference.size:null,size=clampVaultDialogSize(preview||saved,bounds),sizeRef=useRef(size);sizeRef.current=size;
 function cancelResize(){drag.current=null;setPreview(null);setResizing(false)}
 useLayoutEffect(()=>{if(preference.scope===scope)return;cancelResize();setPreference({scope,size:readVaultDialogSize(storage(),scope)});setAnnouncement('')},[scope]);
 useLayoutEffect(()=>{
  const node=dialog.current,trigger=node.ownerDocument.activeElement;closing.current=false;
  if(!node.open)node.showModal();
  return()=>{closing.current=true;drag.current=null;if(node.open)node.close();if(trigger?.isConnected){const target=trigger.disabled?trigger.closest('.live-composer')?.querySelector('textarea:not(:disabled)'):trigger;target?.focus?.({preventScroll:true})}};
 },[]);
 useEffect(()=>{const changed=()=>setView(viewport());window.addEventListener('resize',changed);return()=>window.removeEventListener('resize',changed)},[]);
 useEffect(()=>{if(busy)cancelResize()},[busy]);
 function requestClose(){if(busyRef.current||closing.current)return;closing.current=true;dialog.current?.close();closeHandler.current?.()}
 function commit(next){
  if(busyRef.current)return;const accepted=clampVaultDialogSize(next,boundsRef.current);setPreference({scope:scopeRef.current,size:accepted});setPreview(null);
  const remembered=writeVaultDialogSize(storage(),scopeRef.current,accepted);setAnnouncement(`${accepted.width} × ${accepted.height} píxeles${remembered?' · Tamaño recordado':' · No se pudo recordar el tamaño'}`);
 }
 function reset(){if(busyRef.current)return;cancelResize();setPreference({scope:scopeRef.current,size:null});resetVaultDialogSize(storage(),scopeRef.current);setAnnouncement('Tamaño inicial restablecido')}
 function finishPointer(event,cancelled=false){
  const current=drag.current;if(!current||current.pointerId!==event.pointerId)return;
  drag.current=null;setResizing(false);setPreview(null);
  if(!cancelled&&!busyRef.current&&current.scope===scopeRef.current&&!sameSize(current.start,current.next))commit(current.next);
  if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
 }
 const outside=event=>{const rect=event.currentTarget.getBoundingClientRect();return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom};
 return <dialog ref={dialog} className={'composer-vault-dialog'+(resizing?' is-resizing':'')} aria-labelledby={title} aria-describedby={help} aria-busy={busy||undefined} style={{width:size.width,height:size.height}}
  onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();event.stopPropagation();if(drag.current)cancelResize();else requestClose()}}
  onClose={event=>{if(event.target!==event.currentTarget)return;event.stopPropagation();if(!closing.current){closing.current=true;closeHandler.current?.()}}}
  onPointerDown={event=>{backdrop.current=event.target===event.currentTarget&&outside(event)}}
  onClick={event=>{if(backdrop.current&&event.target===event.currentTarget&&outside(event))requestClose();backdrop.current=false}}>
  <header><div className="composer-vault-dialog-heading"><Brand/><div><h2 id={title}>Baúl de contenido</h2><small>{model?model+' · ':''}{count}/10 adjuntos</small></div></div><div className="composer-vault-window-actions"><button type="button" className="composer-vault-reset" aria-label="Restablecer tamaño del baúl" title="Restablecer tamaño inicial" disabled={busy} onClick={reset}>↺</button><button type="button" aria-label="Cerrar baúl" title="Cerrar baúl" disabled={busy} onClick={requestClose}>×</button></div></header>
  <div className="composer-vault-dialog-body">{children}</div>
  {footer&&<footer>{footer}</footer>}
  <div className="composer-vault-dialog-sizing"><small id={help}>Arrastra la esquina para ajustar · Tamaño recordado en este navegador</small><span className="composer-vault-size-value" aria-hidden="true">{size.width} × {size.height}</span><span className="composer-vault-sr-only" id={keyboardHelp}>También puedes usar las flechas para cambiar ancho y alto. Mayús ajusta más rápido. Inicio restablece el tamaño. Escape cancela el ajuste.</span><span className="composer-vault-sr-only" role="status" aria-live="polite">{announcement}</span>
   <button type="button" className="composer-vault-resize-handle" aria-label={`Ajustar tamaño del baúl, ${size.width} por ${size.height} píxeles`} aria-describedby={keyboardHelp} title="Arrastra para ajustar · Flechas para ancho y alto · Inicio para restaurar" disabled={busy}
    onPointerDown={event=>{if(event.button!==0||busyRef.current)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});const start=sizeRef.current;drag.current={scope:scopeRef.current,pointerId:event.pointerId,x:event.clientX,y:event.clientY,start,next:start};event.currentTarget.setPointerCapture?.(event.pointerId);setResizing(true)}}
    onPointerMove={event=>{const current=drag.current;if(!current||current.pointerId!==event.pointerId||current.scope!==scopeRef.current||busyRef.current)return;const next=resizeVaultDialogFromPointer(current.start,event.clientX-current.x,event.clientY-current.y,boundsRef.current);current.next=next;setPreview(next)}}
    onPointerUp={event=>finishPointer(event)} onPointerCancel={event=>finishPointer(event,true)} onLostPointerCapture={()=>{if(drag.current)cancelResize()}}
    onKeyDown={event=>{if(busyRef.current)return;if(event.key==='Escape'&&drag.current){event.preventDefault();event.stopPropagation();cancelResize();return}if(event.key==='Home'){event.preventDefault();event.stopPropagation();reset();return}const next=resizeVaultDialogByKey(sizeRef.current,event.key,boundsRef.current,event.shiftKey);if(next){event.preventDefault();event.stopPropagation();if(!sameSize(next,sizeRef.current))commit(next)}}}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 15 15 5M10 16l6-6M15 17l2-2"/></svg>
   </button>
  </div>
 </dialog>;
}
