import React,{useEffect,useRef,useState} from 'react';
import {authClient} from '../auth.js';
import {authorizationId,chatgptCallback,consentDetails} from '../oauth-consent.js';
import Brand from './Brand.jsx';
import './access.css';

export default function OAuthConsent(){
 const authorization=authorizationId(window.location.search),[user,setUser]=useState(null),[details,setDetails]=useState(null),[owners,setOwners]=useState([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[checked,setChecked]=useState(false),[reload,setReload]=useState(0);
 const alive=useRef(false),generation=useRef(0),lock=useRef(false),actor=useRef(null);
 useEffect(()=>{alive.current=true;const initial=generation.current;const {data}=authClient.auth.onAuthStateChange((event,session)=>{
   const next=session?.user?.id||null;
   if(event!=='SIGNED_OUT'&&next===actor.current){setUser(session?.user||null);return}
   actor.current=next;generation.current++;setUser(session?.user||null);setDetails(null);setOwners([]);setChecked(false);setBusy(false);
  });
  authClient.auth.getUser().then(({data,error})=>{if(alive.current&&generation.current===initial){actor.current=!error?data?.user?.id||null:null;setUser(!error?data?.user||null:null);setBusy(false)}}).catch(()=>{if(alive.current&&generation.current===initial){setUser(null);setBusy(false);setError('No se pudo verificar la sesión. Vuelve a iniciar la conexión.')}});
  return()=>{alive.current=false;generation.current++;data.subscription.unsubscribe()};
 },[]);
 useEffect(()=>{
  if(!user?.id||!authorization)return;const current=++generation.current;let cancelled=false;setBusy(true);setError('');setDetails(null);setOwners([]);setChecked(false);
  const active=()=>alive.current&&!cancelled&&current===generation.current&&actor.current===user.id;
  void(async()=>{try{
   const {data:identity,error:authError}=await authClient.auth.getUser();if(!active())return;if(authError||identity?.user?.id!==user.id||!identity.user.email_confirmed_at)throw Error('Vuelve a entrar con tu cuenta confirmada de BRUFF.');
   const {data:spaces,error:accessError}=await authClient.rpc('bruff_ai_models',{});if(!active())return;
   if(accessError||spaces?.actorId!==user.id||!Array.isArray(spaces.workspaces)||!spaces.workspaces.length)throw Error('Solo el propietario de una agencia activa puede conectar estas herramientas.');
   const {data:info,error:infoError}=await authClient.auth.oauth.getAuthorizationDetails(authorization);if(!active())return;
   if(infoError)throw Error('La conexión ha caducado o no está habilitada. Iníciala de nuevo desde el plugin de BRUFF.');
   if(info?.redirect_url){const callback=chatgptCallback(info.redirect_url);if(!callback)throw Error('El destino de la conexión no es válido.');window.location.assign(callback.href);return}
   setDetails(consentDetails(info,{authorization,actor:user.id}));setOwners(spaces.workspaces);
  }catch(failure){if(active())setError(failure.message||'No se pudo comprobar la conexión.')}finally{if(active())setBusy(false)}})();
  return()=>{cancelled=true};
 },[user?.id,authorization,reload]);
 async function login(event){event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');const form=event.currentTarget;
  try{const {error}=await authClient.auth.signInWithPassword({email:form.elements.email.value.trim(),password:form.elements.password.value});if(error)throw Error();}catch{if(alive.current)setError('No se pudo iniciar sesión. Comprueba tus datos de BRUFF.')}finally{form.elements.password.value='';lock.current=false;if(alive.current)setBusy(false)}
 }
 async function decide(approve){
  if(lock.current||!details||!user||approve&&!checked)return;lock.current=true;setBusy(true);setError('');const current=++generation.current,currentActor=user.id;
  const active=()=>alive.current&&generation.current===current&&actor.current===currentActor;
  try{
   const {data:identity,error:identityError}=await authClient.auth.getUser();if(!active())return;if(identityError||identity?.user?.id!==currentActor||!identity.user.email_confirmed_at)throw Error('La sesión cambió. Revisa la conexión de nuevo.');
   const {data:spaces,error:scopeError}=await authClient.rpc('bruff_ai_models',{});if(!active())return;if(scopeError||spaces?.actorId!==currentActor||!spaces.workspaces?.length)throw Error('Tu acceso de propietario ya no está disponible.');
   const {data:info,error:detailError}=await authClient.auth.oauth.getAuthorizationDetails(authorization);if(!active())return;if(detailError)throw Error('La solicitud ya no está disponible.');
   const fresh=consentDetails(info,{authorization,actor:currentActor});if(JSON.stringify(fresh)!==JSON.stringify(details))throw Error('La solicitud cambió. Revisa de nuevo los permisos.');
   const result=approve?await authClient.auth.oauth.approveAuthorization(authorization,{skipBrowserRedirect:true}):await authClient.auth.oauth.denyAuthorization(authorization,{skipBrowserRedirect:true});
   if(!active())return;const callback=!result.error&&chatgptCallback(result.data?.redirect_url);if(!callback)throw Error('No se pudo completar la conexión. Vuelve a iniciarla desde ChatGPT.');window.location.assign(callback.href);
  }catch(failure){if(active())setError(failure.message||'No se pudo completar la conexión.')}finally{lock.current=false;if(active())setBusy(false)}
 }
 return <main className="access-page"><section className="access-card"><Brand/><p className="access-eyebrow">CONECTOR PRIVADO</p><h1>Conectar BRUFF con ChatGPT</h1>
  {!authorization?<p role="alert">Falta una solicitud válida. Inicia la conexión desde el plugin privado de BRUFF en ChatGPT.</p>:!user?<><p>Entra con tu cuenta de propietario de BRUFF. No compartas tu contraseña en el chat.</p><form onSubmit={login}><label htmlFor="connector-email">Correo de BRUFF</label><input id="connector-email" name="email" type="email" autoComplete="username" required disabled={busy}/><label htmlFor="connector-password">Contraseña de BRUFF</label><input id="connector-password" name="password" type="password" autoComplete="current-password" required disabled={busy}/><button className="access-primary" disabled={busy}>{busy?'Verificando…':'Entrar y revisar permisos'}</button></form></>:<><p>{user.email}</p>{busy&&!details&&<p role="status">Verificando solicitud y acceso de propietario…</p>}{details&&<><h2>{details.clientName}</h2><p>Podrá consultar tus modelos, revisar ejemplos y modificar los ajustes del buscador de BRUFF IA. Los ejemplos nuevos se guardan como borradores.</p><p className="access-muted">Estas herramientas no ofrecen envío de mensajes, activación de bots, campañas, subidas ni cambios de trabajadores.</p><ul>{owners.map(space=><li key={space.id}>{space.name}</li>)}</ul><p className="access-muted">Permisos de identidad solicitados: {details.scopes.join(', ')||'Sin permisos adicionales de perfil'}.</p><details><summary>Detalles de la aplicación</summary><p>Cliente: {details.clientId}</p><p style={{overflowWrap:'anywhere'}}>Destino: {details.redirectUri}</p></details><label style={{display:'flex',gap:10,margin:'18px 0',alignItems:'flex-start'}}><input style={{width:'auto'}} type="checkbox" checked={checked} disabled={busy} onChange={event=>setChecked(event.target.checked)}/><span>He revisado la aplicación y autorizo el acceso a estas herramientas de BRUFF.</span></label><button className="access-primary" disabled={busy||!checked} onClick={()=>decide(true)}>Autorizar conexión privada</button><button disabled={busy} onClick={()=>decide(false)}>Rechazar</button></>}</>}
  {error&&<><p className="access-error" role="alert">{error}</p>{user&&<button disabled={busy} onClick={()=>setReload(value=>value+1)}>Volver a comprobar</button>}</>}
  <p className="access-muted">La conexión se aplica al plugin autorizado. Elegir «Memoria chats 1» como chat principal no convierte ese título en un permiso de seguridad.</p><a href="/">Volver a BRUFF</a>
 </section></main>;
}
