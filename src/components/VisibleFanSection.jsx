import React,{useEffect,useRef,useState} from 'react';
// Defer provider reads until this section of the fan card is actually visible.
export function useFanSectionVisibility(){
 const ref=useRef(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const el=ref.current;if(!el)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{root:el.closest('.chat-fan-scroll'),rootMargin:'100px'});observer.observe(el);return()=>observer.disconnect()},[]);
 return [ref,visible];
}
export default function VisibleFanSection({children,title}){
 const [ref,visible]=useFanSectionVisibility(),[entered,setEntered]=useState(false);
 useEffect(()=>{if(visible)setEntered(true)},[visible]);
 return <div ref={ref}>{entered?React.cloneElement(children,{visible}):<section className="fan-record-section"><header><h3>{title}</h3></header></section>}</div>;
}
