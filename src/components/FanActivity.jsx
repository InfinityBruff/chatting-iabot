import React,{useEffect,useRef,useState} from 'react';
import {liveRequest} from './LiveWorkspace.jsx';
import {mergeActivity,activityStats} from '../fan-activity.js';
const money=n=>typeof n==='number'?new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(n):'—';
const labels={message:'Mensaje / PPV',post:'Publicación',tip:'Propina',new_subscription:'Alta',recurring_subscription:'Renovación',stream:'Directo',other:'Otro movimiento'};
function ActivityGroup({title,rows,ready,partial}){
 const stat=activityStats(rows),max=stat.max||1;
 return <details className="fan-activity-group" open><summary>{title}<span>{ready?stat.count:'—'}</span></summary><div className="fan-mini-stats"><div><small>{partial?'Subtotal cargado':'Importe del período'}</small><b>{ready?money(stat.total):'—'}</b></div><div><small>Media</small><b>{money(stat.average)}</b></div><div><small>Mayor</small><b>{money(stat.max)}</b></div></div>{rows.length?<ol className="fan-record-timeline">{rows.map(r=><li key={r.id}><strong>{labels[r.type]}</strong><b>{money(r.amount)}</b><time>{new Date(r.createdAt).toLocaleString('es-ES',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time><small>{r.status==='done'?'Completado':r.status==='loading'?'Pendiente':r.status||'Estado no disponible'}</small><span className="fan-amount-track" aria-hidden="true"><i style={{width:(r.amount==null?0:Math.min(100,r.amount/max*100))+'%'}}/></span></li>)}</ol>:<p>{!ready?'Consultando movimientos…':partial?'Todavía no hay registros de este fan en las páginas consultadas.':'Sin movimientos de este tipo en el período consultado.'}</p>}</details>
}
export default function FanActivity({workspace,account,fan}){
 const [period,setPeriod]=useState('30'),[revision,setRevision]=useState(0);
 const [state,setState]=useState({rows:[],busy:true,pages:0}),scope=JSON.stringify([workspace,account,fan,period,revision]);
 const resume=useRef(null);
 useEffect(()=>{
  let active=true,running=false,timer,failures=0,cursor=null,seen=new Set(),rows=[],pages=0,complete=false,unidentified=false,fullAt=0,cycleRows=[];
  const start=period==='all'?'2016-01-01':new Date(Date.now()-Number(period)*86400000).toISOString().slice(0,10);
  setState({scope,rows:[],busy:true,pages:0,start});
  async function tick(){
   clearTimeout(timer);if(!active||running)return;if(document.visibilityState!=='visible'){timer=setTimeout(tick,30000);return}running=true;if(complete&&Date.now()-fullAt>=300000){complete=false;cursor=null;seen=new Set();cycleRows=[];pages=0;unidentified=false}
   setState(s=>({...s,busy:true,error:''}));
   try{const r=await liveRequest(workspace,'fan_activity',{creator_id:account,conversation_id:fan,start,...(!complete&&cursor?{cursor}:{})});if(!active)return;
    if(!r.data?.transactions)throw Error('El historial de movimientos no está disponible.');
    rows=mergeActivity(rows,r.data.transactions);if(!complete)cycleRows=mergeActivity(cycleRows,r.data.transactions);unidentified||=r.data.transactions.some(x=>!x.id);failures=0;
    if(!complete){pages++;if(r.data.hasMore){if(!r.data.cursor||seen.has(r.data.cursor))throw Error('El proveedor no permite continuar este historial.');cursor=r.data.cursor;seen.add(cursor)}else {complete=true;fullAt=Date.now();rows=cycleRows}}
    setState({scope,rows,busy:false,pages,start,complete,unidentified,updated:r.observedAt||new Date().toISOString()});
   }catch(e){if(active){failures=Math.min(failures+1,4);if(e.status===401||e.status===403)rows=[];setState(s=>({...s,rows,busy:false,error:e.message,complete:false}))}}
   finally{running=false;if(active)timer=setTimeout(tick,failures?30000*2**failures:complete?30000:1000)}
  }
  resume.current=tick;tick();const visible=()=>{if(document.visibilityState==='visible')tick()};document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);resume.current=null}
 },[scope]);
 const s=state.scope===scope?state:{rows:[],busy:true,pages:0};const ready=!!s.updated,partial=!s.complete||!!s.error||s.unidentified;
 return <section className="fan-record-section fan-activity"><header><h3>Compras y propinas</h3><button disabled={s.busy} aria-label="Actualizar movimientos del fan" onClick={()=>resume.current?.()}>↻</button></header><label>Período<select aria-label="Período del historial del fan" value={period} onChange={e=>setPeriod(e.target.value)}><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option><option value="all">Todo el historial disponible</option></select></label><small>Solo este fan y esta modelo · USD · {s.pages} páginas consultadas. {s.busy?'Actualizando…':s.complete?'Recorrido inicial completado.':'Historial parcial.'}</small>{s.updated&&<small>Última consulta: {new Date(s.updated).toLocaleTimeString('es-ES')} · Novedades cada 30 s; recorrido completo cada 5 min.</small>}{s.error&&<p role="alert">{s.error} <button onClick={()=>resume.current?.()}>Reintentar</button></p>}{s.unidentified&&<p>Hay movimientos sin ID que no se incluyen en las estadísticas para evitar duplicados.</p>}<ActivityGroup title="Compras" rows={s.rows.filter(r=>['message','post'].includes(r.type))} ready={ready} partial={partial}/><ActivityGroup title="Propinas" rows={s.rows.filter(r=>r.type==='tip')} ready={ready} partial={partial}/><ActivityGroup title="Pagos de suscripción" rows={s.rows.filter(r=>['new_subscription','recurring_subscription'].includes(r.type))} ready={ready} partial={partial}/><small>Importes informados por el proveedor, no netos. Las estadísticas corresponden a los registros identificados cargados; no sustituyen el gasto acumulado. El proveedor no vincula estos movimientos a miniaturas de contenido.</small><button disabled={s.busy} onClick={()=>setRevision(v=>v+1)}>Revisar todo el período de nuevo</button></section>
}
