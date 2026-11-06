import React,{useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {authClient} from '../auth.js';
import './ChatDirectModelKnowledge.css';

const FACTS={public_name:'Nombre público',age:'Edad',country:'País',city:'Ciudad',language:'Idioma',about:'Presentación'};
const KINDS={style_rule:'Regla de estilo',model_fact:'Dato de la modelo',boundary:'Límite o condición'};
const STATES={draft:'Borrador',verified:'Aprobado',archived:'Archivado'};
const identifier=(value,max)=>typeof value==='string'&&value.length<=max&&/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value)&&value!=='0';
const denied=error=>error?.code==='42501'||[401,403].includes(Number(error?.status));
const empty=()=>({id:null,version:0,kind:'style_rule',key:null,text:'',referenceId:'',label:'',sourceVersion:'',state:'draft'});
const identity=(value,scope)=>value?.actorId===scope.actor&&value.workspaceId===scope.workspace&&value.creatorId===scope.account;
function invalidIdentity(){return Object.assign(Error('identity'),{status:403})}
function knowledgeSnapshot(data,scope){
 if(!identity(data,scope))throw invalidIdentity();
 if(data.schemaVersion!==1||data.canEdit!==true||!Array.isArray(data.items)||data.items.length>200||!Number.isSafeInteger(data.total)||data.total<data.items.length||data.limit!==200||typeof data.complete!=='boolean')throw Error('schema');
 const ids=new Set(),facts=new Set();
 for(const item of data.items){
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||!Number.isSafeInteger(item.version)||item.version<1||!Object.hasOwn(KINDS,item.kind)||!Object.hasOwn(STATES,item.state)||typeof item.text!=='string'||!item.text.trim()||item.text.length>1200||typeof item.label!=='string'||!item.label.trim()||item.label.length>160||!identifier(item.referenceId,128)||!identifier(item.sourceVersion,96))throw Error('schema');
  if(item.kind==='model_fact'){
   if(!Object.hasOwn(FACTS,item.key)||item.key==='age'&&(!/^\d{2,3}$/u.test(item.text.trim())||Number(item.text)<18||Number(item.text)>100)||item.state==='verified'&&facts.has(item.key))throw Error('schema');
   if(item.state==='verified')facts.add(item.key);
  }else if(item.key!==null)throw Error('schema');
  ids.add(item.id);
 }
 return {...data,complete:data.complete&&data.total===data.items.length};
}
function configSnapshot(data,scope){
 if(!identity(data,scope))throw invalidIdentity();
 const s=data.settings;
 if(!s||Object.keys(s).length!==3||typeof s.enabled!=='boolean'||!Number.isSafeInteger(s.dailyLimit)||s.dailyLimit<1||s.dailyLimit>12||!Number.isSafeInteger(s.maxResults)||s.maxResults<1||s.maxResults>3||!Number.isSafeInteger(data.version)||data.version<0)throw Error('schema');
 return {...data,settings:{enabled:s.enabled,dailyLimit:s.dailyLimit,maxResults:s.maxResults}};
}

