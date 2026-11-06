import React,{createContext,lazy,Suspense,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {scopeKey,validateChatDirectSuggestions as validateSuggestions,materializeChatDirectSuggestion as materializeSuggestion} from '../chat-direct.js';
import {pageCacheEpoch} from '../live-page-cache.js';
import {safeGenerationDiagnostic} from '../chat-direct-diagnostics.js';
import './chat-direct.css';

const Panel=lazy(()=>import('./ChatDirectPanel.jsx')),Context=createContext(null);
const blank=()=>({mode:'generative',diagnostic:null,input:'',values:{},candidates:[],knowledge:null,quota:null,quotaAt:null,quotaBusy:false,quotaError:'',selectedId:null,selectedMessageId:null,revision:null,busy:false,error:'',notice:'',insertToken:null,inserted:false});
const cancelled=error=>error?.name==='AbortError';
export const useChatDirect=()=>useContext(Context);
export function ChatDirectProvider({actor,workspace,source,canManage=false,children}){
 return <ScopedProvider key={JSON.stringify([actor,workspace])} {...{actor,workspace,source,canManage}}>{children}</ScopedProvider>;
}
function ScopedProvider({actor,workspace,source,canManage,children}){
 const [context,setActiveContext]=useState(null),[entry,setEntry]=useState(blank),[open,setOpen]=useState(false),[captureEnabled,setCapture]=useState(false),[origin,setOrigin]=useState(null),[frame,setFrame]=useState(null),[focusRequest,setFocusRequest]=useState(0);
 const contexts=useRef(null),entryRef=useRef(entry),memory=useRef(new Map()),quotaMemory=useRef(new Map()),quotaRequest=useRef(null),quotaSerial=useRef(0),composers=useRef(new Map()),ownerEpoch=useRef(pageCacheEpoch()),generation=useRef(0),request=useRef(null),lastDirect=useRef(null),mounted=useRef(false),originElement=useRef(null),sourceRef=useRef(source),priorSource=useRef(source);sourceRef.current=source;
 const openRef=useRef(false),captureRef=useRef(false);
 const abort=useCallback(()=>{generation.current++;request.current?.abort();request.current=null;quotaSerial.current++;quotaRequest.current?.abort();quotaRequest.current=null},[]);
 const remember=useCallback((scope,value)=>{
  if(!scope)return;memory.current.delete(scope);memory.current.set(scope,value);
  let bytes=0;for(const item of memory.current.values())bytes+=JSON.stringify(item).length*2;
  while(memory.current.size>12||bytes>1048576){const first=memory.current.keys().next().value;if(first===undefined)break;bytes-=JSON.stringify(memory.current.get(first)).length*2;memory.current.delete(first)}
 },[]);
 const commit=useCallback(update=>{let next=typeof update==='function'?update(entryRef.current):update;if(!quotaRequest.current&&next.quotaBusy)next={...next,quotaBusy:false};entryRef.current=next;remember(contexts.current?.scope,next);if(mounted.current)setEntry(next)},[remember]);
 const syncEpoch=useCallback(()=>{
  if(ownerEpoch.current===pageCacheEpoch())return true;
  // Keep mounted editor registrations, not conversation data: their own bridge
  // checks current scope/revision/edit locks again. Unmount removes each entry;
  // changing actor/workspace replaces this entire provider and its registry.
  ownerEpoch.current=pageCacheEpoch();abort();memory.current.clear();quotaMemory.current.clear();contexts.current=null;lastDirect.current=null;entryRef.current=blank();captureRef.current=false;
  if(mounted.current){setActiveContext(null);setEntry(entryRef.current);setCapture(false)}return false;
 },[abort]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort()}},[abort]);
 useEffect(()=>{if(priorSource.current===source)return;priorSource.current=source;abort();lastDirect.current=null;memory.current.clear();quotaMemory.current.clear();commit(previous=>({...previous,candidates:[],knowledge:null,quota:null,quotaAt:null,quotaError:'',diagnostic:null,selectedId:null,busy:false,error:'',notice:'',insertToken:null,inserted:false}))},[source,abort,commit]);
 const setContext=useCallback(payload=>{
  syncEpoch();const expected=payload&&scopeKey(payload);
  if(!payload||payload.actor!==actor||payload.workspace!==workspace||!expected||payload.scope!==expected||payload.canRead!==true||!Array.isArray(payload.messages)||typeof payload.revision!=='string'){
   abort();memory.current.clear();quotaMemory.current.clear();contexts.current=null;entryRef.current=blank();setActiveContext(null);setEntry(entryRef.current);captureRef.current=false;setCapture(false);lastDirect.current=null;return;
  }
  const previous=contexts.current,changed=previous?.scope!==payload.scope||previous?.revision!==payload.revision;
  if(!changed&&previous?.canInsert===payload.canInsert&&previous?.canVault===payload.canVault&&previous?.modelName===payload.modelName&&previous?.fanName===payload.fanName&&previous?.historyComplete===payload.historyComplete)return;
  if(changed||previous?.canInsert!==payload.canInsert||previous?.canVault!==payload.canVault)abort();
  const value={...payload,messages:payload.messages.slice()};contexts.current=value;
  let saved=previous?.scope===payload.scope?entryRef.current:memory.current.get(payload.scope)||blank();
  if(saved.revision!==payload.revision)saved={...saved,candidates:[],knowledge:null,diagnostic:null,selectedId:null,selectedMessageId:null,busy:false,error:'',notice:'',insertToken:null,inserted:false,revision:payload.revision};
  else if(previous?.scope!==payload.scope&&saved.busy)saved={...saved,busy:false};
  if(!quotaRequest.current&&saved.quotaBusy)saved={...saved,quotaBusy:false};
  if(payload.canInsert!==true){quotaMemory.current.delete(payload.account);saved={...saved,quota:null,quotaAt:null,quotaError:''}}
  if(!sourceRef.current&&saved.candidates.length)saved={...saved,candidates:[],knowledge:null,selectedId:null,insertToken:null,inserted:false};
  if(payload.canVault!==true&&saved.candidates.some(candidate=>candidate.content))saved={...saved,candidates:saved.candidates.map(candidate=>candidate.content?{...candidate,resolvedContent:{status:'unavailable',items:[],message:'No tienes acceso al baúl de esta modelo.'}}:candidate)};
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
 const loadQuota=useCallback(async({force=false}={})=>{
  if(!syncEpoch()||!mounted.current||!openRef.current)return;
  const current=contexts.current,reader=sourceRef.current;
  if(!current?.canRead||!current.canInsert||typeof reader?.readQuota!=='function')return;
  const key=current.account,cached=quotaMemory.current.get(key),day=new Date().toISOString().slice(0,10);
  if(!force&&cached&&(cached.quota?.usageDay??cached.day)===day){commit(previous=>({...previous,quota:cached.quota,quotaAt:cached.at,quotaError:cached.error,quotaBusy:false}));return}
  quotaRequest.current?.abort();const controller=new AbortController(),serial=++quotaSerial.current,epoch=ownerEpoch.current;quotaRequest.current=controller;
  const live=()=>mounted.current&&openRef.current&&!controller.signal.aborted&&serial===quotaSerial.current&&epoch===pageCacheEpoch()&&reader===sourceRef.current&&contexts.current?.scope===current.scope&&contexts.current?.revision===current.revision&&contexts.current?.canRead===true;
  commit(previous=>({...previous,quotaBusy:true,quotaError:'',...(force?{quota:null,quotaAt:null}:{})}));
  try{
   const quota=await reader.readQuota({scope:current.scope,revision:current.revision,context:current,signal:controller.signal});if(!live())return;
   const at=Date.now();quotaMemory.current.set(key,{quota,at,error:''});while(quotaMemory.current.size>12)quotaMemory.current.delete(quotaMemory.current.keys().next().value);
   commit(previous=>({...previous,quota,quotaAt:at,quotaError:''}));
  }catch(error){
   if(!live()||cancelled(error))return;
   const denied=error?.diagnostic?.reason==='access',message=denied?'No se pudo autorizar el cupo de esta modelo.':'No se pudo confirmar el cupo. Puedes actualizarlo manualmente.';
   if(denied){memory.current.clear();quotaMemory.current.clear()}else quotaMemory.current.set(key,{quota:null,at:null,error:message,day});
   commit(previous=>({...previous,quota:null,quotaAt:null,quotaError:message,...(denied?{candidates:[],knowledge:null,selectedId:null,insertToken:null,inserted:false}:{})}));
  }finally{if(quotaRequest.current===controller){quotaRequest.current=null;if(live())commit(previous=>({...previous,quotaBusy:false}))}}
 },[syncEpoch,commit]);
 useEffect(()=>{if(open&&(entry.mode||'generative')==='generative')void loadQuota()},[open,context?.scope,context?.revision,context?.canInsert,entry.mode,source,ownerEpoch.current,loadQuota]);
 const consult=useCallback(async({message,force=false}={})=>{
  if(!syncEpoch()||!mounted.current||!openRef.current||entryRef.current.busy)return;const current=contexts.current;if(!current?.canRead)return;
  if(message&&(!captureRef.current||message.isFromMe!==false||message.delivery))return;
  const selected=message?current.messages.find(item=>String(item.id)===String(message.id)&&item.isFromMe===false&&!item.delivery):null;
  if(message&&!selected)return;
  const directKey=selected?JSON.stringify([current.scope,current.revision,String(selected.id)]):null;
  if(directKey&&!force&&lastDirect.current===directKey)return;
  if(directKey)lastDirect.current=directKey;
  abort();const mode=entryRef.current.mode||'generative',serial=generation.current,epoch=ownerEpoch.current,controller=new AbortController();request.current=controller;
  const input=selected?.text??entryRef.current.input;
  commit(previous=>({...previous,input:typeof input==='string'?input:'',selectedMessageId:selected?String(selected.id):previous.selectedMessageId,...(previous.revision===current.revision?{}:{candidates:[],knowledge:null}),diagnostic:null,selectedId:null,insertToken:null,inserted:false,busy:typeof sourceRef.current==='function',error:'',notice:''}));
  const live=()=>mounted.current&&!controller.signal.aborted&&serial===generation.current&&epoch===pageCacheEpoch()&&contexts.current?.scope===current.scope&&contexts.current?.revision===current.revision;
  if(typeof sourceRef.current!=='function'){request.current=null;commit(previous=>({...previous,busy:false,error:'Fuente verificada sin conectar. Todavía no se pueden recuperar respuestas documentadas.'}));return}
  try{
   const payload=await sourceRef.current({scope:current.scope,revision:current.revision,mode,input,force:mode==='generative'&&force===true,context:{...current,selectedMessageId:selected?String(selected.id):entryRef.current.selectedMessageId},signal:controller.signal});
   if(!live())return;const verified=validateSuggestions(payload,{scope:current.scope,revision:current.revision,allowedSourceModels:[current.account]}),candidates=[];let contentError='';
   for(const candidate of verified){
    if(!candidate.content){candidates.push(candidate);continue}
    const resolver=composers.current.get(current.scope)?.handler;
    let resolvedContent={status:'unavailable',items:[],message:contexts.current?.canVault===true?'Abre el compositor de esta conversación para comprobar el contenido.':'No tienes acceso al baúl de esta modelo.'};
    if(contexts.current?.canVault===true&&resolver){
     const active=()=>live()&&contexts.current?.canVault===true;
     try{
      const result=await resolver({mode:'resolve-content',scope:current.scope,revision:current.revision,content:candidate.content,active});
      if(!live())return;
      if(active()&&result?.status==='resolved'&&Array.isArray(result.items))resolvedContent={status:'resolved',items:result.items};
      else resolvedContent={status:'unavailable',items:[],message:result?.message||'No se pudo verificar todo el contenido propuesto en el baúl.'};
     }catch(error){
      if(!live())return;
      const message=error?.status===429?'El proveedor ha limitado la lectura del baúl. Respeta su espera y pulsa GENERAR RESPUESTAS para volver a comprobar.':error?.status===401||error?.status===403?'No se pudo autorizar la consulta del baúl de esta modelo.':'No se pudo consultar el contenido propuesto. Vuelve a comprobar las referencias.';
      resolvedContent={status:'unavailable',items:[],message};contentError=message;
     }
    }
    if(!live())return;candidates.push({...candidate,resolvedContent});
   }
   if(!live())return;
   const knowledge=payload.knowledge&&['connected','empty'].includes(payload.knowledge.status)&&Number.isSafeInteger(payload.knowledge.approvedCount)&&payload.knowledge.approvedCount>=0?payload.knowledge:null;
   const quotaAt=payload.quota?Date.now():null;if(payload.quota)quotaMemory.current.set(current.account,{quota:payload.quota,at:quotaAt,error:''});
   commit(previous=>({...previous,candidates,knowledge,...(payload.quota?{quota:payload.quota,quotaAt,quotaError:''}:{}),diagnostic:null,busy:false,error:contentError,revision:current.revision,notice:candidates.length?knowledge?.engine==='generative'?knowledge.reused?'Borradores vigentes reutilizados. No se ha solicitado una nueva inferencia.':'Borradores generados. Revisa el texto y la traducción antes de insertarlos.':'Ejemplos revisados recibidos. Selecciona uno para comprobarlo.':knowledge?.status==='empty'?'Banco conectado. Añade y aprueba ejemplos para esta modelo.':knowledge?.engine==='generative'?'La IA no propuso un borrador con las fuentes disponibles. Revisa los datos pendientes.':'No hay respuestas documentadas comparables en la fuente consultada.'}));
  }catch(error){if(live()&&!cancelled(error)){
   if(mode==='generative')quotaMemory.current.delete(current.account);
   commit(previous=>({...previous,busy:false,candidates:[],knowledge:null,...(mode==='generative'?{quota:null,quotaAt:null}:{}),diagnostic:mode==='generative'?safeGenerationDiagnostic(error?.diagnostic)||safeGenerationDiagnostic({engine:'generative',reason:'unavailable'}):null,selectedId:null,insertToken:null,error:error?.message||'No se pudieron verificar las referencias.'}));
   if(mode==='generative'&&live())void loadQuota({force:true});
  }}
  finally{if(request.current===controller)request.current=null}
 },[abort,commit,syncEpoch,loadQuota]);
 const selectMessage=useCallback(message=>{if(!mounted.current||!openRef.current||!captureRef.current||contexts.current?.canRead!==true)return;void consult({message})},[consult]);
 const setCaptureEnabled=useCallback(value=>{const enabled=value===true&&openRef.current&&contexts.current?.canRead===true;captureRef.current=enabled;setCapture(enabled);lastDirect.current=null;if(!enabled){abort();commit(previous=>({...previous,selectedMessageId:null,busy:false}))}},[abort,commit]);
 const editInput=useCallback(value=>{abort();lastDirect.current=null;commit(previous=>({...previous,input:String(value).slice(0,10000),candidates:[],knowledge:null,diagnostic:null,selectedId:null,selectedMessageId:null,busy:false,error:'',notice:'',insertToken:null,inserted:false}))},[abort,commit]);
 const onMode=useCallback(mode=>{if(!['generative','bank'].includes(mode)||entryRef.current.mode===mode)return;abort();lastDirect.current=null;commit(previous=>({...blank(),mode,input:previous.input,revision:previous.revision}))},[abort,commit]);
 const editValue=useCallback((key,value)=>commit(previous=>({...previous,values:{...previous.values,[key]:value},insertToken:crypto.randomUUID(),inserted:false,notice:''})),[commit]);
 const selectCandidate=useCallback(id=>commit(previous=>{if(previous.busy)return previous;const selected=previous.candidates.some(candidate=>candidate.id===id)?id:null;return {...previous,selectedId:selected,insertToken:selected?previous.selectedId===selected&&previous.insertToken?previous.insertToken:crypto.randomUUID():null,inserted:!!selected&&previous.selectedId===selected&&previous.inserted,notice:''}}),[commit]);
 const insert=useCallback(async({text,expectedText,expectedSnapshot,mode,token})=>{
  if(!syncEpoch()||!mounted.current||!openRef.current)return{status:'stale'};const active=contexts.current,handler=active?.canInsert&&composers.current.get(active.scope)?.handler;
  const chosen=entryRef.current.candidates.find(candidate=>candidate.id===entryRef.current.selectedId);
  if(!active?.canRead||!handler||!chosen||entryRef.current.busy||typeof text!=='string'||!text.trim()||token!==entryRef.current.insertToken)return{status:'blocked'};
  if(!(chosen.content?['check','replace-bundle']:['check','append','replace']).includes(mode))return{status:'blocked'};
  const values=Object.fromEntries((chosen.variables||[]).filter(variable=>Object.hasOwn(entryRef.current.values,variable.key)).map(variable=>[variable.key,entryRef.current.values[variable.key]])),materialized=materializeSuggestion(chosen,values);
  if(!materialized.complete||text!==materialized.english)return{status:'stale'};
  if(chosen.content&&(active.canVault!==true||chosen.content.priceCents===null||chosen.resolvedContent?.status!=='resolved'))return{status:'blocked'};
  const scope=active.scope,revision=active.revision,epoch=ownerEpoch.current,serial=generation.current,verifiedSource=sourceRef.current;
  const live=()=>mounted.current&&openRef.current&&serial===generation.current&&verifiedSource===sourceRef.current&&epoch===pageCacheEpoch()&&contexts.current?.scope===scope&&contexts.current?.revision===revision&&contexts.current?.canRead===true&&contexts.current?.canInsert===true&&entryRef.current.insertToken===token&&entryRef.current.selectedId===chosen.id&&(!chosen.content||contexts.current?.canVault===true);
  let result;
  try{
   if(mode!=='check'&&typeof sourceRef.current?.verify==='function'){
    const verifier=sourceRef.current,controller=new AbortController();request.current=controller;
    try{if(await verifier.verify({scope,revision,context:active,candidate:chosen,signal:controller.signal})!==true)return{status:'blocked'}}
    catch(error){if(!live()||controller.signal.aborted)return{status:'stale'};return{status:'unavailable',message:error?.message||'No se pudo volver a comprobar la referencia.'}}
    finally{if(request.current===controller)request.current=null}
    if(!live()||sourceRef.current!==verifier)return{status:'stale'};
   }
   result=await handler({scope,revision,token,text:materialized.english,expectedText,expectedSnapshot,mode,content:chosen.content||null,active:live});
  }
  catch(error){
   if(!live())return{status:'stale'};
   if(!chosen.content)throw error;
   result={status:'unavailable',message:error?.status===429?'El proveedor ha limitado la lectura del baúl. Respeta su espera y vuelve a GENERAR RESPUESTAS.':error?.status===401||error?.status===403?'No se pudo autorizar el contenido del baúl. Vuelve a comprobar la propuesta.':'No se pudo volver a verificar el contenido. Genera de nuevo las referencias antes de preparar.'};
  }
  if(!live())return{status:'stale'};
  if(chosen.content&&result?.status==='unavailable')commit(previous=>({...previous,candidates:previous.candidates.map(candidate=>candidate.id===chosen.id?{...candidate,resolvedContent:{status:'unavailable',items:[],message:result.message}}:candidate),notice:''}));
  if(result?.status==='inserted'||result?.status==='duplicate')commit(previous=>({...previous,inserted:true,notice:result.status==='duplicate'?'Esta opción ya se insertó.':'Insertada en el borrador. No se ha enviado ningún mensaje.'}));
  return result||{status:'blocked'};
 },[commit,syncEpoch]);
 const onKnowledgeChanged=useCallback(()=>{abort();memory.current.clear();quotaMemory.current.clear();lastDirect.current=null;commit(previous=>({...blank(),mode:previous.mode||'generative',input:previous.input,revision:previous.revision,notice:'Base actualizada. Consulta de nuevo con el modo elegido.'}));void loadQuota({force:true})},[abort,commit,loadQuota]);
 const capturing=open&&captureEnabled&&context?.canRead===true;
 const value=useMemo(()=>({setContext,clearContext,registerComposer,openFrom,selectMessage,captureEnabled:capturing,setCaptureEnabled,selectedMessageId:capturing?entry.selectedMessageId:null,activeScope:context?.scope||null,context,revision:context?.revision||null,open}),[setContext,clearContext,registerComposer,openFrom,selectMessage,capturing,setCaptureEnabled,context,entry.selectedMessageId,open]);
 return <Context.Provider value={value}>{children}{open&&<Suspense fallback={null}><Panel {...{context,entry,canManage,actor,workspace,onKnowledgeChanged,onMode,onQuota:()=>loadQuota({force:true}),sourceAvailable:typeof source==='function',captureEnabled:capturing,setCaptureEnabled,origin,frame,focusRequest,onFrame:setFrame,onClose:close,onInput:editInput,onValue:editValue,onSelect:selectCandidate,onConsult:consult,onInsert:insert}}/></Suspense>}</Context.Provider>;
}
