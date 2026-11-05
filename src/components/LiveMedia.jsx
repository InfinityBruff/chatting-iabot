import {readSession,writeSession,sessionKey} from '../chat-sync.js';
import {MediaPreview} from './MediaPreview.jsx';
import ComposerAttachments from './ComposerAttachments.jsx';
import ComposerVaultDialog from './ComposerVaultDialog.jsx';
import {vaultSelectionIndex} from '../vault-library.js';
export {MediaPreview} from './MediaPreview.jsx';
const VaultLibrary=React.lazy(()=>import('./VaultLibrary.jsx'));
import {sendManualMessage} from '../manual-send.js';
import {restoreReply} from '../message-actions.js';
import {ChatIcon,PendingChatFeature} from './ChatTools.jsx';
import {ChatSafetyNotice} from './ChatSafety.jsx';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {authClient} from '../auth.js';
import {liveRequest,usePage,More} from './LiveData.jsx';
export function LiveVault(props){return <React.Suspense fallback={<div className="vault-loading" role="status">Cargando biblioteca…</div>}><VaultLibrary {...props}/></React.Suspense>;}
export function Composer({workspace,account,fan,canVault,enabled,onSent,onProgress=()=>{},currentUserId,model,compact=false,blocked=false,replyRequest,onEditLockChange}){
 const draftKey=sessionKey(currentUserId,workspace,account,String(fan.userId??fan.id),'draft');
 const restored=useRef(readSession(draftKey,{}));
 const outgoingId=useRef(crypto.randomUUID());
 const input=useRef(null),consumedReply=useRef(null),sendButton=useRef(null),focusAfterSend=useRef(null);
 const [reply,setReply]=useState(()=>restoreReply(restored.current?.reply));
 const [safety,setSafety]=useState(null);
 const [notice,setNotice]=useState(''),[quick,setQuick]=useState(false),[snippet,setSnippet]=useState('');
 useEffect(()=>{if(blocked)setSafety({blocked:true});else setSafety(previous=>previous?.blocked?null:previous)},[blocked]);
 enabled=enabled&&!blocked&&!safety?.blocked;
 const [text,setText]=useState(restored.current?.text||''),[price,setPrice]=useState(restored.current?.price||'0'),[attachments,setAttachments]=useState(restored.current?.attachments||[]),[vault,setVault]=useState(false),[pricing,setPricing]=useState(false),[review,setReview]=useState(restored.current?.review||null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(''),[attempted,setAttempted]=useState(!!restored.current?.review);const lock=useRef(false),fileInput=useRef(null);
 const [vaultDraft,setVaultDraft]=useState([]),[vaultRevision,setVaultRevision]=useState(0),vaultDraftRef=useRef([]);
 const vaultScope=currentUserId&&workspace?sessionKey(currentUserId,workspace,'','','vault-dialog-size'):null;
 const stageVault=items=>{vaultDraftRef.current=items;setVaultDraft(items)};
 const openVault=()=>{if(lock.current||!enabled||review)return;stageVault(attachments.slice());setVaultRevision(n=>n+1);setVault(true)};
 useEffect(()=>{if(!enabled||review)setVault(false)},[enabled,review]);
 useLayoutEffect(()=>{const scope=focusAfterSend.current;if(!scope||busy)return;focusAfterSend.current=null;const field=input.current,active=field?.ownerDocument.activeElement;if(scope===draftKey&&enabled&&!review&&field?.isConnected&&!field.disabled&&(active===field.ownerDocument.body||active===field||active===sendButton.current))field.focus({preventScroll:true})},[busy,enabled,review,draftKey]);
 const saveDraft=(value)=>writeSession(draftKey,value);
 useEffect(()=>{saveDraft({text,price,reply,attachments:attachments.map(a=>({...a,media:a.media?.url?.startsWith('blob:')?{type:a.media.type}:a.media})),review})},[draftKey,text,price,reply,attachments,review]);
 useEffect(()=>{onEditLockChange?.(busy||!enabled||!!review)},[busy,enabled,review,onEditLockChange]);
 useEffect(()=>{if(!replyRequest||consumedReply.current===replyRequest.key)return;consumedReply.current=replyRequest.key;const target=restoreReply(replyRequest.target);if(target&&!lock.current&&enabled&&!review){setReply(target);input.current?.focus()}},[replyRequest,enabled,review]);
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');setSent('');try{await fn()}catch(e){setError(e.message);if(e.safety){setReview(null);setAttempted(false);setSafety(e.safety)}}finally{lock.current=false;setBusy(false)}}
 const amount=Number(price.replace(',','.'));const priceValid=price===''||/^\d+(?:[.,]\d{1,2})?$/.test(price)&&Number.isSafeInteger(Math.round(amount*100));
 const priceEditable=!busy&&enabled&&!review;
 const clearPrice=()=>{if(lock.current||!priceEditable)return;setPrice('0');setPricing(false)};
 const removeAttachment=item=>{if(lock.current||!priceEditable)return;const index=vaultSelectionIndex(attachments,item);if(index<0)return;const remaining=attachments.filter((_,i)=>i!==index);setAttachments(remaining);if(!remaining.length){setPrice('0');setPricing(false)}};
 const formatPrice=n=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(n);
 const select=items=>{if(lock.current||!priceEditable)return;const next=items.slice(0,10);setAttachments(next);if(!next.length){setPrice('0');setPricing(false)}setVault(false)};
 const objectUrls=useRef([]);useEffect(()=>()=>objectUrls.current.forEach(url=>URL.revokeObjectURL(url)),[]);
 async function upload(file){if(!file||lock.current||busy||!enabled||review||vaultDraftRef.current.length>=10)return;await run(async()=>{if(file.size>10*1024*1024)throw Error('Límite actual: 10 MB por archivo. Los vídeos grandes requieren subida por partes.');const form=new FormData();form.set('workspace_id',workspace);form.set('creator_id',account);form.set('operation','upload');form.set('file',file);const {data,error:e}=await authClient.functions.invoke('bruff-live',{body:form});if(e){let message;try{message=(await e.context.json()).error}catch{}throw Error(message||'No se pudo subir el archivo.')}if(data?.error)throw Error(data.error);const url=URL.createObjectURL(file);objectUrls.current.push(url);stageVault([...vaultDraftRef.current,{id:crypto.randomUUID(),name:data.data.name,token:data.data.attachment,media:{url,type:file.type==='image/gif'?'gif':file.type.startsWith('image/')?'photo':file.type.startsWith('video/')?'video':'audio'}}].slice(0,10));setVaultRevision(n=>n+1)});if(fileInput.current)fileInput.current.value=''}
 const reviewDisabled=busy||!enabled||!priceValid||(amount>0&&!attachments.length)||(!text.trim()&&!attachments.length);
 const prepare=()=>run(async()=>{
  setVault(false);
  const outgoing={id:'pending:'+outgoingId.current,text,price:amount,isFromMe:true,createdAt:new Date().toISOString(),media:attachments.map(a=>a.media).filter(Boolean),...(reply?{bruffReply:reply}:{}),delivery:'checking'};
  onProgress(outgoing);
  try{
   const r=await sendManualMessage({request:(operation,args)=>liveRequest(workspace,operation,args),draft:{creator_id:account,conversation_id:String(fan.userId??fan.id),text,price:amount,attachments:attachments.map(a=>a.token),...(reply?{replyTo:reply.id}:{})},pending:review,onPrepared:pending=>{setReview(pending);setAttempted(true);saveDraft({text,price,reply,attachments:attachments.map(a=>({...a,media:a.media?.url?.startsWith('blob:')?{type:a.media.type}:a.media})),review:pending});onProgress({...outgoing,delivery:'sending'})}});
   saveDraft(null);setReview(null);setAttempted(false);setText('');setReply(null);setPrice('0');setAttachments([]);setSent('Enviado');
   onSent({...outgoing,id:String(r.data.id),delivery:undefined,createdAt:r.data.createdAt||outgoing.createdAt,seenByFan:false,sentBy:r.data.sentBy,attributionAvailable:typeof r.data.sentBy==='string'});
   outgoingId.current=crypto.randomUUID();
   focusAfterSend.current=draftKey;
  }catch(e){onProgress(e.safety?null:{...outgoing,delivery:'uncertain'});throw e;}
 });
 const cancelReview=()=>{if(attempted&&!window.confirm('El mensaje podría haberse enviado. Comprueba el historial antes de crear otro. ¿Descartar este intento?'))return;setReview(null);setAttempted(false);onProgress(null)};
 const priceField=<label className="live-price">Precio total del contenido (USD)<input aria-label="Precio total del contenido (USD)" inputMode="decimal" value={price} maxLength={12} disabled={!priceEditable} onChange={e=>{if(!lock.current&&priceEditable)setPrice(e.target.value)}} placeholder="0,00"/></label>;
 return <section className={`live-composer ${compact?'chat-composer':''}`} aria-label="Redactar mensaje">
  {safety&&<ChatSafetyNotice safety={safety} onClose={()=>setSafety(previous=>previous?.blocked?{...previous,dismissed:true}:null)}/>}
  {!enabled&&<p role="status">{blocked||safety?.blocked?'Envío suspendido. Solo el propietario puede habilitarlo desde Equipo.':'El conector está en modo de lectura.'}</p>}{error&&<p role="alert">{error}</p>}{sent&&<p role="status" className="chat-send-success">{sent}</p>}
  {vault&&<ComposerVaultDialog scope={vaultScope} model={typeof model==='string'?model:model?.name||model?.username||'Modelo seleccionada'} count={vaultDraft.length} busy={busy} onClose={()=>setVault(false)} footer={!canVault?<><span>{vaultDraft.length} seleccionados · No se envía nada</span><button type="button" className="vault-primary" disabled={!priceEditable} onClick={()=>select(vaultDraft)}>Añadir al mensaje{vaultDraft.length?' · '+vaultDraft.length:''}</button></>:null}>
   <details className="vault-upload-panel" open={!canVault}><summary>Subir desde tu dispositivo</summary><div className="chat-attachment-tabs"><label className="live-file">Subir archivo<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/ogg" disabled={!priceEditable||vaultDraft.length>=10} onChange={e=>upload(e.target.files?.[0])}/></label><small>Hasta 10 adjuntos · Aplicar la selección no envía el mensaje.</small></div>{busy&&<p role="status">Procesando archivo…</p>}{error&&<p role="alert">{error}</p>}{!canVault&&<ComposerAttachments items={vaultDraft} disabled={!priceEditable} onRemove={item=>{if(!priceEditable||lock.current)return;const index=vaultSelectionIndex(vaultDraftRef.current,item);if(index>=0)stageVault(vaultDraftRef.current.filter((_,i)=>i!==index))}}/>}</details>
   {canVault&&<div className="composer-vault-library-lock" inert={busy?true:undefined} aria-busy={busy}><LiveVault key={draftKey+':'+vaultRevision} workspace={workspace} account={account} existing={vaultDraft} replaceSelection onSelectionChange={stageVault} onSelect={select}/></div>}
  </ComposerVaultDialog>}
  <div className="live-emoji" aria-label="Emojis frecuentes">{['😘','😍','🥰','😏','😈','🤤','🔥','💦','🍑','👀','💕','❤️','😉','😂','🙈','🥵'].map(e=><button type="button" key={e} aria-label={'Insertar '+e} disabled={busy||!enabled||!!review} onClick={()=>setText(t=>(t+e).slice(0,10000))}>{e}</button>)}</div>

  {pricing&&<div className="composer-price-panel"><ChatIcon name="tag"/>{priceField}<button type="button" aria-label="Quitar precio" title="Quitar precio y dejar gratis" disabled={!priceEditable} onClick={clearPrice}>×</button></div>}
  {reply&&<aside className="chat-compose-reply" aria-label="Respuesta al mensaje"><div><small>Respondiendo a {reply.name}</small><p>{reply.text}</p></div><button type="button" aria-label="Cancelar respuesta" disabled={!priceEditable} onClick={()=>{if(!lock.current&&priceEditable)setReply(null)}}>×</button></aside>}
  {(attachments.length>0||price!=='0')&&<section className="composer-attachment-section" aria-label="Contenido preparado para enviar"><div className="composer-attachment-total"><strong>{priceValid?(amount>0?`Total del conjunto · ${formatPrice(amount)}`:'Gratis · Todos los archivos'):'Precio inválido'}</strong><button type="button" disabled={!priceEditable} onClick={()=>setPricing(!pricing)}>{amount>0?'Editar precio':'Poner precio'}</button>{(amount>0||!priceValid)&&<button type="button" disabled={!priceEditable} onClick={clearPrice}>Quitar precio</button>}</div><ComposerAttachments items={attachments} disabled={!priceEditable} onRemove={removeAttachment}/></section>}
  <div className="chat-compose-line"><textarea ref={input} aria-label="Escribir mensaje" placeholder="Escribe un mensaje…" maxLength={10000} disabled={busy||!enabled||!!review} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!reviewDisabled)prepare()}}}/></div>
  <div className="reference-quick-replies"><button disabled={busy||!enabled||!!review} onClick={()=>setQuick(!quick)}>Respuesta rápida</button>{[['Saludo','Hola, ¿cómo estás?'],['Pregunta','¿Qué tal ha ido tu día?'],['Gracias','¡Muchas gracias!']].map(([label,value])=><button key={label} disabled={busy||!enabled||!!review} onClick={()=>setText(t=>(t+(t?' ':'')+value).slice(0,10000))}>{label}</button>)}<button onClick={()=>setNotice('Sugerencias de respuestas con IA')}>Sugerencias IA</button></div>
  {quick&&<div className="reference-quick-editor"><input aria-label="Respuesta rápida personalizada" placeholder="Escribe tu respuesta rápida…" value={snippet} onChange={e=>setSnippet(e.target.value)} maxLength={10000}/><button disabled={!snippet.trim()||busy||!enabled||!!review} onClick={()=>{setText(t=>(t+(t?' ':'')+snippet).slice(0,10000));setQuick(false)}}>Insertar</button></div>}
  <div className="reference-compose-toolbar"><div>{[['image','Adjuntar fotos'],['video','Adjuntar vídeo'],['mic','Adjuntar audio']].map(([icon,label])=><button key={icon} aria-label={label} title={label} disabled={busy||!enabled||!!review} onClick={openVault}><ChatIcon name={icon}/></button>)}<button aria-label="Adjuntar GIF" title="Adjuntar GIF" disabled={busy||!enabled||!!review} onClick={openVault}>GIF</button><button aria-label="Abrir baúl" title="Abrir baúl" disabled={busy||!enabled||!!review} onClick={openVault}><ChatIcon name="image"/></button><button aria-label="Programar mensaje" title="Programar mensaje · Pendiente" onClick={()=>setNotice('Programación de mensajes')}><ChatIcon name="calendar"/></button><button aria-label="Precio del contenido" title="Precio del mensaje" aria-expanded={pricing} aria-pressed={amount>0} disabled={busy||!enabled||!!review} onClick={()=>setPricing(!pricing)}><ChatIcon name="tag"/></button><button aria-label="Insertar nombre del fan" title="Insertar nombre del fan" disabled={busy||!enabled||!!review} onClick={()=>setText(t=>(t+(fan.name||fan.username||'')).slice(0,10000))}><ChatIcon name="at"/></button><button aria-label="Traducir borrador" title="Traducir borrador · Pendiente" onClick={()=>setNotice('Traducción del borrador')}><ChatIcon name="translate"/></button></div><button ref={sendButton} className="chat-review-button" title="Enviar mensaje" aria-label="Enviar mensaje" disabled={reviewDisabled} onClick={prepare}>{busy?'Enviando…':review?'REINTENTAR':'ENVIAR'}<ChatIcon name="send" size={15}/></button></div>
  {notice&&<PendingChatFeature feature={notice} onClose={()=>setNotice('')}/>}

  {!priceValid&&<p role="alert">Introduce un precio de cero o más con un máximo de dos decimales.</p>}{priceValid&&amount>0&&!attachments.length&&<p role="alert">Adjunta contenido o cambia el precio a 0 para enviar solo texto.</p>}

  {review&&!busy&&<div className="chat-send-pending" role="status"><p>No hemos recibido confirmación del envío. Reintentar utiliza el mismo envío para evitar duplicados. Comprueba el historial antes de crear otro mensaje.</p><button disabled={busy} onClick={cancelReview}>Descartar intento y volver a editar</button></div>}
 </section>;
}