// The parent keys this resource by actor/agency/model and mounts only its active
// owner tab. Reads abort on unmount; ambiguous writes are never auto-repeated.
function useOwnerResource(scope,type,onChanged){
 const [data,setData]=useState(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[needsReload,setNeedsReload]=useState(false);
 const alive=useRef(false),read=useRef(null),epoch=useRef(0),writeEpoch=useRef(0),lock=useRef(false),changed=useRef(onChanged);changed.current=onChanged;
 const {workspace,account,actor}=scope,valid=[workspace,account,actor].every(value=>typeof value==='string'&&!!value),rpc=type==='knowledge'?'bruff_model_knowledge':'bruff_generation_control',normalize=type==='knowledge'?knowledgeSnapshot:configSnapshot;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;writeEpoch.current++;read.current?.abort()}},[]);
 const load=useCallback(async()=>{
  if(!valid||lock.current)return null;read.current?.abort();const controller=new AbortController(),serial=++epoch.current;read.current=controller;
  const current=()=>alive.current&&serial===epoch.current&&!controller.signal.aborted;setLoading(true);setError('');
  try{
   const args={w:workspace,c:account,op:type==='knowledge'?'list':'read',expected:null,value:null,...(type==='knowledge'?{entry_id:null}:{})};
   const {data:result,error:failure}=await authClient.rpc(rpc,args).abortSignal(controller.signal);if(!current())return null;if(failure)throw failure;
   const next=normalize(result,{workspace,account,actor});setData(next);setNeedsReload(false);return next;
  }catch(failure){if(current()){if(denied(failure))setData(null);setError(denied(failure)?'Tu acceso de propietario ya no está disponible. Se ha retirado la información de esta vista.':['PGRST202','42883'].includes(failure?.code)?'Este apartado todavía no está habilitado en el servicio.':'No se pudo consultar este apartado. Puedes volver a intentarlo.')}return null}
  finally{if(current()){read.current=null;setLoading(false)}}
 },[workspace,account,actor,type,rpc,normalize,valid]);
 useEffect(()=>{void load();return()=>{epoch.current++;read.current?.abort()}},[load]);
 const mutate=async(args,message)=>{
  if(lock.current||!valid||!data||needsReload)return null;lock.current=true;epoch.current++;read.current?.abort();read.current=null;const serial=++writeEpoch.current,current=()=>alive.current&&serial===writeEpoch.current;
  setLoading(false);setSaving(true);setError('');setNotice('');
  try{
   const {data:result,error:failure}=await authClient.rpc(rpc,{w:workspace,c:account,...args});if(!current())return null;if(failure)throw failure;
   const next=normalize(result,{workspace,account,actor});setData(next);setNeedsReload(false);setNotice(message);
   try{changed.current?.({workspace,account,actor,operation:args.op,kind:type})}catch{/* The database already confirmed the change. */}return next;
  }catch(failure){if(current()){if(denied(failure)){setData(null);setError('Tu acceso de propietario ya no está disponible. No se ha confirmado el cambio.')}else{setNeedsReload(true);setError(failure?.code==='40001'?'Este registro cambió en otra sesión. Actualiza y revisa su versión actual antes de guardar.':'No se pudo confirmar el cambio. Actualiza y comprueba su estado antes de repetirlo.')}}return null}
  finally{lock.current=false;if(current())setSaving(false)}
 };
 return {data,loading,saving,error,notice,needsReload,valid,load,mutate,setError,setNotice};
}

export default function ChatDirectModelKnowledge({workspace,account,actor,onChanged,mode='knowledge'}){
 const scope={workspace:typeof workspace==='string'?workspace:workspace?.id,account:typeof account==='string'?account:account?.id,actor};
 return mode==='generation'?<GenerationSettings key={JSON.stringify([actor,scope.workspace,scope.account,'generation'])} scope={scope} onChanged={onChanged}/>:<ModelKnowledge key={JSON.stringify([actor,scope.workspace,scope.account,'knowledge'])} scope={scope} onChanged={onChanged}/>;
}
function Feedback({resource}){return <>{resource.error&&<p className="cd-model-error" role="alert">{resource.error}</p>}{resource.notice&&<p className="cd-model-notice" role="status">{resource.notice}</p>}{resource.needsReload&&<p className="cd-model-hint">La escritura está en pausa hasta actualizar. No se repetirá automáticamente.</p>}</>}

