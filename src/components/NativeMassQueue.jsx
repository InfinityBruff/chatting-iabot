import React,{useEffect,useRef,useState} from 'react';
export default function NativeMassQueue({client,workspace,creator,run}){
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),serial=useRef(0),lock=useRef(false);
 const scope=JSON.stringify([workspace,creator,run.id,run.queueId]);
 async function request(cancel=false){
  if(lock.current)return;lock.current=true;const turn=++serial.current;setBusy(true);setError('');
  try{
   const response=await client.functions.invoke('bruff-live',{body:{operation:cancel?'native_cancel':'native_queue',workspace_id:workspace,creator_id:creator,run_id:run.id}});
   if(response.error)throw Error('No se pudo confirmar el estado. Actualiza antes de volver a intentar una cancelación.');
   const data=response.data?.data;if(data?.id!==run.id||data.queueId!==run.queueId)throw Error('Respuesta de otra ejecución');
   if(turn===serial.current){setResult(data);if(cancel||data.state!=='queued')setConfirm(false)}
  }catch(e){if(turn===serial.current)setError(e.message)}finally{lock.current=false;if(turn===serial.current)setBusy(false)}
 }
 useEffect(()=>{++serial.current;setResult(null);setConfirm(false);request();const timer=setInterval(()=>{if(document.visibilityState==='visible')request()},30000);return()=>{++serial.current;clearInterval(timer)}},[scope]);
 const labels={queued:'Pendiente en OnlyFans',cancelled:'Cancelación confirmada',completed:'Finalizado según OnlyFans',error:'Error informado por OnlyFans',not_found:'Ya no aparece en la cola',not_cancelled:'OnlyFans no pudo cancelarlo',uncertain:'Cancelación sin confirmar'};
 return <section className="am-card" aria-label="Cola de OnlyFans"><h4>Seguimiento de OnlyFans</h4><p role="status">{result?labels[result.state]||'Estado desconocido':'Consultando cola…'}</p>{result?.date&&<p>Fecha del proveedor: {new Date(result.date).toLocaleString('es-ES')}</p>}{result?.total!=null&&<p>Total informado: {result.total} · Pendientes en la última consulta: {result.pending??'No disponible'}</p>}<p className="am-help">Actualización cada 30 segundos mientras esta pantalla está visible. Que un mensaje desaparezca de la cola no demuestra que todos los fans lo hayan recibido. Cancelar no retira mensajes ya enviados.</p>{error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>request()}>Actualizar estado</button>{run.ownerAccess&&result?.state==='queued'&&<button type="button" disabled={busy} onClick={()=>setConfirm(true)}>Cancelar envío pendiente</button>}{confirm&&<div className="am-notice"><p>¿Cancelar este masivo de esta modelo en OnlyFans? Puede estar empezando a enviarse; solo se mostrará cancelado si el proveedor lo confirma.</p><button type="button" disabled={busy} onClick={()=>request(true)}>Confirmar cancelación</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Volver</button></div>}</section>;
}
