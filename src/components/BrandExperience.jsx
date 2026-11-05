import React,{useEffect,useId,useRef} from 'react';
import './brand-experience.css';

const welcomeSizes='(max-width: 640px) calc(100vw - 40px), (max-height: 740px) 62vh, 620px';

export function WelcomeExperience({ready=false,onContinue,onFinished,onCancel}){
 const curtain=useRef(null),finished=useRef(false),continued=useRef(false),cancelled=useRef(false),readyRef=useRef(ready),finishHandler=useRef(onFinished),title=useId(),description=useId();
 readyRef.current=ready;finishHandler.current=onFinished;
 const finish=()=>{if(!readyRef.current||finished.current)return;finished.current=true;finishHandler.current?.()};
 useEffect(()=>{curtain.current?.focus({preventScroll:true})},[]);
 useEffect(()=>{
  if(!ready)return;
  const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if(preference?.matches){finish();return}
  const changed=event=>{if(event.matches)finish()};preference?.addEventListener?.('change',changed);
  const timer=window.setTimeout(finish,500);
  return()=>{window.clearTimeout(timer);preference?.removeEventListener?.('change',changed)};
 },[ready]);
 const keys=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation()}else if(event.key==='Tab'){event.preventDefault();const button=curtain.current?.querySelector('button');(button||curtain.current)?.focus({preventScroll:true})}};
 return <section ref={curtain} className={'brand-experience brand-experience-welcome'+(ready?' is-ready':'')} role="dialog" aria-modal="true" aria-labelledby={title} aria-describedby={description} tabIndex={-1} onKeyDown={keys} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onAnimationEnd={event=>{if(event.target===event.currentTarget&&event.animationName==='bruff-welcome-curtain-out')finish()}}>
  <div className="brand-welcome-stage">
   <div className="brand-welcome-art"><img src="/brand/bruff-welcome-640.webp" srcSet="/brand/bruff-welcome-640.webp 640w, /brand/bruff-welcome-full.webp 1254w" sizes={welcomeSizes} alt="" width="1254" height="1254" loading="lazy" decoding="async" fetchPriority="low"/></div>
   <div className="brand-welcome-copy"><h1 id={title}><span lang="es">Bienvenido a BRUFF INC.</span><span lang="en">Welcome to BRUFF INC.</span></h1><p id={description} role="status" aria-live="polite"><span lang="es">{ready?'Continuando…':'Preparando tu espacio…'}</span><span lang="en">{ready?'Continuing…':'Preparing your workspace…'}</span></p></div>
   <div className="brand-welcome-progress" aria-hidden="true"><span/></div>
   {ready&&typeof onContinue==='function'&&<button type="button" className="brand-experience-button brand-welcome-continue" onClick={()=>{if(!readyRef.current||continued.current)return;continued.current=true;onContinue()}}><span lang="es">Entrar ahora</span><span aria-hidden="true"> / </span><span lang="en">Enter now</span><span className="brand-experience-arrow" aria-hidden="true">↗</span></button>}
   {!ready&&typeof onCancel==='function'&&<button type="button" className="brand-experience-button brand-welcome-back" onClick={()=>{if(readyRef.current||cancelled.current)return;cancelled.current=true;onCancel()}}><span lang="es">Volver al acceso</span><span aria-hidden="true"> / </span><span lang="en">Back to access</span></button>}
  </div>
  <span className="brand-experience-signature" aria-hidden="true">BRUFF INC. <span>CRM</span></span>
 </section>;
}

export function MaintenanceExperience({onRetry,checking=false,maintenance}){
 const title=useId(),description=useId();
 return <main className="brand-experience brand-experience-maintenance" aria-labelledby={title} aria-describedby={description}>
  <div className="brand-maintenance-layout">
   <div className="brand-maintenance-art"><img src="/brand/bruff-maintenance-640.webp" srcSet="/brand/bruff-maintenance-640.webp 640w, /brand/bruff-maintenance-full.webp 1254w" sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 980px) 560px, 620px" alt="" width="1254" height="1254" loading="lazy" decoding="async" fetchPriority="low"/></div>
   <section className="brand-maintenance-panel">
    <div className="brand-maintenance-eyebrow"><span className="brand-maintenance-dot" aria-hidden="true"/><span>BRUFF INC. <span>CRM</span></span></div>
    <h1 id={title}><span lang="es">Mantenimiento temporal</span><span lang="en">Temporary maintenance</span></h1>
    <div id={description} className="brand-maintenance-description"><p lang="es">Estamos actualizando BRUFF para que todo siga funcionando bien. Vuelve a intentarlo en unos minutos.</p><p lang="en">We’re updating BRUFF to keep everything running smoothly. Please try again in a few minutes.</p></div>
    <div className="brand-maintenance-status" role="status" aria-live="polite"><span className={'brand-maintenance-indicator'+(checking?' is-checking':'')} aria-hidden="true"/><span><span lang="es">{checking?'Comprobando disponibilidad…':'Actualización en curso'}</span><span lang="en">{checking?'Checking availability…':'Update in progress'}</span></span></div>
    {typeof onRetry==='function'&&<button type="button" className="brand-experience-button brand-maintenance-retry" disabled={checking} aria-busy={checking||undefined} onClick={()=>{if(!checking)onRetry()}}><span><span lang="es">Comprobar disponibilidad</span><span lang="en">Check availability</span></span><span className="brand-experience-arrow" aria-hidden="true">↗</span></button>}
    <small className="brand-maintenance-foot"><span lang="es">Gracias por tu paciencia.</span><span lang="en">Thank you for your patience.</span></small>
   </section>
  </div>
 </main>;
}