function ModelKnowledge({scope,onChanged}){
 const resource=useOwnerResource(scope,'knowledge',onChanged),[form,setForm]=useState(empty),[reviewed,setReviewed]=useState(false),[filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[archive,setArchive]=useState(false),id=useId();
 useEffect(()=>{if(!resource.data){setForm(empty());setReviewed(false);setArchive(false);setQuery('');setFilter('all')}},[resource.data]);
 const items=resource.data?.items||[],locked=resource.saving||!resource.data,saveLocked=locked||resource.needsReload;
 const visible=useMemo(()=>items.filter(item=>(filter==='all'||item.kind===filter)&&(!query.trim()||[item.text,item.label,item.referenceId].some(text=>text.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'))))),[items,filter,query]);
 const choose=item=>{if(resource.saving)return;setForm(item?{...empty(),...item}:empty());setReviewed(false);setArchive(false);resource.setError('');resource.setNotice('')};
 const edit=(field,value)=>{setForm(previous=>({...previous,[field]:value,...(field==='kind'?{key:value==='model_fact'?'public_name':null}:{})}));setReviewed(false);setArchive(false);resource.setNotice('')};
 const save=async state=>{
  if(saveLocked)return;
  if(!form.text.trim()||form.text.length>1200||!form.label.trim()||form.label.length>160||!identifier(form.referenceId,128)||!identifier(form.sourceVersion,96)){resource.setError('Completa el texto, la fuente real y su versión. Los identificadores no admiten espacios.');return}
  if(form.kind==='model_fact'&&form.key==='age'&&(!/^\d{2,3}$/u.test(form.text.trim())||Number(form.text)<18||Number(form.text)>100)){resource.setError('La edad declarada debe ser un entero entre 18 y 100, contrastado con la fuente.');return}
  if(state==='verified'&&!reviewed){resource.setError('La aprobación requiere tu revisión de la fuente y del contenido.');return}
  const next=await resource.mutate({op:'save',entry_id:form.id,expected:form.id?form.version:0,value:{kind:form.kind,key:form.kind==='model_fact'?form.key:null,text:form.text,referenceId:form.referenceId,label:form.label,sourceVersion:form.sourceVersion,state}},state==='verified'?'Conocimiento aprobado para esta modelo. No se ha ejecutado ninguna consulta ni enviado mensajes.':'Borrador guardado. No se utilizará hasta que el propietario lo apruebe.');
  if(next){setForm(next.items.find(item=>item.id===next.savedId)||empty());setReviewed(false);setArchive(false)}
 };
 const archiveEntry=async()=>{const next=await resource.mutate({op:'archive',entry_id:form.id,expected:form.version,value:null},'Registro archivado. Ya no se utilizará en nuevas consultas.');if(next){setForm(next.items.find(item=>item.id===next.savedId)||empty());setReviewed(false);setArchive(false)}};
 return <section className="cd-model-knowledge" aria-label="Conocimiento de modelo">
  <header><div><small>PROPIETARIO · SOLO ESTA MODELO</small><h3>Reglas, datos y límites</h3></div><button type="button" disabled={!resource.valid||resource.loading||resource.saving} onClick={()=>void resource.load()}>Actualizar</button></header>
  <p className="cd-model-intro">Solo el conocimiento aprobado se utiliza al preparar borradores. Lo hablado en «Memoria chats 1» se guarda aquí mediante una acción explícita del conector y se revisa después; no se importa el chat ni se entrena un modelo.</p>
  <div className="cd-model-facts" aria-label="Datos aprobados disponibles">{Object.entries(FACTS).map(([key,label])=>{const fact=items.find(item=>item.kind==='model_fact'&&item.key===key&&item.state==='verified');return <div key={key}><small>{label}</small><strong>{fact?fact.text:resource.data?'Sin dato aprobado':'Sin verificar'}</strong></div>})}</div>
  <Feedback resource={resource}/>{resource.loading&&<p className="cd-model-hint" role="status">Consultando conocimiento…</p>}{resource.data&&!resource.data.complete&&<p className="cd-model-error">Se muestran {items.length} de {resource.data.total} registros. Esta vista no representa la base completa.</p>}
  <div className="cd-model-find"><label><span>Buscar</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Texto o referencia"/></label><label><span>Tipo</span><select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Todos</option>{Object.entries(KINDS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button type="button" disabled={locked} onClick={()=>choose(null)}>+ Nuevo</button></div>
  <div className="cd-model-list">{visible.map(item=><button type="button" key={item.id} disabled={resource.saving} aria-pressed={form.id===item.id} onClick={()=>choose(item)}><span><strong>{item.kind==='model_fact'?FACTS[item.key]:KINDS[item.kind]}</strong><small>{item.text}</small><em>{item.label} · {item.sourceVersion} · revisión {item.version}</em></span><b data-state={item.state}>{STATES[item.state]}</b></button>)}{resource.data&&!visible.length&&<p className="cd-model-empty">{items.length?'No hay registros con este filtro.':'Todavía no hay conocimiento guardado. Los datos ausentes se mantienen como desconocidos.'}</p>}</div>
  {resource.data&&<form onSubmit={event=>event.preventDefault()}><h4>{form.id?'Editar conocimiento':'Nuevo conocimiento'}</h4><fieldset disabled={locked}>
   <div className="cd-model-two"><label htmlFor={id+'-kind'}><span>Tipo de conocimiento</span><select id={id+'-kind'} value={form.kind} onChange={event=>edit('kind',event.target.value)}>{Object.entries(KINDS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{form.kind==='model_fact'&&<label htmlFor={id+'-key'}><span>Dato de la modelo</span><select id={id+'-key'} value={form.key||'public_name'} onChange={event=>edit('key',event.target.value)}>{Object.entries(FACTS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}</div>
   <label htmlFor={id+'-text'}><span>{form.kind==='model_fact'?'Valor declarado y contrastado':'Texto de la regla o límite'}</span><textarea id={id+'-text'} value={form.text} maxLength={1200} onChange={event=>edit('text',event.target.value)} placeholder="Escribe solo información que puedas acreditar para esta modelo"/></label>
   <label htmlFor={id+'-label'}><span>Nombre de la fuente</span><input id={id+'-label'} value={form.label} maxLength={160} onChange={event=>edit('label',event.target.value)} placeholder="Documento o nota revisada"/></label>
   <div className="cd-model-two"><label htmlFor={id+'-ref'}><span>Identificador de la fuente</span><input id={id+'-ref'} value={form.referenceId} maxLength={128} spellCheck={false} onChange={event=>edit('referenceId',event.target.value)}/></label><label htmlFor={id+'-version'}><span>Versión de la fuente</span><input id={id+'-version'} value={form.sourceVersion} maxLength={96} spellCheck={false} onChange={event=>edit('sourceVersion',event.target.value)}/></label></div>
   <p className="cd-model-hint">Sin fuente aprobada no se deducen identidades ni datos personales. Solo puede haber un dato aprobado por clave; resuelve cualquier discrepancia antes de aprobar otro. Una edad declarada debe revisarse cuando cambie.</p>
   <label className="cd-model-check"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>He revisado esta fuente y confirmo que es información no explícita, correcta y aplicable a esta modelo.</span></label>
  </fieldset><div className="cd-model-actions"><button type="button" disabled={saveLocked} onClick={()=>void save('draft')}>Guardar borrador</button><button type="button" className="cd-model-primary" disabled={saveLocked||!reviewed} onClick={()=>void save('verified')}>Aprobar y guardar</button>{form.id&&form.state!=='archived'&&<button type="button" disabled={saveLocked} onClick={()=>setArchive(true)}>Archivar</button>}</div>
  {archive&&<div className="cd-model-confirm"><p>Este registro dejará de usarse en nuevas consultas. Se conservará su referencia.</p><div><button type="button" disabled={saveLocked} onClick={()=>void archiveEntry()}>Confirmar archivo</button><button type="button" disabled={resource.saving} onClick={()=>setArchive(false)}>Cancelar</button></div></div>}</form>}
 </section>;
}

function GenerationSettings({scope,onChanged}){
 const resource=useOwnerResource(scope,'generation',onChanged),[draft,setDraft]=useState(null),[consent,setConsent]=useState(false),[refreshReview,setRefreshReview]=useState(false),dirty=useRef(false),id=useId();
 useEffect(()=>{if(!resource.data){dirty.current=false;setDraft(null);setConsent(false)}else if(!dirty.current)setDraft({settings:{...resource.data.settings},version:resource.data.version})},[resource.data]);
 const edit=(key,value)=>{dirty.current=true;setDraft(previous=>({...previous,settings:{...previous.settings,[key]:value}}));setConsent(false);resource.setNotice('')};
 const refresh=async()=>{if(dirty.current&&!refreshReview){setRefreshReview(true);return}dirty.current=false;setConsent(false);setRefreshReview(false);const next=await resource.load();if(next)setDraft({settings:{...next.settings},version:next.version})};
 const save=async()=>{
  if(!draft||resource.saving||resource.needsReload)return;const s=draft.settings;
  if(!Number.isSafeInteger(s.dailyLimit)||s.dailyLimit<1||s.dailyLimit>12||!Number.isSafeInteger(s.maxResults)||s.maxResults<1||s.maxResults>3){resource.setError('Elige entre 1 y 12 consultas diarias y entre 1 y 3 borradores.');return}
  if(s.enabled&&!consent){resource.setError('Revisa y autoriza la transferencia de contexto antes de habilitar las consultas.');return}
  const next=await resource.mutate({op:'save',expected:draft.version,value:{enabled:s.enabled,dailyLimit:s.dailyLimit,maxResults:s.maxResults}},s.enabled?'Preferencias guardadas. Las consultas generativas se realizarán solo cuando las solicites; no se ha consultado el motor ni enviado mensajes.':'Generación desactivada. Se conserva el funcionamiento del banco y su configuración.');
  if(next){dirty.current=false;setConsent(false);setDraft({settings:{...next.settings},version:next.version})}
 };
 const locked=resource.saving||!resource.data;
 return <section className="cd-model-knowledge cd-generation-settings" aria-label="Configuración de borradores generativos">
  <header><div><small>PROPIETARIO · CONSULTAS MANUALES</small><h3>Borradores con contexto</h3></div><button type="button" disabled={!resource.valid||resource.loading||resource.saving} onClick={()=>void refresh()}>Actualizar</button></header>
  <p className="cd-model-intro">Esta opción genera borradores no explícitos en inglés y español. Usa el historial reciente verificado por el servidor y fuentes aprobadas de esta modelo. Cada respuesta requiere revisión humana; nunca se envía automáticamente.</p>
  <Feedback resource={resource}/>{resource.loading&&<p className="cd-model-hint" role="status">Consultando configuración…</p>}{refreshReview&&<div className="cd-model-confirm"><p>Actualizar sustituirá los cambios sin guardar por la configuración del servidor.</p><div><button type="button" onClick={()=>void refresh()}>Descartar cambios y actualizar</button><button type="button" onClick={()=>setRefreshReview(false)}>Cancelar</button></div></div>}
  {draft&&resource.data&&<form onSubmit={event=>event.preventDefault()}><div className="cd-generation-state"><span>Estado guardado</span><strong>{resource.data.settings.enabled?'Habilitado para consultas manuales':'Desactivado'}</strong><small>Revisión {resource.data.version}{dirty.current?' · Cambios sin guardar':''}</small></div><fieldset disabled={locked}>
   <label className="cd-model-check"><input type="checkbox" checked={draft.settings.enabled} onChange={event=>edit('enabled',event.target.checked)}/><span>Habilitar borradores generativos para esta modelo</span></label>
   <div className="cd-model-two"><label htmlFor={id+'-daily'}><span>Máximo de consultas por día</span><input id={id+'-daily'} type="number" min="1" max="12" step="1" value={draft.settings.dailyLimit} onChange={event=>edit('dailyLimit',event.target.value===''?'':Number(event.target.value))}/></label><label htmlFor={id+'-results'}><span>Borradores por consulta</span><select id={id+'-results'} value={draft.settings.maxResults} onChange={event=>edit('maxResults',Number(event.target.value))}>{[1,2,3].map(number=><option value={number} key={number}>Hasta {number}</option>)}</select></label></div>
   <div className="cd-generation-transfer"><strong>Qué se comparte al consultar</strong><p>Se transferirán a Cloudflare hasta 20 mensajes recientes confirmados del chat y una selección acotada de ejemplos, reglas y datos aprobados. El contexto se limita en el servidor; no se comparte todo el historial ni otros fans o modelos.</p><p>Las consultas consumen una reserva del cupo gratuito compartido. El límite de BRUFF no garantiza la cuota restante de Cloudflare. Si faltan fuentes, configuración o cuota, no se presentan respuestas inventadas.</p></div>
   {draft.settings.enabled&&<label className="cd-model-check cd-generation-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>Entiendo y autorizo esta transferencia de contexto a Cloudflare al solicitar cada consulta manual. Revisaré los borradores antes de enviarlos desde el chat.</span></label>}
  </fieldset><div className="cd-model-actions"><button type="button" className="cd-model-primary" disabled={locked||resource.needsReload||draft.settings.enabled&&!consent} onClick={()=>void save()}>{resource.saving?'Guardando…':'Guardar preferencias'}</button></div><p className="cd-model-hint">Guardar no prueba que el proveedor esté conectado. Una consulta real debe confirmarse después. Con la generación desactivada puedes usar «Buscar ejemplos»; ese modo conserva los ajustes del banco o búsqueda semántica.</p></form>}
 </section>;
}
