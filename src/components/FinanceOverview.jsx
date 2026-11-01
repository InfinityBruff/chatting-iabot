import React,{useState} from 'react';
import {usePage} from './LiveWorkspace.jsx';
import {earningsCategories,historicalSum,analyticsRange,historicalRange} from '../live-analytics.js';
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(n):'No disponible';
const names={messages:'Mensajes / PPV',tips:'Propinas',subscriptions:'Suscripciones',posts:'Publicaciones',streams:'Directos',referrals:'Referidos'};
function Metric({title,value,note}){return <article><small>{title}</small><strong>{money(value)}</strong><p>{note}</p></article>}
function Sources({state}){
 const categories=earningsCategories(state.result?.data.series);
 return <>{state.busy&&<p role="status">Consultando categorías de esta modelo…</p>}{state.error&&<p role="alert">Desglose: {state.error}</p>}<div className="finance-source-grid">{Object.entries(names).map(([key,label])=>{const c=categories.find(x=>x.key===key);return <article key={key}><h5>{label}</h5><strong>{money(c?.total)}</strong><small>Total informado · Bruto: {money(c?.gross)}</small></article>})}</div>{state.result?.data.unavailableCategories?.length>0&&<p role="alert">No se pudieron consultar: {state.result.data.unavailableCategories.map(k=>names[k]||k).join(', ')}. Actualiza para reintentar; no se cuentan como cero.</p>}</>;
}
function LifetimeSources({workspace,account,range}){
 const state=usePage(workspace,account,'earnings',range);
 return <><p className="live-muted">Desde el primer mes del histórico ({range.start}) hasta {range.end}, UTC. Incluye el mes en curso.</p><button disabled={state.busy} onClick={()=>state.load()}>Actualizar desglose histórico</button><Sources state={state}/></>;
}
export default function FinanceOverview({workspace,account}){
 const [lifetime,setLifetime]=useState(false);
 const range=analyticsRange('last-month');
 const month=usePage(workspace,account,'earnings',range),history=usePage(workspace,account,'monthly',{}),balance=usePage(workspace,account,'balances',{});
 const total=earningsCategories(month.result?.data.series).find(c=>c.key==='total'),months=history.result?.data.months;
 const lifetimeRange=historicalRange(months);
 return <section className="finance-overview">
  <header><div><h3>Resumen de esta modelo</h3><p>USD · Último mes natural completo: {range.start} — {range.end} (UTC)</p></div><button disabled={month.busy||history.busy||balance.busy} onClick={()=>{month.load();history.load();balance.load()}}>Actualizar resumen</button></header>
  <div className="finance-metrics"><Metric title="Último mes · Bruto" value={total?.gross} note="Antes de deducciones, según el proveedor."/><Metric title="Último mes · Total informado" value={total?.total} note="Valor devuelto por OnlyFans para el período. No equivale al saldo disponible."/><Metric title="Todo el tiempo · Bruto" value={historicalSum(months,'gross')} note="Suma de todos los meses del histórico devuelto por OFMAPI."/><Metric title="Todo el tiempo · Neto" value={historicalSum(months,'net')} note="Suma de los importes netos explícitos de cada mes; no se aplica un porcentaje estimado."/></div>
  <h4>Origen de los ingresos</h4><div className="finance-scope" role="group" aria-label="Período del desglose"><button aria-pressed={!lifetime} onClick={()=>setLifetime(false)}>Último mes completo</button><button aria-pressed={lifetime} disabled={!lifetimeRange} onClick={()=>setLifetime(true)}>Todo el tiempo</button></div>
  {lifetime&&lifetimeRange?<LifetimeSources key={workspace+account+JSON.stringify(lifetimeRange)} workspace={workspace} account={account} range={lifetimeRange}/>:<Sources state={month}/>}
  <p className="live-muted">Cada categoría se consulta por separado para esta modelo. Una ausencia significa «No disponible», no cero. No se suman categorías para reconstruir el total.</p>
  <h4>Saldos actuales</h4><div className="finance-metrics"><Metric title="Saldo actual" value={balance.result?.data.currentBalance} note="Fotografía actual de la cuenta; no es una ganancia del período."/><Metric title="Saldo pendiente" value={balance.result?.data.pendingBalance} note="Importe pendiente informado por OnlyFans."/><Metric title="Disponible para retirar" value={balance.result?.data.availableToPayout} note="Saldo que el proveedor identifica como retirable."/></div>
  {[history,balance].some(x=>x.busy)&&<p role="status">Consultando histórico y saldos…</p>}{[['Histórico',history],['Saldos',balance]].map(([label,state])=>state.error&&<p role="alert" key={label}>{label}: {state.error}</p>)}
  <details className="finance-history"><summary>Histórico mensual · {months?.length??'—'} meses del proveedor</summary><p>Incluye todos los meses devueltos por el proveedor. El mes actual puede estar incompleto. Si un importe falta o un mes se repite, no se presenta la suma como total histórico.</p><div className="live-table"><table><thead><tr><th>Mes</th><th>Bruto</th><th>Neto</th></tr></thead><tbody>{months?.map((m,i)=><tr key={i}><td>{m.label||'Fecha no disponible'}</td><td>{money(m.gross)}</td><td>{money(m.net)}</td></tr>)}</tbody></table></div></details>
  <small>Histórico consultado: {history.result?.observedAt?new Date(history.result.observedAt).toLocaleString('es-ES'):'Pendiente de respuesta'}. Los saldos y los gráficos pueden actualizarse en momentos distintos.</small>
 </section>;
}
