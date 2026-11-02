import NativeMassQueue from './NativeMassQueue.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {preparationPlan} from '../../server/advanced-preparation.js';
export default function MassExecutionPreparation({client,workspace,creator,draft,dirty,cloud}){
 const scope=JSON.stringify([workspace,creator,draft.id,draft.version,dirty]),serial=useRef(0),locked=useRef(false);
 const [state,setState]=useState({scope}),[review,setReview]=useState(false);
 useEffect(()=>{++serial.current;setState({scope});setReview(false);return()=>{++serial.current}},[scope]);
 useEffect(()=>{
  if(!cloud||!draft.id||dirty)return;const turn=++serial.current;
  client.rpc('bruff_native_for_draft',{w:workspace,c:creator,d:draft.id}).then(({data,error})=>{
   if(!error&&data?.draftId===draft.id&&data.draftVersion===draft.version&&turn===serial.current)setState({scope,run:data});
  }).catch(()=>{});
 },[scope,client,cloud]);
 const current=state.scope===scope?state:{};
 let unavailable='';try{preparationPlan(draft)}catch(e){unavailable=e.message}
 const prepare=async()=>{
  if(locked.current||dirty||!cloud||!draft.id||unavailable)return;
  locked.current=true;const turn=++serial.current;setReview(false);setState({scope,busy:true});
  try{
   const {data,error}=await client.functions.invoke('bruff-live',{body:{operation:'automation_prepare',workspace_id:workspace,creator_id:creator,draft_id:draft.id,expected_version:draft.version}});
   if(error){let detail;try{detail=await error.context.json()}catch{}throw Error(detail?.error||'Preparación no disponible todavía en el servidor. No se ha activado nada.')}
   const result=data?.data;if(result?.creatorId!==creator||result.draftId!==draft.id||result.draftVersion!==draft.version||result.activated!==false||!result.execution?.id)throw Error('Preparación no correspondiente a esta campaña');
   const status=await client.rpc(result.execution.kind==='native'?'bruff_native_status':'bruff_mass_status',{w:workspace,c:creator,run_id:result.execution.id});
   if(status.error)throw status.error;
   if(status.data?.id!==result.execution.id||status.data.draftId!==draft.id||status.data.draftVersion!==draft.version)throw Error('Estado de ejecución no válido');
   if(turn===serial.current)setState({scope,run:status.data});
  }catch(e){if(turn===serial.current)setState({scope,error:e.message})}finally{locked.current=false}
 };
 const activate=async()=>{
  if(locked.current||dirty||!review||!current.run?.canActivate)return;
  locked.current=true;const turn=++serial.current;setState(s=>({...s,busy:true}));
  try{
   const response=current.run.kind==='native'?await client.functions.invoke('bruff-live',{body:{operation:'native_activate',workspace_id:workspace,creator_id:creator,run_id:current.run.id,expected_revision:current.run.revision}}):await client.rpc('bruff_activate_mass',{w:workspace,c:creator,run_id:current.run.id,expected_revision:current.run.revision});if(response.error)throw response.error;const data=current.run.kind==='native'?response.data?.data:response.data;
   if(data?.id!==current.run.id||!['active','accepted','uncertain'].includes(data.state))throw Error('No se confirmó la activación');
   if(turn===serial.current){setState({scope,activated:true,outcome:data.state,run:current.run.kind==='native'?{...current.run,state:data.state,canActivate:false,queueId:data.queueId}:undefined});setReview(false)}
  }catch(e){if(turn===serial.current)setState(s=>({...s,busy:false,error:e.message}))}finally{locked.current=false}
 };
 const run=current.run,m=draft.messages[0];
 return <section className="am-card" aria-label="Preparar ejecución masiva"><h3>Preparar ejecución</h3><p className="am-help">1. Guarda el borrador. 2. Completa la comprobación de destinatarios. 3. Prepara una ejecución pausada y revisa el envío. Solo el propietario puede activarla.</p>
 {unavailable&&<p className="am-notice">{unavailable}</p>}
 <button type="button" className="am-primary" onClick={prepare} disabled={current.busy||dirty||!cloud||!draft.id||!!unavailable}>{current.busy?'Comprobando…':'Preparar sin enviar'}</button>
 {current.error&&<p role="alert" className="am-notice">{current.error}</p>}
 {current.activated&&<p role="status">{current.outcome==='accepted'?'OnlyFans ha aceptado el masivo. Esto no confirma todavía la entrega a todos los destinatarios.':current.outcome==='uncertain'?'El proveedor no confirmó el resultado. No repitas el envío: comprueba primero la cola de OnlyFans.':'Campaña activada. Consulta el seguimiento en «Ejecuciones en la nube».'}</p>}
 {run&&<div className="am-message-card"><h4>{run.kind==='native'?({prepared:'Masivo nativo · preparado',accepted:'Masivo aceptado por OnlyFans',submitting:'Envío pendiente de confirmación',uncertain:'Resultado incierto · no reenviar'}[run.state]||'Masivo nativo'):'Ejecución preparada · sin activar'}</h4><p><b>{run.count?.toLocaleString('es-ES')} destinatarios</b> · {run.plan?.cycles} ejecución(es)</p><p className="am-help">La selección queda fijada para esta ejecución. Las exclusiones se conservan. {run.plan?.singleDeliveryWindowHours===24?'El envío único tiene una ventana máxima de 24 horas desde el inicio.':''}</p>
 {run.kind!=='native'&&!run.workerReady&&<p role="status">Programador pendiente de conexión. La activación permanece bloqueada.</p>}{run.queueId&&<p>Referencia de cola de OnlyFans: <b>{run.queueId}</b></p>}{['accepted','uncertain','submitting'].includes(run.state)&&<p className="am-notice">{run.state==='accepted'?'Aceptado por el proveedor; no equivale a entrega confirmada a cada fan.':'No repitas esta campaña. Revisa su resultado en OnlyFans antes de crear otro envío.'}</p>}{!run.ownerAccess&&<p>Solo el propietario puede activar esta preparación.</p>}
 <button type="button" disabled={!run.canActivate||current.busy||dirty} onClick={()=>setReview(true)}>Revisar activación</button>
 {run.kind==='native'&&run.queueId&&run.state==='accepted'&&<NativeMassQueue key={run.id} client={client} workspace={workspace} creator={creator} run={run}/>}
 {review&&<div role="group" aria-label="Confirmar activación masiva" className="am-notice"><h4>{draft.name}</h4><p>{m.text||'Contenido adjunto'}</p><p>{m.media.length} adjuntos · {m.paidMedia||m.paidText?`${m.price} USD`:'Gratis'}</p><p>{run.count} destinatarios · {draft.bulk.repeat?`Cada ${draft.bulk.intervalMinutes} minutos · ${run.plan.cycles} ejecuciones`:'Un único envío por fan'}</p><p>Inicio: {draft.bulk.schedule==='manual'?'Al activar':new Date(draft.bulk.at).toLocaleString('es-ES')}. Preparación válida durante 30 minutos. Al confirmar se habilitan envíos reales según el horario.</p><button type="button" disabled={current.busy||dirty} onClick={activate}>{run.kind==='native'?(draft.bulk.schedule==='scheduled'?'Programar en OnlyFans':'Enviar masivo en OnlyFans'):'Activar campaña'}</button><button type="button" onClick={()=>setReview(false)}>Cancelar</button></div>}
 </div>}
 </section>;
}
