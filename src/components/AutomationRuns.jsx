import React,{useEffect,useRef,useState} from 'react';
const labels={active:'Activa / programada',paused:'Pausada',stopped:'Detenida',completed:'Completada'};
export default function AutomationRuns({client,workspace,creator,draftId}){
 const scope=JSON.stringify([workspace,creator,draftId||null]),serial=useRef(0),mounted=useRef(false),busy=useRef(false);
 const [state,setState]=useState({scope,runs:[],loading:true,error:'',notice:''}),[review,setReview]=useState(null);
 const refresh=async()=>{
  if(busy.current)return;const turn=++serial.current;
  try{const {data,error}=await client.rpc('bruff_advanced_runs',{w:workspace,c:creator,op:'list'});if(error)throw error;
   if(!Array.isArray(data?.runs)||data.runs.some(r=>!labels[r.state]||!Number.isInteger(r.revision)))throw Error('Respuesta de ejecución incompleta');
   if(mounted.current&&turn===serial.current)setState(s=>({...s,scope,runs:data.runs,loading:false,error:''}));
  }catch(e){if(mounted.current&&turn===serial.current)setState({scope,runs:[],loading:false,error:e.code==='PGRST202'?'Controles pendientes de instalación.':e.message||'No se pudieron consultar las ejecuciones.',notice:''})}
 };
 useEffect(()=>{mounted.current=true;setState({scope,runs:[],loading:true,error:'',notice:''});setReview(null);refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},5000);return()=>{mounted.current=false;++serial.current;clearInterval(timer)}},[scope,client]);
 const change=async(run,op)=>{
  if(busy.current||state.scope!==scope)return;busy.current=true;const turn=++serial.current;setReview(null);setState(s=>({...s,loading:true,error:'',notice:''}));
  try{const {data,error}=await client.rpc('bruff_advanced_runs',{w:workspace,c:creator,op,run_id:run.id,expected_revision:run.revision});if(error)throw error;
   if(data?.id!==run.id||!labels[data.state])throw Error('No se confirmó el cambio de estado');
   if(mounted.current&&turn===serial.current)setState(s=>({...s,runs:s.runs.map(r=>r.id===data.id?{...r,state:data.state,revision:data.revision}:r),notice:labels[data.state]+'. '+(data.inFlight?'Hay una entrega ya iniciada; su resultado se conservará sin reenviarla.':'El estado se aplica antes de iniciar nuevas entregas.')}));
  }catch(e){if(mounted.current&&turn===serial.current)setState(s=>({...s,error:e.message||'No se pudo cambiar la ejecución.'}))}
  finally{busy.current=false;if(mounted.current&&turn===serial.current){setState(s=>({...s,loading:false}));refresh()}}
 };
 const current=state.scope===scope?state:{runs:[],loading:true,error:'',notice:''},runs=current.runs.filter(r=>!draftId||r.draftId===draftId);
 return <section className="am-card" aria-label="Ejecuciones en la nube"><h3>Ejecuciones en la nube</h3><p className="am-help">Estado real por modelo. Pausar impide nuevas entregas; una petición ya enviada al proveedor puede terminar. Detener es definitivo para esa ejecución.</p>
 {current.loading&&<p role="status">Consultando estado…</p>}{current.error&&<p role="alert" className="am-notice">{current.error}</p>}{current.notice&&<p role="status">{current.notice}</p>}
 {!current.loading&&!current.error&&!runs.length&&<p className="am-help">No hay ejecuciones para esta {draftId?'campaña':'modelo'}. Guardar borradores no activa envíos. La activación sigue pendiente del ejecutor conectado.</p>}
 {runs.map(run=><article className="am-message-card" key={run.id}><header><strong>{labels[run.state]}</strong><small>Revisión {run.revision}</small></header><p className="am-help">Inicio: {run.startsAt?new Date(run.startsAt).toLocaleString('es-ES'):'Sin activar'} · Final: {new Date(run.endsAt).toLocaleString('es-ES')}</p><p>Pendientes: <b>{run.counts.pending}</b> · En curso: <b>{run.counts.sending}</b> · Enviados: <b>{run.counts.sent}</b> · Por revisar: <b>{run.counts.uncertain}</b> · Bloqueados: <b>{run.counts.blocked}</b></p><div className="am-row-actions">{run.state==='active'&&<button disabled={current.loading} onClick={()=>change(run,'pause')}>Pausar</button>}{run.state==='paused'&&<button disabled={current.loading} onClick={()=>setReview({run,op:'resume'})}>Continuar</button>}{['active','paused'].includes(run.state)&&<button disabled={current.loading} onClick={()=>setReview({run,op:'stop'})}>Detener ejecución</button>}</div></article>)}
 {review&&<div role="group" aria-label="Revisar cambio de ejecución" className="am-notice"><p>{review.op==='resume'?'Continuar permitirá procesar las entregas pendientes dentro del horario original, si el ejecutor está disponible.':'Detener cancelará las entregas que no hayan comenzado. Las ya enviadas no se retiran y esta ejecución no podrá reanudarse.'}</p><button disabled={current.loading} onClick={()=>change(review.run,review.op)}>Confirmar {review.op==='resume'?'continuación':'detención'}</button><button onClick={()=>setReview(null)}>Cancelar</button></div>}
 </section>;
}
