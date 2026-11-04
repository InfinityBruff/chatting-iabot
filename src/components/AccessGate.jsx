import {setPageCacheOwner} from '../live-page-cache.js';
import {clearUserSession,readSession,writeSession,sessionKey} from '../chat-sync.js';
import Brand from './Brand.jsx';
import React, {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {authClient,loadMemberships} from '../auth.js';
import {canPreloadWorkspace,createWorkspaceModule} from '../workspace-module.js';
const App=lazy(()=>import('../App.jsx'));
const workspaceModule=createWorkspaceModule(()=>import('./LiveWorkspace.jsx'));
const LiveWorkspace=lazy(workspaceModule.load);
import PasswordAccess, {hasAuthLink} from './PasswordAccess.jsx';
import './access.css';
const LiveTeam=lazy(()=>import('./LiveTeam.jsx'));
import MyDisplayName from './MyDisplayName.jsx';
import {teamRoles as roles} from '../team.js';
import {startAccessReadPoll} from '../access-read-poll.js';

export default function AccessGate(){return <Suspense fallback={<main className="access-page" role="status"><section className="access-card"><Brand/><div className="bruff-loading-orbit"/><p>Abriendo tu espacio…</p></section></main>}><AccessContent/></Suspense>}
function AccessContent(){
 const [demo,setDemo]=useState(false),[session,setSession]=useState(null),[workspaces,setWorkspaces]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [flow,setFlow]=useState(hasAuthLink?'link':null);
 const [teamWorkspace,setTeamWorkspace]=useState(null);
 const [liveWorkspace,setLiveWorkspace]=useState(null);
 const generation=useRef(0);
 const autoEntered=useRef(false);
 const identity=useRef(null);
 useEffect(()=>{if(canPreloadWorkspace(session,flow))void workspaceModule.preload()},[session?.user?.id,session?.user?.email_confirmed_at,session?.access_token,flow]);
 useEffect(()=>{if(session&&liveWorkspace)writeSession(sessionKey(session.user.id,'','agency'),liveWorkspace)},[session?.user?.id,liveWorkspace]);
 useEffect(()=>{if(!session){autoEntered.current=false;setLiveWorkspace(null)}else if(!flow&&workspaces?.length&&!autoEntered.current){const saved=readSession(sessionKey(session.user.id,'','agency'));const target=workspaces.find(w=>w.id===saved)||(workspaces.length===1?workspaces[0]:null);if(target){autoEntered.current=true;setLiveWorkspace(target.id)}}},[session,flow,workspaces]);
 useEffect(()=>{const {data}=authClient.auth.onAuthStateChange((_event,next)=>{const nextId=next?.user?.id||null;if(identity.current!==nextId){if(identity.current)clearUserSession(identity.current);identity.current=nextId;setPageCacheOwner(nextId);generation.current++;autoEntered.current=false;setWorkspaces(null);setLiveWorkspace(null);setError('');}setSession(next);});return ()=>data.subscription.unsubscribe();},[]);
 useEffect(()=>{
  if(!session||flow)return;
  const gen=generation.current;
  const polling=startAccessReadPoll({read:()=>loadMemberships(),onValue:rows=>{if(gen===generation.current){setWorkspaces(rows);setError('')}},onError:e=>{if(gen===generation.current){setWorkspaces(null);setError(e.message)}}});
  const onVisible=()=>polling.resume();document.addEventListener('visibilitychange',onVisible);
  return()=>{polling.stop();document.removeEventListener('visibilitychange',onVisible)};
 },[session?.user?.id,flow]);
 async function login(event){event.preventDefault();setBusy(true);setError('');const form=event.currentTarget;const email=form.elements.email.value.trim(),password=form.elements.password.value;try{const {error}=await authClient.auth.signInWithPassword({email,password});if(error)setError('No se pudo iniciar sesión. Comprueba el correo y la contraseña o inténtalo más tarde.');}catch{setError('No se pudo conectar con el servicio de acceso.');}finally{form.elements.password.value='';setBusy(false)}}
 async function logout(){setBusy(true);setError('');try{const {error}=await authClient.auth.signOut({scope:'local'});if(error)throw error;setSession(null);setWorkspaces(null);}catch{setError('No se pudo cerrar la sesión. Inténtalo de nuevo.');}finally{setBusy(false)}}
 if(flow)return <main className="access-page"><section className="access-card"><Brand/><PasswordAccess mode={flow} onClose={()=>{setSession(null);setWorkspaces(null);setError('');setFlow(null)}}/></section></main>;
 const live=workspaces?.find(w=>w.id===liveWorkspace);
 if(session&&live&&!flow)return <LiveWorkspace key={session.user.id+live.id} workspace={live} currentUserId={session.user.id} onBack={()=>setLiveWorkspace(null)}/>;
 if(demo)return <><div className="demo-access-bar"><span>DEMOSTRACIÓN · Datos ficticios, separada de tu cuenta real</span><button onClick={()=>setDemo(false)}>Volver al acceso</button></div><App/></>;
 return <main className="access-page"><section className="access-card"><Brand/><p className="access-eyebrow">TU ESPACIO DE TRABAJO</p><h1>{session?'Tu acceso a BRUFF':'Bienvenido a BRUFF'}</h1>
 {!session?<><p>Entra con tu correo y contraseña de BRUFF.</p><form onSubmit={login}><label htmlFor="login-email">Correo electrónico</label><input id="login-email" name="email" type="email" autoComplete="username" required disabled={busy}/><label htmlFor="login-password">Contraseña</label><input id="login-password" name="password" type="password" autoComplete="current-password" required disabled={busy}/><button className="access-primary" disabled={busy}>{busy?'Comprobando…':'Iniciar sesión'}</button></form><button onClick={()=>setFlow('request')} disabled={busy}>He olvidado mi contraseña</button><p className="access-muted">Acceso por invitación. Solicita tu incorporación al propietario.</p></>:<><p>{session.user.email}</p>{workspaces===null&&!error&&<p role="status">Verificando tus permisos…</p>}{workspaces?.length===0&&<p>No tienes ninguna agencia activa asignada. Contacta con el propietario.</p>}{workspaces?.map(w=><article className="access-workspace" key={w.id}><h2>{w.name}</h2><MyDisplayName workspaceId={w.id} userId={session.user.id}/><p>{roles[w.role]} · Acceso verificado</p><p>BRUFF: {w.globally_paused?'pausa global activada':'sin pausa global'}</p>{['owner','admin'].includes(w.role)&&<button onClick={()=>setTeamWorkspace(teamWorkspace===w.id?null:w.id)}>{teamWorkspace===w.id?'Cerrar Equipo':'Equipo · Personas y permisos'}</button>}<button onClick={()=>setLiveWorkspace(w.id)}>Abrir modelos · Chats y analíticas reales</button><p className="access-muted">Cuentas conectadas por OFMAPI. Cada función respeta tus permisos por modelo.</p>{['owner','admin'].includes(w.role)&&teamWorkspace===w.id&&<LiveTeam key={session.user.id+':'+w.id} workspace={w} currentUserId={session.user.id}/>}</article>)}<button onClick={logout} disabled={busy}>Cerrar sesión</button></>}
 {error&&<p role="alert" className="access-error">{error}</p>}<div className="access-divider"/><button className="access-demo" onClick={()=>setDemo(true)} disabled={busy||!!session}>Explorar la demostración</button><p className="access-muted">La sesión se mantiene al recargar en este navegador. Cierra sesión al terminar en un dispositivo compartido. Los permisos se comprueban en el servidor.</p></section></main>
}
