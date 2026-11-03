const Automations=React.lazy(()=>import('./Automations.jsx'));
const AutoMessages=React.lazy(()=>import('./AutoMessages.jsx'));
import {PanelLayout} from './PanelResize.jsx';
import {FanDirectory} from './FanDirectory.jsx';
import {useNotifications,NotificationToasts,NotificationsPage,CollectionsPage} from './Community.jsx';
import {readSession,writeSession,sessionKey} from '../chat-sync.js';
import {ModelProfiles,ModelSelect} from './ModelIdentity.jsx';
import usePresence from './usePresence.js';
import {useInboxWarmup} from './useInboxWarmup.js';
import Brand from './Brand.jsx';
import FinanceOverview from './FinanceOverview.jsx';
import EarningsChart from './EarningsChart.jsx';
import WorkspaceNavigation,{WorkspaceIcon} from './WorkspaceNavigation.jsx';
import {AccountsPage,BotPage,RolesPage} from './WorkspacePages.jsx';
const LiveTeam=React.lazy(()=>import('./LiveTeam.jsx'));
import {navigationSections,resolveSection,sectionAccount} from '../workspace-navigation.js';
import {teamRoles} from '../team.js';
import {LiveVault} from './LiveMedia.jsx';
import LiveInbox from './LiveInbox.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {authClient} from '../auth.js';
import './live.css';
import './enterprise.css';
import {analyticsRange,earningsCategories} from '../live-analytics.js';
import {liveRequest,usePage,More} from './LiveData.jsx';
export {liveRequest,usePage,More} from './LiveData.jsx';
const money=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(n):'No disponible';
const date=d=>d&&!Number.isNaN(Date.parse(d))?new Date(d).toLocaleString('es-ES'):'Fecha no disponible';
function Transactions({workspace,account,start,end}){
 const {result,error,busy,load}=usePage(workspace,account,'transactions',{start,end},'transactions');
 const rows=(result?.data.transactions||[]).filter(x=>x.createdAt&&Date.parse(x.createdAt)>=Date.parse(start+'T00:00:00Z')&&Date.parse(x.createdAt)<=Date.parse(end+'T23:59:59.999Z'));
 const sum=key=>rows.length&&rows.every(x=>typeof x[key]==='number')?rows.reduce((n,x)=>n+x[key],0):null;
 return <><div className="live-kpis"><article><small>Importe · movimientos cargados</small><strong>{money(sum('amount'))}</strong></article><article><small>Neto · movimientos cargados</small><strong>{money(sum('netAmount'))}</strong></article><article><small>Movimientos del período cargados</small><strong>{rows.length}</strong></article></div><p className="live-muted">USD · Intervalo UTC · Los subtotales incluyen solo las páginas cargadas, no representan el total de la cuenta. No se calculan comisiones ni deducciones estimadas.</p>{error&&<p role="alert">{error}</p>}{busy&&<p role="status">Consultando movimientos…</p>}<div className="live-table"><table><thead><tr><th>Fecha</th><th>Fan</th><th>Concepto</th><th>Importe</th><th>Comisión OF</th><th>Neto</th><th>Estado</th></tr></thead><tbody>{rows.map((x,i)=><tr key={x.id??i}><td>{date(x.createdAt)}</td><td>{x.user?.name||x.user?.username||'No disponible'}</td><td>{({tip:'Propina',message:'Mensaje',post:'Publicación',new_subscription:'Suscripción',recurring_subscription:'Renovación',stream:'Directo'})[x.type]||x.type||'No disponible'}</td><td>{money(x.amount)}</td><td>{money(x.fee)}</td><td>{money(x.netAmount)}</td><td>{({loading:'Pendiente',done:'Completado'})[x.status]||x.status||'No disponible'}</td></tr>)}</tbody></table></div>{result&&!rows.length&&<p>No hay movimientos del intervalo en las páginas cargadas.</p>}<More page={result?.data} busy={busy} load={load}/></>
}
function Series({workspace,account,start,end}){
 const {result,error,busy}=usePage(workspace,account,'earnings',{start,end});
 const categories=earningsCategories(result?.data.series);
 const names={total:'Total',tips:'Propinas',messages:'Mensajes',subscriptions:'Suscripciones',posts:'Publicaciones',streams:'Directos'};
 return <section className="live-series"><h3>Ingresos del período · OnlyFans</h3><p className="live-muted">USD · Importes del intervalo completo devueltos por el proveedor, independientes de las páginas de movimientos. Las categorías pueden solaparse y no se suman entre sí.</p>{busy&&<p>Cargando…</p>}{error&&<p role="alert">{error}</p>}{categories.map(c=><article key={c.key}><h4>{names[c.key]||c.key}</h4><div className="live-kpis"><article><small>Bruto informado</small><strong>{money(c.gross)}</strong></article><article><small>Total informado por OnlyFans</small><strong>{money(c.total)}</strong></article></div>{c.points.length>0&&<EarningsChart points={c.points} title={names[c.key]||c.key}/>}<p className="metric-definition">Bruto: importe bruto informado. Total: valor informado por el proveedor; no se interpreta como neto ni como saldo disponible.</p>{c.points.length>0&&<details><summary>Evolución · {c.points.length} puntos</summary><div className="live-table"><table><thead><tr><th>Fecha / punto del proveedor</th><th>Importe USD</th><th>Operaciones</th></tr></thead><tbody>{c.points.map((p,i)=><tr key={i}><td>{p.label}</td><td>{money(p.amount)}</td><td>{p.operations??'No disponible'}</td></tr>)}</tbody></table></div></details>}</article>)}{result&&!categories.length&&<p>El proveedor no devolvió una serie de importes reconocible. Consulta los movimientos; no se estiman totales.</p>}</section>;

}
function Analytics({workspace,account,accounts,onAccount,overview=false}){
 const today=new Date().toISOString().slice(0,10);const [dates,setDates]=useState(()=>analyticsRange('last-month'));const [applied,setApplied]=useState(dates);
 return <section><div className="analytics-model-card"><div><h2>Analíticas · Datos reales</h2><p>Selecciona la modelo. Todos los importes y gráficos pertenecen exclusivamente a esa cuenta.</p></div><label>Modelo de las estadísticas<ModelSelect label="Modelo de las estadísticas" value={account} onChange={onAccount} accounts={accounts.filter(a=>a.analytics)}/></label></div>{overview?<FinanceOverview workspace={workspace} account={account}/>:<><h3>Explorar un período</h3><div className="analytics-presets">{[["last-month","Último mes completo"],["30days","Últimos 30 días"],["month","Este mes"]].map(([preset,label])=><button key={preset} onClick={()=>{const range=analyticsRange(preset);setDates(range);setApplied(range)}}>{label}</button>)}</div><form className="live-search" onSubmit={e=>{e.preventDefault();setApplied({...dates})}}><label>Desde<input type="date" required value={dates.start} max={dates.end} onChange={e=>setDates({...dates,start:e.target.value})}/></label><label>Hasta<input type="date" required value={dates.end} min={dates.start} max={today} onChange={e=>setDates({...dates,end:e.target.value})}/></label><button>Consultar</button></form><div className="analytics-explainer"><strong>Cómo leer tus resultados</strong><p>El resumen del proveedor corresponde al período consultado en UTC. Debajo puedes auditar los movimientos cargados: importe, comisión y neto son campos distintos; no rellenamos cifras que falten.</p></div><Series key={'series'+JSON.stringify(applied)} workspace={workspace} account={account} {...applied}/><h3>Detalle de movimientos</h3><p className="live-muted">Carga más páginas para ampliar los subtotales. Neto es lo que informa cada movimiento tras sus deducciones; no equivale a saldo retirable.</p><Transactions key={JSON.stringify(applied)} workspace={workspace} account={account} {...applied}/></>}</section>
}
export default function LiveWorkspace({workspace,onBack,currentUserId}){
 const automationDirty=useRef(false);
 const reportAutomationDirty=React.useCallback(value=>{automationDirty.current=value},[]);
 const allowNavigation=()=>!automationDirty.current||window.confirm('Tienes cambios sin guardar en esta campaña. ¿Quieres salir y descartarlos?');
 const chooseModel=id=>{if(allowNavigation())setSelected(id)};
 const viewKey=sessionKey(currentUserId,workspace.id);
 const saved=useRef(readSession(viewKey,{}));
 const [accounts,setAccounts]=useState(null),[selected,setSelected]=useState(saved.current?.account||''),[tab,setTab]=useState(saved.current?.tab||'chat'),[collapsed,setCollapsed]=useState(saved.current?.collapsed??false),[writeEnabled,setWriteEnabled]=useState(false),[chatBlocked,setChatBlocked]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true,inflight=false;async function check(){if(inflight)return;inflight=true;try{const r=await liveRequest(workspace.id,'accounts');if(active){setAccounts(previous=>JSON.stringify(previous)===JSON.stringify(r.accounts)?previous:r.accounts);setWriteEnabled(r.writeEnabled===true);setChatBlocked(r.chatSafety?.blocked===true);setError('')}}catch(e){if(active){setAccounts(null);setError(e.message)}}finally{inflight=false}}check();const timer=setInterval(check,5000);const visible=()=>{if(document.visibilityState==='visible')check()};document.addEventListener('visibilitychange',visible);return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}},[workspace.id]);
 const available=accounts||[];
 const presence=usePresence(workspace.id,available,['automations','auto-messages'].includes(tab)?selected:null);
 const notifications=useNotifications(currentUserId,workspace.id,available,workspace.role);
 const sections=navigationSections(workspace.role,available),view=resolveSection(tab,workspace.role,available);
 const account=sectionAccount(view,available,selected);
 useInboxWarmup(workspace.id,available,account?.id,view==='chat');
 useEffect(()=>{if(accounts)writeSession(viewKey,{account:account?.id||selected,tab:view,collapsed})},[viewKey,accounts,account?.id,selected,view,collapsed]);
 const activeSection=sections.find(s=>s.id===view);
 const selectView=(next,id)=>{if(!allowNavigation())return;if(id)setSelected(id);setTab(next);if(window.matchMedia('(max-width: 800px)').matches)setCollapsed(true)};
 const pageKey=workspace.id+':'+(account?.id||'agency')+':'+view+':'+account?.chat+':'+account?.analytics+':'+account?.send+':'+account?.vault;
 return <PanelLayout key={viewKey} scope={viewKey}><FanDirectory user={currentUserId} workspace={workspace.id} accounts={available} role={workspace.role} section={view} activeModel={account?.id}><ModelProfiles key={workspace.id} workspace={workspace.id} accounts={available}><main className={['live-shell workspace-shell',collapsed?'workspace-collapsed':'',view==='chat'?'live-chat-shell':''].join(' ')}>
  <WorkspaceNavigation unread={notifications.count} sections={sections} active={view} onSelect={selectView} collapsed={collapsed} onBack={()=>{if(allowNavigation())onBack()}} workspace={workspace}/>
  <div className="live-main workspace-main">
   <header className="workspace-topbar"><button aria-label={collapsed?'Expandir menú':'Contraer menú'} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}><WorkspaceIcon name="menu"/></button><Brand/><div className="workspace-breadcrumb"><span>{activeSection?.group}</span><b>/</b><strong>{activeSection?.label}</strong></div><span className="workspace-user">{teamRoles[workspace.role]}<span className="workspace-user-avatar">{workspace.name?.slice(0,1)||'B'}</span></span></header>
   {error&&<p role="alert">{error}</p>}{!accounts&&!error&&<p role="status">Verificando acceso a las modelos…</p>}
   {accounts&&<React.Suspense fallback={<div className="workspace-loading" role="status"><div className="bruff-loading-orbit"/>Cargando espacio…</div>}><div key={pageKey} className={'live-content workspace-content '+(view==='chat'?'workspace-chat-content':'')}>
    {account&&['vault','bot','collections'].includes(view)&&<div className="workspace-context-bar"><span className="workspace-provider">OnlyFans</span><label>Modelo<ModelSelect label="Modelo activa" value={account.id} onChange={setSelected} accounts={available.filter(a=>a[activeSection.permission])}/></label><small>{view==='bot'?'Preferencias guardadas · motor pendiente':'Datos reales · Acceso por modelo'}</small></div>}
    {view==='notifications'&&<NotificationsPage workspace={workspace.id} feed={notifications} accounts={available} onChat={(model,fan)=>{writeSession(sessionKey(currentUserId,workspace.id,model,'','fan'),fan);selectView('chat',model)}}/>}
    {account&&view==='collections'&&<CollectionsPage workspace={workspace.id} account={account.id} enabled={writeEnabled}/>}
    {view==='accounts'&&<AccountsPage accounts={available} onOpen={selectView}/>}
    {view==='team'&&<LiveTeam workspace={workspace} currentUserId={currentUserId}/>}
    {view==='roles'&&<RolesPage onTeam={()=>setTab('team')}/>}
    {account&&view==='auto-messages'&&<AutoMessages key={currentUserId+workspace.id+account.id} user={currentUserId} workspace={workspace.id} account={account} accounts={available} onAccount={chooseModel} onDirtyChange={reportAutomationDirty} presence={presence[account.id]}/>}
    {account&&view==='mass-messages'&&<AutoMessages massOnly key={currentUserId+workspace.id+account.id} user={currentUserId} workspace={workspace.id} account={account} accounts={available} onAccount={chooseModel} onDirtyChange={reportAutomationDirty} presence={presence[account.id]}/>}
    {account&&view==='automations'&&<Automations key={currentUserId+workspace.id+account.id} user={currentUserId} workspace={workspace.id} account={account} accounts={available} onAccount={chooseModel} onDirtyChange={reportAutomationDirty} presence={presence[account.id]}/>}
    {account&&view==='bot'&&<BotPage workspace={workspace.id} account={account} onChat={()=>setTab('chat')}/>}
    {account&&view==='chat'&&<LiveInbox currentUserId={currentUserId} presence={presence[account.id]} workspace={workspace.id} account={account.id} accounts={available} onAccount={setSelected} canSend={account.send} canVault={account.vault} enabled={writeEnabled} blocked={chatBlocked}/>}
    {account&&view==='vault'&&<LiveVault workspace={workspace.id} account={account.id}/>}
    {account&&['dashboard','analytics'].includes(view)&&<Analytics workspace={workspace.id} account={account.id} accounts={available} onAccount={setSelected} overview={view==='dashboard'}/>}
   </div></React.Suspense>}
  </div>
 <NotificationToasts feed={notifications} accounts={available} onOpen={selectView}/>
 </main></ModelProfiles></FanDirectory></PanelLayout>
}
