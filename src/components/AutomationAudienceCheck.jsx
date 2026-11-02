import React,{useEffect,useRef,useState} from 'react';
export default function AutomationAudienceCheck({client,workspace,creator,draft,dirty,cloud}){
 const [state,setState]=useState({busy:false,result:null,error:''}),serial=useRef(0);
 useEffect(()=>{++serial.current;setState({busy:false,result:null,error:''});return()=>{++serial.current}},[workspace,creator,draft.id,draft.version,dirty]);
 const check=async()=>{
  if(dirty||!draft.id||!cloud||state.busy)return;
  const turn=++serial.current;setState({busy:true,result:null,error:''});
  try{
   const {data,error}=await client.functions.invoke('bruff-live',{body:{operation:'automation_audience',workspace_id:workspace,creator_id:creator,draft_id:draft.id,expected_version:draft.version}});
   if(error){let detail;try{detail=await error.context.json()}catch{}throw Error(detail?.error||'No se pudo completar la comprobación. No se utilizará una audiencia parcial.')}
   const result=data?.data;
   if(result?.complete!==true||result.creatorId!==creator||result.draftId!==draft.id||result.draftVersion!==draft.version||result.activated!==false||!Number.isSafeInteger(result.count))throw Error('La comprobación no corresponde a este borrador.');
   if(turn===serial.current)setState({busy:false,result,error:''});
  }catch(e){if(turn===serial.current)setState({busy:false,result:null,error:e.message})}
 };
 return <section className="am-card" aria-label="Comprobación real de destinatarios"><h3>Comprobar destinatarios</h3><p className="am-help">Consulta OnlyFans mediante OFMAPI y aplica las colecciones excluidas. No activa la campaña ni envía mensajes.</p><button type="button" className="am-primary" disabled={!draft.id||dirty||!cloud||state.busy} onClick={check}>{state.busy?'Comprobando todas las páginas…':'Comprobar audiencia guardada'}</button>{(!draft.id||dirty||!cloud)&&<p className="am-help">Guarda primero este borrador en la nube para comprobar su versión exacta.</p>}{state.error&&<p role="alert" className="am-notice">{state.error}</p>}{state.result&&<div role="status"><p><strong>{state.result.count.toLocaleString('es-ES')} destinatarios verificados</strong> · {state.result.excludedCount} excluidos</p><p className="am-help">Comprobado: {new Date(state.result.observedAt).toLocaleString('es-ES')}. La audiencia puede cambiar después. OnlyFans determina la elegibilidad al enviar; este resultado no garantiza la entrega.</p></div>}</section>;
}
