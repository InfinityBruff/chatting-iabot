import React,{useEffect,useRef,useState} from 'react';
import {mediaPreviews,previewSources,previewsExpired} from '../media-preview-loader.js';
export {previewSources} from '../media-preview-loader.js';
export function MediaImage({item,alt='',eager=false,large=false,onUnavailable,...props}){
 const sources=previewSources(item,large),key=sources.join('|'),ref=useRef(null),imageRef=useRef(null),callback=useRef(onUnavailable);callback.current=onUnavailable;
 const [visible,setVisible]=useState(eager),[view,setView]=useState({key,state:'queued'});
 useEffect(()=>{if(eager||typeof IntersectionObserver==='undefined'){setVisible(true);return}const observer=new IntersectionObserver(entries=>{for(const entry of entries)setVisible(entry.isIntersecting)},{rootMargin:'200px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect()},[eager,key]);
 useEffect(()=>{let active=true;const reset=mediaPreviews.onReset(()=>{active=false;setView({key,state:'unavailable'})});if(visible&&previewsExpired(sources)){setView({key,state:'error'});callback.current?.(item);return reset}const stop=visible?mediaPreviews.subscribe(sources,value=>{if(active)setView({key,...value})},{priority:large?4:eager?3:1,allowFallback:large,element:imageRef.current}):()=>{};return()=>{active=false;stop();reset()}},[key,visible,eager,large]);
 const current=view.key===key?view:{state:'queued'},src=current.src;
 return <span ref={ref} className="media-image-content" data-preview-state={current.state} aria-busy={['queued','loading'].includes(current.state)&&sources.length>0}><img {...props} ref={imageRef} src={src||undefined} alt={alt} style={!src?{display:'none'}:props.style} decoding="async" referrerPolicy="no-referrer"/>{!src&&<span className="media-empty-preview">{item.canView===false?'Contenido bloqueado':item.isReady===false?'Procesando':!sources.length||['unavailable','error'].includes(current.state)?'Vista previa no disponible':'Cargando vista previa…'}</span>}</span>;
}
export function MediaPreview({item}){
 const [open,setOpen]=useState(false);
 if(item.canView===false)return <div className="live-media-placeholder">Contenido bloqueado</div>;
 if(!item.url||['photo','gif'].includes(item.type)&&!item.convertedToVideo||item.isDrm)return <div className="media-image-frame"><MediaImage item={item} alt="Contenido adjunto" eager large/></div>;
 return open?(item.type==='audio'?<audio controls preload="none" src={item.url}/>:<video controls preload="metadata" src={item.url} poster={item.preview||undefined}/>):<div className="media-play-preview"><MediaImage item={item} alt="Vista previa del contenido" eager large/><button type="button" className="media-play-label" onClick={()=>setOpen(true)}>▶ {item.type==='audio'?'Audio':'Vídeo'}</button></div>;
}
