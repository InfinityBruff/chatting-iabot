import React,{useEffect,useRef,useState} from 'react';
import {mediaPreviews,previewSources,previewsExpired} from '../media-preview-loader.js';
export {previewSources} from '../media-preview-loader.js';
export function MediaImage({item,alt='',eager=false,large=false,retryToken=null,onUnavailable,onStateChange,...props}){
 const sources=previewSources(item,large),key=sources.join('|'),ref=useRef(null),imageRef=useRef(null),callback=useRef(onUnavailable);callback.current=onUnavailable;
 const [visible,setVisible]=useState(eager),[view,setView]=useState({key,state:'queued'});
 useEffect(()=>{if(eager||typeof IntersectionObserver==='undefined'){setVisible(true);return}const observer=new IntersectionObserver(entries=>{for(const entry of entries)setVisible(entry.isIntersecting)},{rootMargin:'200px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect()},[eager,key]);
 useEffect(()=>{let active=true;const reset=mediaPreviews.onReset(()=>{active=false;setView({key,state:'unavailable'})});if(visible&&previewsExpired(sources)){setView({key,state:'error'});callback.current?.(item);return reset}const stop=visible?mediaPreviews.subscribe(sources,value=>{if(active)setView({key,...value})},{priority:large?4:eager?3:1,allowFallback:large,element:imageRef.current}):()=>{};return()=>{active=false;stop();reset()}},[key,visible,eager,large]);
 useEffect(()=>{if(visible&&retryToken!==null)mediaPreviews.retryFailed(sources,retryToken,{element:imageRef.current})},[key,visible,retryToken]);
 const current=view.key===key?view:{state:'queued'},src=current.src;
 const stateCallback=useRef(onStateChange);stateCallback.current=onStateChange;
 useEffect(()=>{stateCallback.current?.(current.state)},[key,current.state]);
 return <span ref={ref} className="media-image-content" data-preview-state={current.state} aria-busy={['queued','loading'].includes(current.state)&&sources.length>0}><img {...props} ref={imageRef} src={src||undefined} alt={alt} style={!src?{display:'none'}:props.style} decoding="async" referrerPolicy="no-referrer"/>{!src&&<span className="media-empty-preview">{item.canView===false?'Contenido bloqueado':item.isReady===false?'Procesando':!sources.length||['unavailable','error'].includes(current.state)?'Vista previa no disponible':'Cargando vista previa…'}</span>}</span>;
}
function InlineMediaPreview({item}){
 const [open,setOpen]=useState(false);
 if(item.canView===false)return <div className="live-media-placeholder">Contenido bloqueado</div>;
 if(!item.url||['photo','gif'].includes(item.type)&&!item.convertedToVideo||item.isDrm)return <div className="media-image-frame"><MediaImage item={item} alt="Contenido adjunto" eager large/></div>;
 return open?(item.type==='audio'?<audio controls preload="none" src={item.url}/>:<video controls playsInline preload="metadata" src={item.url} poster={item.preview||undefined}/>):<div className="media-play-preview"><MediaImage item={item} alt="Vista previa del contenido" eager large/><button type="button" className="media-play-label" onClick={()=>setOpen(true)}>▶ {item.type==='audio'?'Audio':'Vídeo'}</button></div>;
}
function ExpandedMediaPreview({item,onRefresh}){
 const [open,setOpen]=useState(false),[imageState,setImageState]=useState('queued'),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0),[original,setOriginal]=useState(false),[renewing,setRenewing]=useState(false);
 const [retryId]=useState(()=>crypto.randomUUID());
 const isImage=['photo','gif'].includes(item.type)&&!item.convertedToVideo;
 const canPlay=!!item.url&&!item.isDrm&&(item.type==='video'||item.type==='audio'||item.convertedToVideo);
 const canOriginal=isImage&&!item.isDrm&&!!item.url&&item.url!==item.preview;
 const imageItem=original&&canOriginal?{...item,preview:item.url,previewSources:[]}:item;
 const hasImage=previewSources(imageItem).length>0;
 const imageError=['error','unavailable'].includes(imageState);
 const retry=()=>{setFailed(false);setAttempt(value=>value+1)};
 const refresh=async()=>{if(renewing)return;setRenewing(true);try{await onRefresh?.();retry()}catch{if(open)setFailed(true);else setImageState('error')}finally{setRenewing(false)}};
 if(item.canView===false)return <div className="vault-preview-message" role="status">Este contenido no está disponible para esta cuenta.</div>;
 if(item.isReady===false)return <div className="vault-preview-message" role="status">El archivo todavía se está procesando.</div>;
 return <div className="vault-expanded-media">
  {canPlay&&open?<div className="vault-preview-player" key={attempt}>{item.type==='audio'?<audio aria-label="Reproductor de audio" controls preload="none" src={item.url} onError={()=>setFailed(true)}/>:<video aria-label="Reproductor de vídeo" playsInline controls preload="metadata" src={item.url} poster={item.preview||undefined} onError={()=>setFailed(true)}/>}</div>:<div className={canPlay?'media-play-preview':'media-image-frame'}>{canPlay&&!hasImage?<span className="vault-preview-media-kind" aria-hidden="true">{item.type==='audio'?'♫':'▶'}</span>:<MediaImage item={imageItem} alt={isImage?'Vista previa de la imagen':'Vista previa del contenido'} eager large retryToken={attempt?`${retryId}:${attempt}`:null} onStateChange={setImageState}/>}{canPlay&&<button type="button" className="media-play-label" onClick={()=>{setFailed(false);setOpen(true)}}>▶ {item.type==='audio'?'Reproducir audio':'Reproducir vídeo'}</button>}</div>}
  {((!open&&(!canPlay||hasImage)&&imageError)||failed)&&<div className="vault-preview-error" role="alert"><strong>{failed?'No se ha podido reproducir el archivo.':'No se ha podido cargar la vista previa.'}</strong><p>Reintenta o actualiza el contenido. Si el servicio no entrega el archivo, la vista previa seguirá sin estar disponible.</p><div><button type="button" onClick={retry}>Reintentar {failed?'reproducción':'vista previa'}</button>{onRefresh&&<button type="button" disabled={renewing} onClick={refresh}>{renewing?'Actualizando…':'Actualizar contenido'}</button>}</div></div>}
  {!open&&hasImage&&!imageError&&['queued','loading'].includes(imageState)&&<small className="vault-preview-loading" role="status">Cargando vista previa…</small>}
  {canOriginal&&<div className="vault-preview-quality"><button type="button" aria-pressed={original} onClick={()=>{setOriginal(value=>!value);setImageState('queued')}}>{original?'Ver vista ligera':'Ver imagen original'}</button><small>{original?'Imagen original · Puede tardar más en cargar.':'Vista ligera · Abre el original para ver más detalle.'}</small></div>}
  {item.isDrm&&<small className="vault-preview-loading">Solo se muestra la vista previa disponible.</small>}
  {!canPlay&&!isImage&&!item.isDrm&&<small className="vault-preview-loading">Reproducción no disponible para este archivo.</small>}
 </div>;
}
export function MediaPreview({item,expanded=false,onRefresh}){
 return expanded?<ExpandedMediaPreview item={item} onRefresh={onRefresh}/>:<InlineMediaPreview item={item}/>;
}
