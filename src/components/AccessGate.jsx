import React, {useEffect,useRef,useState} from 'react';
import {authClient,loadMemberships} from '../auth.js';
import App from '../App.jsx';
import LiveWorkspace from './LiveWorkspace.jsx';
import PasswordAccess, {hasAuthLink} from './PasswordAccess.jsx';
import './access.css';
import LiveTeam from './LiveTeam.jsx';
import MyDisplayName from './MyDisplayName.jsx';
import {teamRoles as roles} from '../team.js';

export default function AccessGate(){
 const [demo,setDemo]=useState(false),[session,setSession]=useState(null),[workspaces,setWorkspaces]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [flow,setFlow]=useState(hasAuthLink?'link':null);
 const [teamWorkspace,setTeamWorkspace]=useState(null);
 const [liveWorkspace,setLiveWorkspace]=useState(null);
 const generation=useRef(0);
 useEffect(()=>{const {data}=authClient.auth.onAuthStateChange((_event,next)=>{generation.current++;setSession(next);setWorkspaces(null);setError('');});return ()=>data.subscription.unsubscribe();},[]);
 useEffect(()=>{
  if(!session||flow)return;
  let active=true,inflight=false;const gen=generation.current;
  async function check(){if(inflight)return;inflight=true;try{const rows=await loadMemberships();if(active&&gen===generation.current){setWorkspaces(rows);setError('');}}catch(e){if(active&&gen===generation.current){setWorkspaces(null);setError(e.message)}}finally{inflight=false}}
  check();const timer=setInterval(check,5000);const onVisible=()=>{if(document.visibilityState==='visible')check()};document.addEventListener('visibilitychange',onVisible);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible)};
 },[session,flow]);
 async function login(event){event.preventDefault();setBusy(true);setError('');const form=event.currentTarget;const email=form.elements.email.value.trim(),password=form.elements.password.value;try{const {error}=await authClient.auth.signInWithPassword({email,password});if(error)setError('No se pudo iniciar sesión. Comprueba el correo y la contraseña o inténtalo más tarde.');}catch{setError('No se pudo conectar con el servicio de acceso.');}finally{form.elements.password.value='';setBusy(false)}}
 async function logout(){setBusy(true);setError('');try{const {error}=await authClient.auth.signOut({scope:'local'});if(error)throw error;setSession(null);setWorkspaces(null);}catch{setError('No se pudo cerrar la sesión. Inténtalo de nuevo.');}finally{setBusy(false)}}
 if(flow)return <main className="access-page"><section className="access-card"><div className="access-brand">B<span>BRUFF WORKSPACE</span></div><PasswordAccess mode={flow} onClose={()=>{setSession(null);setWorkspaces(null);setError('');setFlow(null)}}/></section></main>;
 const live=workspaces?.find(w=>w.id===liveWorkspace);
 if(session&&live&&!flow)return <LiveWorkspace key={session.user.id+live.id} workspace={live} onBack={()=>setLiveWorkspace(null)}/>;
 if(demo)return <><div className="demo-access-bar"><span>DEMOSTRACIÓN · Datos ficticios, separada de tu cuenta real</span><button onClick={()=>setDemo(false)}>Volver al acceso</button></div><App/></>;
 return <main className="access-page"><section className="access-card"><div className="access-brand">B<span>BRUFF WORKSPACE</span></div><p className="access-eyebrow">TU ESPACIO DE TRABAJO</p><h1>{session?'Tu acceso a BRUFF':'Bienvenido a BRUFF'}</h1>
 {!session?<><p>Entra con tu correo y contraseña de BRUFF.</p><form onSubmit={login}><label htmlFor="login-email">Correo electrónico</label><input id="login-email" name="email" type="email" autoComplete="username" required disabled={busy}/><label htmlFor="login-password">Contraseña</label><input id="login-password" name="password" type="password" autoComplete="current-password" required disabled={busy}/><button className="access-primary" disabled={busy}>{busy?'Comprobando…':'Iniciar sesión'}</button></form><button onClick={()=>setFlow('request')} disabled={busy}>He olvidado mi contraseña</button><p className="access-muted">Acceso por invitación. Solicita tu incorporación al propietario.</p></>:<><p>{session.user.email}</p>{workspaces===null&&!error&&<p role="status">Verificando tus permisos…</p>}{workspaces?.length===0&&<p>No tienes ninguna agencia activa asignada. Contacta con el propietario.</p>}{workspaces?.map(w=><article className="access-workspace" key={w.id}><h2>{w.name}</h2><MyDisplayName workspaceId={w.id} userId={session.user.id}/><p>{roles[w.role]} · Acceso verificado</p><p>BRUFF: {w.globally_paused?'pausa global activada':'sin pausa global'}</p>{['owner','admin'].includes(w.role)&&<button onClick={()=>setTeamWorkspace(teamWorkspace===w.id?null:w.id)}>{teamWorkspace===w.id?'Cerrar Equipo':'Equipo · Personas y permisos'}</button>}<button onClick={()=>setLiveWorkspace(w.id)}>Abrir modelos · Chats y analíticas reales</button><p className="access-muted">Conexión OFMAPI de solo lectura. La demostración sigue separada de tus datos reales.</p>{['owner','admin'].includes(w.role)&&teamWorkspace===w.id&&<LiveTeam key={session.user.id+':'+w.id} workspace={w} currentUserId={session.user.id}/>}</article>)}<button onClick={logout} disabled={busy}>Cerrar sesión</button></>}
 {error&&<p role="alert" className="access-error">{error}</p>}<div className="access-divider"/><button className="access-demo" onClick={()=>setDemo(true)} disabled={busy||!!session}>Explorar la demostración</button><p className="access-muted">La sesión se conserva solo en esta pestaña hasta recargarla. Utiliza tu cuenta propia de BRUFF. Los permisos se comprueban en el servidor.</p></section></main>
}
