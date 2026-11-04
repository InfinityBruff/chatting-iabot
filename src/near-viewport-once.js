// Admit a section once, then leave its mounted state (and cursor) intact.
export function observeNearViewportOnce(element,onEnter,{Observer=globalThis.IntersectionObserver,root=element?.closest('.workspace-content')||null,rootMargin='200px 0px'}={}){
 let active=true,entered=false,observer;
 const enter=()=>{if(!active||entered)return;entered=true;observer?.disconnect();onEnter()};
 if(element){
  if(typeof Observer!=='function')enter();
  else{observer=new Observer(entries=>{if(entries.some(entry=>entry.target===element&&entry.isIntersecting))enter()},{root,rootMargin});observer.observe(element)}
 }
 return()=>{active=false;observer?.disconnect()};
}
