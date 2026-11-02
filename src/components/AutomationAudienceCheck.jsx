import React,{useEffect,useRef,useState} from 'react';
const empty={busy:false,result:null,error:'',resumeAt:0};
export default function AutomationAudienceCheck({client,workspace,creator,draft,dirty,cloud}){
 const [state,setState]=useState(empty),[clock,setClock]=useState(Date.now()),serial=useRef(0);
 useEffect(()=>{++serial.current;setState(empty);return()=>{++serial.current}},[workspace,creator,draft.id,draft.version,dirty]);
 const check=async()=>{
  if(dirty||!draft.id||!cloud||state.busy)return;
  const turn=++serial.current;setState({...empty,busy:true});
  try{
   const {data,error}=await client.functions.invoke('bruff-live',{body:{operation:'automation_audience',workspace_id:workspace,creator_id:creator,draft_id:draft.id,expected_version:draft.version}});
   if(error){
    let detail;try{detail=await error.context.json()}catch{}
    if(detail?.resumable===true&&Number.isInteger(detail.retryAfter)&&detail.retryAfter>=1&&detail.retryAfter<=86400){
     if(turn===serial.current){setClock(Date.now());setState({...empty,resumeAt:Date.now()+detail.retryAfter*1000})}return;
    }
    throw Error(detail?.error||'No se pudo completar la comprobación. No se utilizará una audiencia parcial.');
   }
   const result=data?.data;
   if(result?.complete!==true||result.creatorId!==creator||result.draftId!==draft.id||result.draftVersion!==draft.version||result.activated!==false||!Number.isSafeInteger(result.count))throw Error('La comprobación no corresponde a este borrador.');
   if(turn===serial.current)setState({...empty,result});
  }catch(e){if(turn===serial.current)setState({...empty,error:e.message})}
 };
 useEffect(()=>{
  if(!state.resumeAt)return;
  const timer=setInterval(()=>{const now=Date.now();setClock(now);if(now>=state.resumeAt){clearInterval(timer);check()}},1000);
  return()=>clearInterval(timer);
 },[state.resumeAt,workspace,creator,draft.id,draft.version,dirty,cloud]);
 const running=state.busy||state.resumeAt>0;
 const stop=()=>{++serial.current;setState({...empty,error:'Comprobación detenida. El avance ya guardado se conserva temporalmente para reanudar.'})};
 return <section className="am-card" aria-label="Comprobación real de destinatarios">
  <h3>Comprobar destinatarios</h3>
  <p className="am-help">Consulta OnlyFans mediante OFMAPI y aplica las colecciones excluidas. El avance se guarda en la nube y continúa por páginas respetando las esperas del proveedor. No activa la campaña ni envía mensajes.</p>
  <button type="button" className="am-primary" disabled={!draft.id||dirty||!cloud||running} onClick={check}>{running?'Comprobación en curso…':'Comprobar audiencia guardada'}</button>
  {running&&<button type="button" className="am-secondary" onClick={stop}>Detener comprobación</button>}
  {state.resumeAt>0&&<p role="status" className="am-help">Avance conservado · Continuará automáticamente en {Math.max(0,Math.ceil((state.resumeAt-clock)/1000))} s. Puedes detenerlo y reanudar después.</p>}
  {state.busy&&<p role="status" className="am-help">Consultando la siguiente página de destinatarios…</p>}
  {(!draft.id||dirty||!cloud)&&<p className="am-help">Guarda primero este borrador en la nube para comprobar su versión exacta.</p>}
  {state.error&&<p role="alert" className="am-notice">{state.error}</p>}
  {state.result&&<div role="status"><p><strong>{state.result.count.toLocaleString('es-ES')} destinatarios verificados</strong> · {state.result.excludedCount} excluidos</p><p className="am-help">Comprobado: {new Date(state.result.observedAt).toLocaleString('es-ES')}. La audiencia puede cambiar después. OnlyFans determina la elegibilidad al enviar; este resultado no garantiza la entrega.</p></div>}
 </section>;
}
