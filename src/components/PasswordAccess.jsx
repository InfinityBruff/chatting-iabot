import React, {useEffect, useState} from 'react';
import {authClient} from '../auth.js';
import {consumeAuthLink, verifyAuthLink, saveLinkPassword} from '../auth-links.js';
// Consume before rendering and reuse the promise across StrictMode effect replays.
const initialLink = consumeAuthLink(window.location, window.history);
export const hasAuthLink = Boolean(initialLink);
let verification;
function verifyOnce() {
  if (!verification) verification = verifyAuthLink(initialLink, authClient).finally(() => {
    if (initialLink) { delete initialLink.access_token; delete initialLink.refresh_token; }
  });
  return verification;
}
export default function PasswordAccess({mode, onClose}) {
  const [state,setState]=useState(mode==='link'?'checking':'request');
  const [identity,setIdentity]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  useEffect(()=>{if(mode!=='link')return;let active=true;verifyOnce().then(value=>{if(active){setIdentity(value);setState('password')}}).catch(e=>{if(active){setError(e.message);setState('invalid')}});return()=>{active=false}},[mode]);
  async function request(event){
    event.preventDefault();setBusy(true);setError('');
    const email=event.currentTarget.elements.email.value.trim();
    try {
      // No arbitrary redirect: Supabase uses the configured production Site URL.
      const {error}=await authClient.auth.resetPasswordForEmail(email);
      if(error)throw error;
      setState('sent');
    } catch {setError('No se pudo solicitar el correo. Espera unos minutos y vuelve a intentarlo.');}
    finally{setBusy(false)}
  }
  async function save(event){
    event.preventDefault();setBusy(true);setError('');
    const form=event.currentTarget;
    try{await saveLinkPassword(authClient,form.elements.password.value,form.elements.confirmation.value);setState('done');}
    catch(e){setError(e.message)}
    finally{form.reset();setBusy(false)}
  }
  async function close(){
    setBusy(true);setError('');
    try{const {error}=await authClient.auth.signOut({scope:'local'});if(error)throw error;onClose();}
    catch{setError('No se pudo cerrar la sesión temporal. Recarga la página para volver al acceso.');}
    finally{setBusy(false)}
  }
  return <>
    <h1>{state==='password'?(identity.type==='invite'?'Acepta tu invitación':'Crea una nueva contraseña'):state==='done'?'Contraseña guardada':state==='checking'?'Verificando enlace…':state==='invalid'?'Enlace no disponible':'Recupera tu acceso'}</h1>
    {state==='checking'&&<p role="status">Estamos comprobando el enlace de forma segura.</p>}
    {state==='request'&&<><p>Te enviaremos un enlace para crear una nueva contraseña.</p><form onSubmit={request}><label htmlFor="recovery-email">Correo de BRUFF</label><input id="recovery-email" name="email" type="email" autoComplete="email" required disabled={busy}/><button className="access-primary" disabled={busy}>{busy?'Solicitando…':'Enviar enlace de recuperación'}</button></form></>}
    {state==='sent'&&<p role="status">Si existe una cuenta con ese correo, recibirás un enlace de recuperación. Revisa también spam. Usa el último correo recibido; si ha caducado, solicita otro.</p>}
    {state==='password'&&<><p>{identity.email}</p><p>{identity.type==='invite'?'Crea tu contraseña de BRUFF. El propietario debe asignarte una agencia y permisos para acceder.':'Elige una contraseña que no utilices en otros servicios.'}</p><form onSubmit={save}><label htmlFor="new-password">Nueva contraseña</label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} aria-describedby="password-help"/><label htmlFor="confirm-password">Repite la contraseña</label><input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/><p id="password-help" className="access-muted">Entre 12 y 128 caracteres. Puedes usar una frase larga y única.</p><button className="access-primary" disabled={busy}>{busy?'Guardando…':'Guardar contraseña'}</button></form></>}
    {state==='done'&&<p role="status">Ya puedes iniciar sesión con tu nueva contraseña. Tus permisos se verificarán al entrar.</p>}
    {state==='invalid'&&<p>Para recuperar tu acceso, vuelve al inicio y solicita otro correo. Si era una invitación, pide al propietario que la envíe de nuevo.</p>}
    {error&&<p role="alert" className="access-error">{error}</p>}
    <button onClick={close} disabled={busy||state==='checking'}>{state==='done'?'Ir a iniciar sesión':'Volver al acceso'}</button>
  </>;
}
