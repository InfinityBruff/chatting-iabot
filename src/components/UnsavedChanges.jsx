import React,{createContext,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createUnsavedRegistry,editorChanged} from '../unsaved.js';
const Context=createContext(null);
export function UnsavedProvider({children}){
 const [registry]=useState(createUnsavedRegistry),[pending,setPending]=useState(null);const dialog=useRef(null),stay=useRef(null);
 useEffect(()=>{function warn(e){if(registry.hasChanges()){e.preventDefault();e.returnValue=''}}window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[registry]);
 useEffect(()=>{if(!pending)return;const node=dialog.current;node.showModal();stay.current?.focus();return()=>node.close()},[pending]);
 const request=action=>{if(registry.hasChanges())setPending({action,labels:registry.labels()});else action()};
 return <Context.Provider value={{registry,request}}>{children}{pending&&<dialog ref={dialog} className="campaign-dialog" aria-labelledby="unsaved-title" onCancel={e=>{e.preventDefault();setPending(null)}}><h2 id="unsaved-title">Tienes cambios sin guardar</h2><p className="unsaved-intro">{pending.labels.join(' · ')}. Puedes volver para guardarlos o descartarlos y continuar.</p><div className="dialog-foot"><button ref={stay} type="button" className="primary" onClick={()=>setPending(null)}>Seguir editando</button><button type="button" className="secondary" onClick={()=>{const action=pending.action;setPending(null);action()}}>Descartar y continuar</button></div></dialog>}</Context.Provider>;
}
export function useUnsavedChanges(dirty,label){const {registry}=useContext(Context);const key=useRef(Symbol());useLayoutEffect(()=>{registry.set(key.current,label,dirty);return()=>registry.remove(key.current)},[registry,dirty,label]);}
export function useGuardedNavigation(){return useContext(Context).request;}
export function useProtectedEditor(label){
 const [draft,setDraft]=useState(null);const baseline=useRef(null);const guard=useGuardedNavigation();
 useUnsavedChanges(editorChanged(draft,baseline.current),label);
 const finish=()=>{baseline.current=null;setDraft(null)};
 const open=value=>guard(()=>{baseline.current=structuredClone(value);setDraft(structuredClone(value))});
 return {draft,setDraft,open,finish,close:()=>guard(finish),discardThen:action=>guard(()=>{finish();action()})};
}
