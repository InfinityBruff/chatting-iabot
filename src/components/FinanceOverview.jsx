import React,{useEffect,useRef,useState} from 'react';
import {usePage} from './LiveData.jsx';
import {earningsCategories,historicalSum,analyticsRange,historicalRange} from '../live-analytics.js';
import {financialSummarySettled,financialReadStatus} from '../finance-read-state.js';
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(n):'No disponible';
const names={messages:'Mensajes / PPV',tips:'Propinas',subscriptions:'Suscripciones',posts:'Publicaciones',streams:'Directos',referrals:'Referidos'};
function Metric({title,value,note}){return <article><small>{title}</small><strong>{money(value)}</strong><p>{note}</p></article>}
function ReadStatus({state}){const status=financialReadStatus(state);return status?<small role={status.role}>{status.text}</small>:null}
function SourceCard({category,label,state}){
 const value=earningsCategories(state.result?.data.series).find(row=>row.key===category);
 return <article><h5>{label}</h5><strong>{money(value?.total)}</strong><small>Total informado · Bruto: {money(value?.gross)}</small><ReadStatus state={state}/></article>;
}
function CategorySource({workspace,account,range,category,label,refresh}){
 const state=usePage(workspace,account,'earnings',{...range,category}),previous=useRef(refresh);
 useEffect(()=>{if(previous.current!==refresh){previous.current=refresh;state.load()}},[refresh,state.load]);
 return <SourceCard category={category} label={label} state={state}/>;
}
function Sources({workspace,account,range,enabled,refresh}){
 return <div className="finance-source-grid">{Object.entries(names).map(([category,label])=>enabled?<CategorySource key={category} {...{workspace,account,range,category,label,refresh}}/>:<article key={category}><h5>{label}</h5><strong>No disponible</strong><small role="status">Preparando el resumen de esta modelo…</small></article>)}</div>;
}
function LifetimeSources({workspace,account,range,enabled,refresh}){
 const [ownRefresh,setOwnRefresh]=useState(0);
 return <><p className="live-muted">Desde el primer mes del histórico ({range.start}) hasta {range.end}, UTC. Incluye el mes en curso.</p><button onClick={()=>setOwnRefresh(value=>value+1)}>Actualizar desglose histórico</button><Sources {...{workspace,account,range,enabled}} refresh={refresh+':'+ownRefresh}/></>;
}
export default function FinanceOverview({workspace,account}){
 const [lifetime,setLifetime]=useState(false),[refresh,setRefresh]=useState(0),[readyScope,setReadyScope]=useState(null);
 const range=analyticsRange('last-month');
 const month=usePage(workspace,account,'earnings',{...range,category:'total'}),history=usePage(workspace,account,'monthly',{}),balance=usePage(workspace,account,'balances',{});
 const scope=JSON.stringify([workspace,account,range]),settled=financialSummarySettled([month,history,balance]);
 useEffect(()=>{if(settled)setReadyScope(scope)},[settled,scope]);
 const enabled=readyScope===scope;
 const total=earningsCategories(month.result?.data.series).find(c=>c.key==='total'),months=history.result?.data.months;
 const lifetimeRange=historicalRange(months);
 return <section className="finance-overview">
  <header><div><h3>Resumen de esta modelo</h3><p>USD · Último mes natural completo: {range.start} — {range.end} (UTC)</p></div><button disabled={month.busy||history.busy||balance.busy} onClick={()=>{month.load();history.load();balance.load();setRefresh(value=>value+1)}}>Actualizar resumen</button></header>
  <div className="finance-metrics"><Metric title="Último mes · Bruto" value={total?.gross} note="Antes de deducciones, según el proveedor."/><Metric title="Último mes · Total informado" value={total?.total} note="Valor devuelto por OnlyFans para el período. No equivale al saldo disponible."/><Metric title="Todo el tiempo · Bruto" value={historicalSum(months,'gross')} note="Suma de todos los meses del histórico devuelto por OFMAPI."/><Metric title="Todo el tiempo · Neto" value={historicalSum(months,'net')} note="Suma de los importes netos explícitos de cada mes; no se aplica un porcentaje estimado."/></div>
  <ReadStatus state={month}/>
  <h4>Origen de los ingresos</h4><div className="finance-scope" role="group" aria-label="Período del desglose"><button aria-pressed={!lifetime} onClick={()=>setLifetime(false)}>Último mes completo</button><button aria-pressed={lifetime} disabled={!lifetimeRange} onClick={()=>setLifetime(true)}>Todo el tiempo</button></div>
  {lifetime&&lifetimeRange?<LifetimeSources key={scope+JSON.stringify(lifetimeRange)} workspace={workspace} account={account} range={lifetimeRange} enabled={enabled} refresh={refresh}/>:<Sources key={scope} {...{workspace,account,range,enabled,refresh}}/>}
  <p className="live-muted">Cada categoría se consulta por separado para esta modelo. Una ausencia significa «No disponible», no cero. No se suman categorías para reconstruir el total.</p>
  <h4>Saldos actuales</h4><div className="finance-metrics"><Metric title="Saldo actual" value={balance.result?.data.currentBalance} note="Fotografía actual de la cuenta; no es una ganancia del período."/><Metric title="Saldo pendiente" value={balance.result?.data.pendingBalance} note="Importe pendiente informado por OnlyFans."/><Metric title="Disponible para retirar" value={balance.result?.data.availableToPayout} note="Saldo que el proveedor identifica como retirable."/></div>
  {[['Histórico',history],['Saldos',balance]].map(([label,state])=>financialReadStatus(state)&&<p key={label}>{label}: <ReadStatus state={state}/></p>)}
  <details className="finance-history"><summary>Histórico mensual · {months?.length??'—'} meses del proveedor</summary><p>Incluye todos los meses devueltos por el proveedor. El mes actual puede estar incompleto. Si un importe falta o un mes se repite, no se presenta la suma como total histórico.</p><div className="live-table"><table><thead><tr><th>Mes</th><th>Bruto</th><th>Neto</th></tr></thead><tbody>{months?.map((m,i)=><tr key={i}><td>{m.label||'Fecha no disponible'}</td><td>{money(m.gross)}</td><td>{money(m.net)}</td></tr>)}</tbody></table></div></details>
  <small>Histórico consultado: {history.result?.observedAt?new Date(history.result.observedAt).toLocaleString('es-ES'):'Pendiente de respuesta'}. Los saldos y los gráficos pueden actualizarse en momentos distintos.</small>
 </section>;
}
