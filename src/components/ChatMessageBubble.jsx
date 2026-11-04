import React,{memo,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {MediaPreview} from './MediaPreview.jsx';
import {ChatIcon} from './ChatTools.jsx';
import {messageAttribution} from '../message-attribution.js';
import {restoreReply} from '../message-actions.js';
import './chat-message-actions.css';
const usd=new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'});
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'No disponible';
const idleTranslation=scope=>({scope,phase:'idle',visible:false,text:'',progress:'',error:''});
function translationProgress(value){
 if(typeof value==='string')return value.slice(0,160);
 const number=typeof value==='number'?value:value?.progress;
 if(typeof number==='number'&&Number.isFinite(number))return 'Preparando traducción · '+Math.round(Math.max(0,Math.min(100,number<=1?number*100:number)))+' %';
 return typeof value?.message==='string'?value.message.slice(0,160):'Preparando traducción…';
}
function ChatMessageBubble({m,likeState,onLike,canLike,onReply,canReply,translate}){
 const text=typeof m.text==='string'?m.text:'',scope=JSON.stringify([String(m.id),text]),scopeRef=useRef(scope);scopeRef.current=scope;
 const [menuOpen,setMenuOpen]=useState(false),[position,setPosition]=useState(null),[copy,setCopy]=useState(null),[translation,setTranslation]=useState(()=>idleTranslation(scope));
 const menuId=useId(),triggerId=useId(),trigger=useRef(null),menu=useRef(null),focusLast=useRef(false),revision=useRef(0),translationRequest=useRef(null);
 const pending=likeState?.phase==='pending',unconfirmed=['error','uncertain'].includes(likeState?.phase);
 const liked=['pending','confirmed'].includes(likeState?.phase)?likeState.desired===true:unconfirmed?likeState.previous===true:m.isLiked===true;
 const fanMessage=m.isFromMe===false&&!m.delivery,canReact=fanMessage&&canLike&&typeof onLike==='function';
 const translated=translation.scope===scope?translation:idleTranslation(scope),translating=translated.phase==='pending';
 const hasText=!!text.trim(),likeLabel=unconfirmed?'Reintentar cambio de Me gusta':liked?'Quitar Me gusta':'Me gusta';
 const translateLabel=translating?'Traduciendo…':translated.phase==='ready'?(translated.visible?'Ocultar traducción':'Mostrar traducción'):translated.phase==='error'?'Reintentar traducción':'Traducir';
 function closeMenu(restoreFocus=true){setMenuOpen(false);if(restoreFocus)trigger.current?.focus({preventScroll:true})}
 useEffect(()=>{revision.current++;translationRequest.current?.abort();translationRequest.current=null;setTranslation(idleTranslation(scope));setCopy(null);setMenuOpen(false);return()=>{revision.current++;translationRequest.current?.abort();translationRequest.current=null}},[scope]);
 useLayoutEffect(()=>{
  if(!menuOpen)return;
  const place=()=>{if(!trigger.current||!menu.current)return;const r=trigger.current.getBoundingClientRect(),box=menu.current.getBoundingClientRect(),gap=8,width=Math.min(box.width,window.innerWidth-gap*2),height=Math.min(box.height,window.innerHeight-gap*2);const below=window.innerHeight-r.bottom-gap,above=r.top-gap;const top=below>=height||below>=above?r.bottom+gap:r.top-height-gap;setPosition({left:Math.max(gap,Math.min(r.right-width,window.innerWidth-width-gap)),top:Math.max(gap,Math.min(top,window.innerHeight-height-gap))})};
  const outside=event=>{if(!menu.current?.contains(event.target)&&!trigger.current?.contains(event.target))closeMenu(false)};
  const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu()}};
  place();const items=menu.current?.querySelectorAll('[role="menuitem"]:not(:disabled)');(focusLast.current?items?.[items.length-1]:items?.[0])?.focus({preventScroll:true});
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)};
 },[menuOpen]);
 const menuKeys=event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();return}
  if(event.key==='Tab'){closeMenu();return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const items=[...menu.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];if(!items.length)return;
  const index=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;items[next].focus();
 };
 const react=()=>{if(!canReact||pending)return;closeMenu();onLike(m)};
 const reply=()=>{if(!fanMessage||!canReply||typeof onReply!=='function')return;closeMenu();onReply(m)};
 async function copyText(){
  if(!hasText)return;const version=revision.current;
  try{if(!navigator.clipboard?.writeText)throw Error('clipboard');const writing=navigator.clipboard.writeText(text);closeMenu();await writing;if(scopeRef.current===scope&&revision.current===version)setCopy({message:'Texto copiado.',error:false})}
  catch{if(scopeRef.current===scope&&revision.current===version){closeMenu();setCopy({message:'No se pudo copiar. Selecciona el texto y cópialo.',error:true})}}
 }
 async function showTranslation(){
  if(!hasText||translating)return;closeMenu();
  if(translated.phase==='ready'){setTranslation(value=>({...value,visible:!value.visible}));return}
  translationRequest.current?.abort();const controller=new AbortController(),version=++revision.current;translationRequest.current=controller;
  const current=()=>!controller.signal.aborted&&revision.current===version&&scopeRef.current===scope;
  setTranslation({...idleTranslation(scope),phase:'pending',visible:true,progress:'Preparando traducción…'});
  try{
   if(typeof translate!=='function')throw Error('La traducción no está disponible en este navegador.');
   const result=await translate(text,{signal:controller.signal,onProgress:value=>{if(current())setTranslation(previous=>({...previous,progress:translationProgress(value)}))}});
   if(!current())return;if(typeof result?.text!=='string'||!result.text.trim())throw Error('El traductor no devolvió una traducción válida.');
   setTranslation({scope,phase:'ready',visible:true,text:result.text,sourceLanguage:typeof result.sourceLanguage==='string'?result.sourceLanguage:'',targetLanguage:typeof result.targetLanguage==='string'?result.targetLanguage:'',progress:'',error:''});
  }catch(error){if(current())setTranslation({...idleTranslation(scope),phase:'error',visible:true,error:error?.message||'No se pudo traducir el mensaje.'})}
  finally{if(translationRequest.current===controller)translationRequest.current=null}
 }
 const menuView=menuOpen&&typeof document!=='undefined'?createPortal(<div ref={menu} id={menuId} role="menu" aria-labelledby={triggerId} className="chat-message-action-menu" onKeyDown={menuKeys} style={position?{left:position.left,top:position.top}:{visibility:'hidden',left:0,top:0}}>
  {fanMessage&&<><button type="button" role="menuitem" tabIndex={-1} disabled={!canReply||typeof onReply!=='function'} onClick={reply}><span aria-hidden="true">↩</span>Responder</button><button type="button" role="menuitem" tabIndex={-1} disabled={!canReact||pending} onClick={react}><span aria-hidden="true">{liked?'♥':'♡'}</span>{pending?'Guardando…':likeLabel}</button><div className="chat-message-menu-separator" role="separator"/></>}
  <button type="button" role="menuitem" tabIndex={-1} disabled={!hasText} onClick={copyText}><span aria-hidden="true">⧉</span>Copiar texto</button><button type="button" role="menuitem" tabIndex={-1} disabled={!hasText||translating} onClick={showTranslation}><ChatIcon name="translate" size={15}/>{translateLabel}</button>
 </div>,document.body):null;
 return <article data-message-id={String(m.id)} className={(m.isFromMe?'own ':'')+'chat-message-bubble'} onDoubleClick={event=>{if(!event.target.closest('button,a,video,audio,input,textarea,[role="menu"]')&&canReact&&!pending)react()}}>
  {restoreReply(m.bruffReply)&&<aside className="chat-message-reply"><small>Respuesta a {m.bruffReply.name}</small><p>{m.bruffReply.text}</p></aside>}
  <p>{text||(!m.media?.length?'Mensaje sin texto':'')}</p>
  {m.media?.map((item,index)=><MediaPreview key={item.id??index} item={item}/>)}
  {m.mediaCount>0&&!m.media?.length&&<small>{m.mediaCount} archivos · Vista previa no disponible</small>}
  {m.price>0&&<span className="chat-paid">{m.isTip?'Propina':'PPV'} · {usd.format(m.price)}</span>}
  {translating&&<div className="chat-message-translation-progress" role="status"><span aria-hidden="true"/>{translated.progress}</div>}
  {translated.phase==='ready'&&translated.visible&&<section className="chat-message-translation" aria-label="Traducción del mensaje"><header><span><ChatIcon name="translate" size={12}/>Traducción{translated.sourceLanguage&&translated.targetLanguage&&<small>{translated.sourceLanguage.toUpperCase()} → {translated.targetLanguage.toUpperCase()}</small>}</span><button type="button" onClick={()=>setTranslation(value=>({...value,visible:false}))}>Ocultar</button></header><p>{translated.text}</p></section>}
  {translated.phase==='error'&&<div className="chat-message-translation-error" role="alert"><span>{translated.error}</span><button type="button" onClick={showTranslation}>Reintentar traducción</button></div>}
  <div className="reference-message-meta">
   {m.isFromMe===false&&<button type="button" className={'chat-message-like'+(pending?' is-pending':'')} aria-label={pending?'Guardando cambio de Me gusta':unconfirmed?'Reintentar cambio de Me gusta':liked?'Quitar Me gusta':'Me gusta al mensaje'} aria-pressed={liked} aria-busy={pending} disabled={!canReact||pending} onClick={react}>{liked?'♥':'♡'}</button>}
   {hasText&&<button type="button" className="chat-message-translate" aria-label={translating?'Traduciendo mensaje':translateLabel==='Traducir'?'Traducir mensaje':translateLabel+' del mensaje'} disabled={translating} onClick={showTranslation}><ChatIcon name="translate" size={12}/>{translateLabel}</button>}
   <small>{m.delivery?({checking:'Comprobando…',sending:'Enviando…',uncertain:'Sin confirmar · Reintenta desde el editor'})[m.delivery]:date(m.createdAt)}{m.isFromMe&&!m.delivery&&<> · {m.seenByFan===true?'✓✓ Visto':m.seenByFan===false?'✓ Enviado':'Modelo'}</>}</small>
   <button ref={trigger} id={triggerId} type="button" className="chat-message-menu-trigger" aria-label="Opciones del mensaje" aria-haspopup="menu" aria-controls={menuOpen?menuId:undefined} aria-expanded={menuOpen} onClick={()=>{focusLast.current=false;setMenuOpen(value=>!value)}} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();focusLast.current=event.key==='ArrowUp';setMenuOpen(true)}}}><ChatIcon name="more" size={15}/></button>
  </div>
  {unconfirmed&&<div className="chat-message-action-warning" role="status"><span>Me gusta · Sin confirmar</span><button type="button" disabled={!canReact||pending} onClick={react}>Reintentar</button>{likeState.error&&<small>{likeState.error}</small>}</div>}
  {copy&&<small className={'chat-message-copy-status'+(copy.error?' is-error':'')} role={copy.error?'alert':'status'}>{copy.message}</small>}
  {m.isFromMe===true&&!m.delivery&&<small className="chat-message-author">{messageAttribution(m)}</small>}
  {menuView}
 </article>;
}
export default memo(ChatMessageBubble);
