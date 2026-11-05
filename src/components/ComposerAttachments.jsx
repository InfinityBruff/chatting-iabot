import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {MediaImage} from './MediaPreview.jsx';
import {ChatIcon} from './ChatTools.jsx';
import {composerAttachmentDetails,attachmentScrollState} from '../composer-attachments.js';
import './composer-attachments.css';

export default function ComposerAttachments({items=[],disabled=false,onRemove}){
 const track=useRef(null),id=useId(),[navigation,setNavigation]=useState({previous:false,next:false});
 const signature=JSON.stringify(items.map(item=>item.id));
 const measure=()=>{if(!track.current)return;const next=attachmentScrollState(track.current);setNavigation(previous=>previous.previous===next.previous&&previous.next===next.next?previous:next)};
 useLayoutEffect(measure,[signature]);
 useEffect(()=>{const element=track.current;if(!element)return;const observer=typeof ResizeObserver==='function'?new ResizeObserver(measure):null;observer?.observe(element);window.addEventListener('resize',measure);return()=>{observer?.disconnect();window.removeEventListener('resize',measure)}},[!!items.length]);
 const scroll=(direction,edge=false)=>{const element=track.current;if(!element)return;const behavior=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';if(edge)element.scrollTo({left:direction<0?0:element.scrollWidth,behavior});else element.scrollBy({left:direction*Math.max(108,element.clientWidth*.8),behavior})};
 const keys=event=>{if(event.target!==event.currentTarget)return;const direction={ArrowLeft:-1,ArrowRight:1,Home:-1,End:1}[event.key];if(direction){event.preventDefault();scroll(direction,event.key==='Home'||event.key==='End')}};
 if(!items.length)return null;
 return <section className="composer-attachments" aria-label="Archivos adjuntos">
  <header className="composer-attachments-header"><span>Adjuntos <b>{items.length}</b></span><nav aria-label="Recorrer archivos adjuntos"><button type="button" className="composer-attachments-nav" aria-label="Ver adjuntos anteriores" aria-controls={id} disabled={!navigation.previous} onClick={()=>scroll(-1)}><ChatIcon name="back" size={14}/></button><button type="button" className="composer-attachments-nav composer-attachments-next" aria-label="Ver adjuntos siguientes" aria-controls={id} disabled={!navigation.next} onClick={()=>scroll(1)}><ChatIcon name="back" size={14}/></button></nav></header>
  <div id={id} ref={track} className="composer-attachments-track" role="list" tabIndex={0} aria-label="Archivos seleccionados; usa las flechas para desplazarte" onKeyDown={keys} onScroll={measure}>
   {items.map((item,index)=>{const details=composerAttachmentDetails(item,index);return <div className={'composer-attachments-card composer-attachments-'+details.type} role="listitem" key={item.id??index} aria-label={`${details.label}: ${details.name}${details.duration?', duración '+details.duration:''}`}>
    <div className="composer-attachments-thumbnail"><span className="composer-attachments-kind" aria-hidden="true"><ChatIcon name={details.type==='video'?'video':details.type==='audio'?'mic':details.type==='file'?'note':'image'} size={24}/></span>{item.media&&<MediaImage item={item.media} eager={index<2}/>}<span className="composer-attachments-type" aria-hidden="true">{details.label}</span>{details.duration&&<span className="composer-attachments-duration" aria-hidden="true">{details.duration}</span>}</div>
    <span className="composer-attachments-name" title={details.name}>{details.name}</span><button type="button" className="composer-attachments-remove" aria-label={'Quitar '+details.name} disabled={disabled||typeof onRemove!=='function'} onClick={()=>{if(!disabled)onRemove?.(item)}}>×</button>
   </div>})}
  </div>
 </section>;
}
