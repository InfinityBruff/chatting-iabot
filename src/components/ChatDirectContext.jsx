import React,{createContext,lazy,Suspense,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {scopeKey,validateSuggestions} from '../chat-direct.js';
import {pageCacheEpoch} from '../live-page-cache.js';
import './chat-direct.css';

const Panel=lazy(()=>import('./ChatDirectPanel.jsx')),Context=createContext(null);
const blank=()=>({input:'',values:{},candidates:[],selectedId:null,selectedMessageId:null,revision:null,busy:false,error:'',notice:'',insertToken:null,inserted:false});
const cancelled=error=>error?.name==='AbortError';
export const useChatDirect=()=>useContext(Context);
export function ChatDirectProvider({actor,workspace,source,children}){
 return <ScopedProvider key={JSON.stringify([actor,workspace])} {...{actor,workspace,source}}>{children}</ScopedProvider>;
}
function ScopedProvider({actor,workspace,source,children}){
 const [context,setActiveContext]=useState(null),[entry,setEntry]=useState(blank),[open,setOpen]=useState(false),[captureEnabled,setCapture]=useState(false),[origin,setOrigin]=useState(null),[frame,setFrame]=useState(null),[focusRequest,setFocusRequest]=useState(0);
 const contexts=useRef(null),entryRef=useRef(entry),memory=useRef(new Map()),composers=useRef(new Map()),ownerEpoch=useRef(pageCacheEpoch()),generation=useRef(0),request=useRef(null),lastDirect=useRef(null),mounted=useRef(false),originElement=useRef(null),sourceRef=useRef(source),priorSource=useRef(source);sourceRef.current=source;
 const openRef=useRef(false),captureRef=useRef(false);
 const abort=useCallback(()=>{generation.current++;request.current?.abort();request.current=null},[]);
 const remember=useCallback((scope,value)=>{
  if(!scope)return;memory.current.delete(scope);memory.current.set(scope,value);
  let bytes=0;for(const item of memory.current.values())bytes+=JSON.stringify(item).length*2;
  while(memory.current.size>12||bytes>1048576){const first=memory.current.keys().next().value;if(first===undefined)break;bytes-=JSON.stringify(memory.current.get(first)).length*2;memory.current.delete(first)}
 },[]);
 const commit=useCallback(update=>{const next=typeof update==='function'?update(entryRef.current):update;entryRef.current=next;remember(contexts.current?.scope,next);if(mounted.current)setEntry(next)},[remember]);
 const syncEpoch=useCallback(()=>{
  if(ownerEpoch.current===pageCacheEpoch())return true;
  // Keep mounted editor registrations, not conversation data: their own bridge
  // checks current scope/revision/edit locks again. Unmount removes each entry;
  // changing actor/workspace replaces this entire provider and its registry.
  ownerEpoch.current=pageCacheEpoch();abort();memory.current.clear();contexts.current=null;lastDirect.current=null;entryRef.current=blank();captureRef.current=false;
  if(mounted.current){setActiveContext(null);setEntry(entryRef.current);setCapture(false)}return false;
 },[abort]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort()}},[abort]);
 useEffect(()=>{if(priorSource.current===source)return;priorSource.current=source;abort();lastDirect.current=null;memory.current.clear();commit(previous=>({...previous,candidates:[],selectedId:null,busy:false,error:'',notice:'',insertToken:null,inserted:false}))},[source,abort,commit]);
 const setContext=useCallback(payload=>{
  syncEpoch();const expected=payload&&scopeKey(payload);
  if(!payload||payload.actor!==actor||payload.workspace!==workspace||!expected||payload.scope!==expected||payload.canRead!==true||!Array.isArray(payload.messages)||typeof payload.revision!=='string'){
   abort();if(payload?.scope)memory.current.delete(payload.scope);contexts.current=null;entryRef.current=blank();setActiveContext(null);setEntry(entryRef.current);captureRef.current=false;setCapture(false);lastDirect.current=null;return;
  }
  const previous=contexts.current,changed=previous?.scope!==payload.scope||previous?.revision!==payload.revision;
  if(!changed&&previous?.canInsert===payload.canInsert&&previous?.modelName===payload.modelName&&previous?.fanName===payload.fanName&&previous?.historyComplete===payload.historyComplete)return;
  if(changed)abort();
  const value={...payload,messages:payload.messages.slice()};contexts.current=value;
  let saved=previous?.scope===payload.scope?entryRef.current:memory.current.get(payload.scope)||blank();
  if(saved.revision!==payload.revision)saved={...saved,candidates:[],selectedId:null,selectedMessageId:null,busy:false,error:'',notice:'',insertToken:null,inserted:false,revision:payload.revision};
  else if(previous?.scope!==payload.scope&&saved.busy)saved={...saved,busy:false};
  if(!sourceRef.current&&saved.candidates.length)saved={...saved,candidates:[],selectedId:null,insertToken:null,inserted:false};
  entryRef.current=saved;remember(payload.scope,saved);setEntry(saved);setActiveContext(value);
  if(previous?.scope!==payload.scope)lastDirect.current=null;
 },[actor,workspace,abort,syncEpoch,remember]);
 const clearContext=useCallback(scope=>{
  syncEpoch();if(contexts.current?.scope!==scope)return;
  abort();remember(scope,{...entryRef.current,busy:false});contexts.current=null;lastDirect.current=null;entryRef.current=blank();setEntry(entryRef.current);setActiveContext(null);
 },[abort,remember,syncEpoch]);
 const registerComposer=useCallback((scope,handler)=>{
  syncEpoch();if(typeof scope!=='string'||typeof handler!=='function')return()=>{};
  const registration={handler};composers.current.set(scope,registration);
  return()=>{if(composers.current.get(scope)===registration)composers.current.delete(scope)};
 },[syncEpoch]);
 const openFrom=useCallback(element=>{
  syncEpoch();if(!mounted.current)return;if(element?.getBoundingClientRect){const r=element.getBoundingClientRect();setOrigin({x:r.left+r.width/2,y:r.top+r.height/2});originElement.current=element}openRef.current=true;setOpen(true);setFocusRequest(value=>value+1);
 },[syncEpoch]);
 const close=useCallback(()=>{
  openRef.current=false;captureRef.current=false;abort();commit(previous=>({...previous,busy:false}));setCapture(false);setOpen(false);
  const element=originElement.current;if(element?.isConnected&&!element.disabled)element.focus({preventScroll:true});
 },[abort,commit]);
 const consult=useCallback(async({message,force=false}={})=>{
  if(!syncEpoch()||!mounted.current||!openRef.current)return;const current=contexts.current;if(!current?.canRead)return;
  if(message&&(!captureRef.current||message.isFromMe!==false||message.delivery))return;
  const selected=message?current.messages.find(item=>String(item.id)===String(message.id)&&item.isFromMe===false&&!item.delivery):null;
  if(message&&!selected)return;
  const directKey=selected?JSON.stringify([current.scope,current.revision,String(selected.id)]):null;
  if(directKey&&!force&&lastDirect.current===directKey)return;
  if(directKey)lastDirect.current=directKey;
  abort();const serial=generation.current,epoch=ownerEpoch.current,controller=new AbortController();request.current=controller;
  const input=selected?.text??entryRef.current.input;
  commit(previous=>({...previous,input:typeof input==='string'?input:'',selectedMessageId:selected?String(selected.id):previous.selectedMessageId,candidates:[],selectedId:null,insertToken:null,inserted:false,busy:typeof sourceRef.current==='function',error:'',notice:''}));
  const live=()=>mounted.current&&!controller.signal.aborted&&serial===generation.current&&epoch===pageCacheEpoch()&&contexts.current?.scope===current.scope&&contexts.current?.revision===current.revision;
  if(typeof sourceRef.current!=='function'){request.current=null;commit(previous=>({...previous,busy:false,error:'Fuente verificada sin conectar. Todavía no se pueden recuperar respuestas documentadas.'}));return}
  try{
   const payload=await sourceRef.current({scope:current.scope,revision:current.revision,input,context:{...current,selectedMessageId:selected?String(selected.id):entryRef.current.selectedMessageId},signal:controller.signal});
   if(!live())return;const candidates=validateSuggestions(payload,{scope:current.scope,revision:current.revision,allowedSourceModels:[current.account]});
   commit(previous=>({...previous,candidates,busy:false,revision:current.revision,notice:candidates.length?'Referencias verificadas recibidas. Selecciona una para revisarla.':'No hay respuestas documentadas comparables en la fuente consultada.'}));
  }catch(error){if(live()&&!cancelled(error))commit(previous=>({...previous,busy:false,candidates:[],selectedId:null,error:error?.message||'No se pudieron verificar las referencias.'}))}
  finally{if(request.current===controller)request.current=null}
 },[abort,commit,syncEpoch]);
 const selectMessage=useCallback(message=>{if(!mounted.current||!openRef.current||!captureRef.current||contexts.current?.canRead!==true)return;void consult({message})},[consult]);
 const setCaptureEnabled=useCallback(value=>{const enabled=value===true&&openRef.current&&contexts.current?.canRead===true;captureRef.current=enabled;setCapture(enabled);lastDirect.current=null;if(!enabled){abort();commit(previous=>({...previous,selectedMessageId:null,busy:false}))}},[abort,commit]);
 const editInput=useCallback(value=>{abort();lastDirect.current=null;commit(previous=>({...previous,input:String(value).slice(0,10000),candidates:[],selectedId:null,selectedMessageId:null,busy:false,error:'',notice:'',insertToken:null,inserted:false}))},[abort,commit]);
 const editValue=useCallback((key,value)=>commit(previous=>({...previous,values:{...previous.values,[key]:value},insertToken:crypto.randomUUID(),inserted:false,notice:''})),[commit]);
 const selectCandidate=useCallback(id=>commit(previous=>{const selected=previous.candidates.some(candidate=>candidate.id===id)?id:null;return {...previous,selectedId:selected,insertToken:selected?previous.selectedId===selected&&previous.insertToken?previous.insertToken:crypto.randomUUID():null,inserted:!!selected&&previous.selectedId===selected&&previous.inserted,notice:''}}),[commit]);
 const insert=useCallback(async({text,expectedText,mode,token})=>{
  if(!syncEpoch()||!mounted.current||!openRef.current)return{status:'stale'};const active=contexts.current,handler=active?.canInsert&&composers.current.get(active.scope)?.handler;
  if(!active?.canRead||!handler||entryRef.current.busy||typeof text!=='string'||!text.trim()||token!==entryRef.current.insertToken)return{status:'blocked'};
  const scope=active.scope,revision=active.revision,epoch=ownerEpoch.current,result=await handler({scope,revision,token,text,expectedText,mode});
  if(!mounted.current||epoch!==pageCacheEpoch()||contexts.current?.scope!==scope||contexts.current?.revision!==revision||contexts.current?.canRead!==true||contexts.current?.canInsert!==true)return{status:'stale'};
  if(result?.status==='inserted'||result?.status==='duplicate')commit(previous=>({...previous,inserted:true,notice:result.status==='duplicate'?'Esta opción ya se insertó.':'Insertada en el borrador. No se ha enviado ningún mensaje.'}));
  return result||{status:'blocked'};
 },[commit,syncEpoch]);
 const capturing=open&&captureEnabled&&context?.canRead===true;
 const value=useMemo(()=>({setContext,clearContext,registerComposer,openFrom,selectMessage,captureEnabled:capturing,setCaptureEnabled,selectedMessageId:capturing?entry.selectedMessageId:null,activeScope:context?.scope||null,context,revision:context?.revision||null,open}),[setContext,clearContext,registerComposer,openFrom,selectMessage,capturing,setCaptureEnabled,context,entry.selectedMessageId,open]);
 return <Context.Provider value={value}>{children}{open&&<Suspense fallback={null}><Panel {...{context,entry,sourceAvailable:typeof source==='function',captureEnabled:capturing,setCaptureEnabled,origin,frame,focusRequest,onFrame:setFrame,onClose:close,onInput:editInput,onValue:editValue,onSelect:selectCandidate,onConsult:consult,onInsert:insert}}/></Suspense>}</Context.Provider>;
}
