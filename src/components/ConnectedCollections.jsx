import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import useCollectionCatalog from './useCollectionCatalog.js';
import {CollectionFans} from './CollectionFans.jsx';
import {liveRequest,usePage,More} from './LiveData.jsx';
import {pageCacheEpoch} from '../live-page-cache.js';
import './collections.css';

const listId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const memberId=value=>typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const listName=list=>typeof list?.name==='string'&&list.name?list.name:'Lista sin nombre';
const when=value=>value&&Number.isFinite(typeof value==='number'?value:Date.parse(value))?new Date(value).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):null;
function ListIcon(){return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>}
function ListType({type}){const label=({custom:'Personalizada',automatic:'Automática',fans:'Fans',following:'Siguiendo',restricted:'Restringidos',blocked:'Bloqueados'})[type]||'OnlyFans';return <span className="collections-kind">{label}</span>}
function Avatar({user}){const label=user.name||user.username||user.id||'?';return <span className="collections-avatar" aria-hidden="true">{label.slice(0,1).toUpperCase()}{user.avatar&&<img src={user.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true}}/>}</span>}

export default function ConnectedCollections(props){
 return <CollectionsScope key={JSON.stringify([props.user,props.workspace,props.account])} {...props}/>;
}
function CollectionsScope({user,workspace,account,enabled}){
 const [mode,setMode]=useState('users');
 const valid=[user,workspace,account].every(value=>typeof value==='string'&&value.trim());
 return <section className="connected-collections"><header className="collections-page-heading"><div><small>ORGANIZACIÓN · ONLYFANS</small><h1>Colecciones</h1><p>Las listas y publicaciones guardadas de la modelo seleccionada.</p></div>{!enabled&&<span className="collections-readonly">Solo lectura</span>}</header><div className="collections-tabs" role="tablist" aria-label="Contenido de las colecciones"><button type="button" role="tab" aria-selected={mode==='users'} onClick={()=>setMode('users')}>Usuarios</button><button type="button" role="tab" aria-selected={mode==='bookmarks'} onClick={()=>setMode('bookmarks')}>Publicaciones guardadas</button></div>{!valid?<p role="alert" className="collections-notice">No se pudo verificar el usuario o la modelo seleccionada.</p>:mode==='users'?<CollectionsUsers actor={user} workspace={workspace} account={account} enabled={enabled}/>:<SavedPosts workspace={workspace} account={account}/>}</section>;
}

function CollectionsUsers({actor,workspace,account,enabled}){
 const [query,setQuery]=useState(''),[selected,setSelected]=useState(null),[chosen,setChosen]=useState(null),[detailBusy,setDetailBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[picker,setPicker]=useState(false),[pending,setPending]=useState(null),[busy,setBusy]=useState(false),[localDenied,setLocalDenied]=useState(false);
 const alive=useRef(false),version=useRef(0),mutation=useRef(0),writing=useRef(false),denied=useRef(false),epoch=useRef(pageCacheEpoch()),catalogRef=useRef(null),selectedRef=useRef(selected),enabledRef=useRef(enabled),detailPolicy=useRef({}),openRef=useRef(null);selectedRef.current=selected;enabledRef.current=enabled;
 const clearPrivate=useCallback(reason=>{
  if(denied.current)return;denied.current=true;version.current++;mutation.current++;writing.current=false;
  setChosen(null);setSelected(null);setPicker(false);setPending(null);setQuery('');setNotice('');setDetailBusy(false);setBusy(false);setLocalDenied(true);setError(reason?.message||'El acceso ha cambiado. Vuelve a abrir Colecciones para verificar tus permisos.');
 },[]);
 const accessChanged=pageCacheEpoch()!==epoch.current;
 const catalog=useCollectionCatalog({actor,workspace,account,enabled:!localDenied&&!accessChanged,onDenied:clearPrivate});catalogRef.current=catalog;
 const blocked=localDenied||catalog.denied||accessChanged;
 const deny=useCallback(reason=>{clearPrivate(reason);catalogRef.current?.deny(reason)},[clearPrivate]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;version.current++;mutation.current++;writing.current=false}},[]);
 useEffect(()=>{if(!enabled){setPending(null);setPicker(false)}},[enabled]);
 useEffect(()=>{if(accessChanged)deny(Error('El acceso ha cambiado. Vuelve a abrir Colecciones para verificar tus permisos.'));else if(catalog.denied)clearPrivate(Error(catalog.error||'No tienes acceso a las colecciones de esta modelo.'))},[accessChanged,catalog.denied,catalog.error,deny,clearPrivate]);
 const current=token=>alive.current&&!denied.current&&version.current===token&&epoch.current===pageCacheEpoch();
 function invalidateDetail(){version.current++;setChosen(null);setDetailBusy(false);setPicker(false)}
 async function open(id,{background=false,preserveNotice=false}={}){
  if(blocked||writing.current||!listId(id)||document.visibilityState!=='visible')return;
  const token=++version.current;setSelected(id);if(!background){setChosen(null);setPicker(false);setPending(null);setError('')}if(!preserveNotice)setNotice('');setDetailBusy(true);
  try{const response=await liveRequest(workspace,'collection_detail',{creator_id:account,list_id:id},{priority:'selected',active:()=>current(token)});
   if(!current(token)||document.visibilityState!=='visible')return;
   if(response?.data?.id!==id||!Array.isArray(response.data.users))throw Error('OnlyFans no devolvió el detalle de la lista seleccionada. Actualiza para volver a comprobarlo.');
   setChosen(response.data);setError('');
  }catch(failure){if(!alive.current)return;if(epoch.current!==pageCacheEpoch()){deny(Error('El acceso ha cambiado. Vuelve a abrir Colecciones.'));return}if(failure?.status===401||failure?.status===403){deny(failure);return}if(current(token)&&failure?.name!=='AbortError')setError(failure.message||'No se pudo consultar esta lista.')}
  finally{if(current(token))setDetailBusy(false)}
 }
 openRef.current=open;detailPolicy.current={blocked,pending:!!pending,picker,detailBusy};
 useEffect(()=>{
  const refreshVisible=()=>{const policy=detailPolicy.current,id=selectedRef.current;if(document.visibilityState==='visible'&&id&&!policy.blocked&&!policy.pending&&!policy.picker&&!policy.detailBusy&&!writing.current)void openRef.current(id,{background:true,preserveNotice:true})};
  const visibility=()=>{if(document.visibilityState!=='visible'){version.current++;setDetailBusy(false)}else refreshVisible()};
  const timer=setInterval(refreshVisible,30000);document.addEventListener('visibilitychange',visibility);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility)};
 },[]);
 useEffect(()=>{if(!blocked&&catalog.complete&&!catalog.error&&selected&&!catalog.rows.some(list=>list.id===selected)){invalidateDetail();setSelected(null);setPending(null);setNotice('');setError('La colección seleccionada ya no figura en el catálogo actualizado de OnlyFans.')}},[catalog.rows,catalog.complete,catalog.error,selected,blocked]);
 function refresh(){
  if(blocked||writing.current)return;const id=selectedRef.current;invalidateDetail();setPending(null);setError('');setNotice('');catalog.refresh();if(id)void open(id);
 }
 function confirm(action){
  if(!enabledRef.current||blocked||writing.current)return;
  if(action.op==='collection_rename'&&chosen?.canUpdate!==true||action.op==='collection_remove'&&chosen?.canManageUsers!==true)return;
  setPending(action);setError('');setNotice('');
 }
 async function mutate(event){
  event.preventDefault();if(!pending||writing.current||blocked||!enabledRef.current)return;
  const action=pending,rename=action.op==='collection_rename',create=action.op==='collection_create';
  if(rename&&chosen?.id!==action.listId||rename&&chosen?.canUpdate!==true||action.op==='collection_remove'&&(chosen?.id!==action.listId||chosen.canManageUsers!==true||!memberId(action.member.id)))return;
  const name=typeof action.name==='string'?action.name.trim():'';if((rename||create)&&(!name||name.length>64))return;
  const token=++mutation.current,valid=()=>alive.current&&!denied.current&&mutation.current===token&&epoch.current===pageCacheEpoch();
  writing.current=true;setBusy(true);setError('');invalidateDetail();
  try{
   const response=await liveRequest(workspace,action.op,{creator_id:account,...(create?{name}:rename?{list_id:action.listId,name}:{list_id:action.listId,user_id:action.member.id})});
   if(!valid())return;
   const id=create?response?.data?.id:action.listId;
   if((create||rename)&&(!listId(response?.data?.id)||rename&&response.data.id!==id)||action.op==='collection_remove'&&response?.data?.success!==true)throw Error('El proveedor no confirmó el cambio con un identificador válido.');
   setPending(null);setNotice(create?'Lista creada en OnlyFans.':rename?'Nombre actualizado en OnlyFans.':'Miembro quitado de esta lista.');catalog.refresh();writing.current=false;setBusy(false);if(id)await open(id,{preserveNotice:true});
  }catch(failure){if(!valid())return;setPending(null);if(failure?.status===401||failure?.status===403)deny(failure);else setError((failure.message||'No se pudo confirmar el cambio.')+' Actualiza antes de repetir para comprobar si se aplicó.');}
  finally{if(valid()){writing.current=false;setBusy(false)}}
 }
 const rows=blocked?[]:catalog.rows,search=query.trim().toLocaleLowerCase('es-ES'),filtered=rows.filter(list=>[list.name,list.type,list.id].join(' ').toLocaleLowerCase('es-ES').includes(search));
 const detail=blocked?null:chosen,members=detail?.users||[],total=count(detail?.usersCount),partial=detail&&(total===null||total!==members.length),selectedRow=rows.find(list=>list.id===selected);
 return <><div className="collections-toolbar"><div><strong>{rows.length} {rows.length===1?'lista':'listas'}{catalog.complete&&!blocked?'':' recibidas'}</strong><span>{blocked?'Acceso pendiente de verificar':catalog.queued?'Preparando consulta…':catalog.busy?'Consultando OnlyFans…':catalog.complete?'Catálogo completo':catalog.error?'Catálogo parcial':'Preparando catálogo…'}{!blocked&&when(catalog.checked)?' · '+when(catalog.checked):''}</span></div><button type="button" onClick={refresh} disabled={blocked||busy}>Actualizar</button><button type="button" className="collections-primary" disabled={!enabled||blocked||busy} onClick={()=>confirm({op:'collection_create',name:''})}>＋ Nueva lista</button></div>{(error||catalog.error)&&<p role="alert" className="collections-notice collections-error">{error||catalog.error}</p>}{notice&&!blocked&&<p role="status" className="collections-notice">{notice}</p>}<div className="collections-layout"><aside className="collections-catalog" aria-label="Listas de usuarios"><label className="collections-search"><span>Buscar listas</span><input type="search" value={blocked?'':query} onChange={event=>setQuery(event.target.value)} disabled={blocked} maxLength={150} placeholder="Nombre de la lista"/></label><div className="collections-list-items">{filtered.map(list=><button key={list.id} type="button" className="collections-list-item" aria-pressed={selected===list.id} disabled={busy||blocked} onClick={()=>open(list.id)}><span className="collections-list-symbol"><ListIcon/></span><span className="collections-list-name"><strong title={listName(list)}>{listName(list)}</strong><ListType type={list.type}/></span><span className="collections-list-count" title={count(list.usersCount)===null?'Recuento no facilitado por OnlyFans':undefined}>{count(list.usersCount)??'—'}</span></button>)}{!filtered.length&&<p className="collections-empty-small" role="status">{blocked?'No hay datos disponibles con este acceso.':search?'No hay listas que coincidan.':catalog.busy?'Consultando las listas de OnlyFans…':catalog.complete?'OnlyFans no ha devuelto listas para esta modelo.':'Todavía no hay listas recibidas.'}</p>}</div><p className="collections-catalog-footnote">Orden y recuentos facilitados por OnlyFans.{!catalog.complete&&!blocked?' La carga continúa automáticamente mientras esta vista está abierta.':''}</p></aside><section className="collections-detail" aria-label="Detalle de la colección" aria-busy={detailBusy&&!blocked||undefined}>{detail?<><header className="collections-detail-heading"><div><small>COLECCIÓN DE USUARIOS</small><h2>{listName(detail)}</h2><ListType type={detail.type}/></div><button type="button" disabled={!enabled||detail.canUpdate!==true||busy} onClick={()=>confirm({op:'collection_rename',listId:detail.id,name:detail.name||''})}>Renombrar</button></header><div className="collections-detail-summary"><div><span>Total en OnlyFans</span><strong>{total??'—'}</strong></div><div><span>Miembros recibidos</span><strong>{members.length}</strong></div><button type="button" className="collections-primary" disabled={!enabled||detail.canAddUsers!==true||busy} onClick={()=>setPicker(true)}>Añadir usuarios</button></div>{partial&&<p className="collections-preview-note">{total===null?'OnlyFans no facilitó un total para confirmar que estos miembros sean todos.':total>members.length?`Vista parcial: se han recibido ${members.length} de ${total} miembros.`:'El total informado y los miembros recibidos no coinciden.'} Esta respuesta no permite cargar más miembros de la colección.</p>}{detail.canAddUsers!==true&&<p className="collections-capability-note">OnlyFans no permite añadir a esta lista.</p>}<div className="collections-members-heading"><h3>Miembros recibidos</h3><span>Solo usuarios incluidos en la respuesta de esta colección</span></div><div className="collections-members">{members.map((member,index)=><article key={member.id||'unknown-'+index} className="collections-member"><Avatar user={member}/><div><strong>{member.name||member.username||member.id||'Usuario sin nombre'}</strong><small>{member.username?'@'+member.username:member.id?'ID '+member.id:'Identificador no facilitado'}</small></div>{detail.canManageUsers===true&&<button type="button" disabled={!enabled||busy||!memberId(member.id)} aria-label={'Quitar a '+(member.name||member.username||member.id||'este usuario')+' de la lista'} onClick={()=>confirm({op:'collection_remove',listId:detail.id,listName:listName(detail),member})}>Quitar</button>}</article>)}{!members.length&&<div className="collections-members-empty"><ListIcon/><h3>Sin miembros en esta respuesta</h3><p>{total===0?'OnlyFans informa de cero usuarios en esta lista.':'No se han recibido usuarios. Esto no confirma que la colección esté vacía.'}</p></div>}</div></>:<div className="collections-detail-empty"><ListIcon/><h2>{detailBusy&&!blocked?'Consultando '+listName(selectedRow):blocked?'Acceso pendiente de verificar':'Selecciona una colección'}</h2><p>{detailBusy&&!blocked?'Preparando el detalle y los miembros que entrega OnlyFans.':blocked?'Cierra y vuelve a abrir este apartado para verificar tus permisos actuales.':'Consulta los miembros y gestiona las acciones disponibles para esta lista.'}</p>{selected&&!detailBusy&&!blocked&&<button type="button" onClick={()=>open(selected)}>Volver a consultar la lista</button>}</div>}</section></div>{!blocked&&picker&&detail?.canAddUsers===true&&<CollectionFans key={JSON.stringify([actor,workspace,account,detail.id])} workspace={workspace} account={account} list={detail} onClose={()=>setPicker(false)} onDenied={deny} onAdded={()=>{if(!alive.current||denied.current||epoch.current!==pageCacheEpoch())return;const id=detail.id;invalidateDetail();catalog.refresh();void open(id)}}/>}{!blocked&&pending&&<CollectionConfirmation pending={pending} busy={busy} onChange={setPending} onClose={()=>{if(!writing.current)setPending(null)}} onSubmit={mutate}/>}</>;
}

function CollectionConfirmation({pending,busy,onChange,onClose,onSubmit}){
 const dialog=useRef(null),title=useId(),input=pending.op==='collection_create'||pending.op==='collection_rename';
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close()},[]);
 const heading=pending.op==='collection_create'?'Crear una lista':pending.op==='collection_rename'?'Renombrar la colección':'Quitar de la colección';
 return <dialog ref={dialog} className="collections-confirm" aria-labelledby={title} onCancel={event=>{event.preventDefault();if(!busy)onClose()}}><form onSubmit={onSubmit}><header><small>CAMBIO EN ONLYFANS</small><h2 id={title}>{heading}</h2></header>{input?<label>Nombre de la lista<input autoFocus required maxLength={64} value={pending.name} disabled={busy} onChange={event=>onChange(previous=>({...previous,name:event.target.value}))}/></label>:<p>Se quitará a <strong>{pending.member.name||pending.member.username||pending.member.id}</strong> de <strong>{pending.listName}</strong>.</p>}<p>El cambio se aplicará a la cuenta real de la modelo seleccionada.</p><footer><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="collections-primary" disabled={busy||input&&!pending.name.trim()}>{busy?'Aplicando…':pending.op==='collection_create'?'Confirmar y crear':pending.op==='collection_rename'?'Confirmar nombre':'Confirmar y quitar'}</button></footer></form></dialog>;
}

function SavedPosts({workspace,account}){
 const page=usePage(workspace,account,'bookmarks',{},'posts'),rows=page.result?.data.posts||[];
 return <section className="collections-posts" aria-label="Publicaciones guardadas"><header><div><h2>Publicaciones guardadas</h2><p>Historial recibido de OnlyFans para esta modelo.</p></div><button type="button" disabled={page.busy||page.waiting} onClick={()=>page.load()}>Actualizar</button></header>{page.error&&<p role="alert" className="collections-notice collections-error">{page.error}</p>}{(page.busy||page.waiting)&&<p role="status">{page.waiting?'Esperando al proveedor…':'Consultando publicaciones…'}</p>}<div className="collections-post-grid">{rows.map(post=><article key={post.id}><small>Publicación guardada{when(post.postedAt)?' · '+when(post.postedAt):''}</small><h3>{post.author?.name||post.author?.username||'Publicación de OnlyFans'}</h3><p>{post.text||'OnlyFans no ha facilitado texto para esta publicación.'}</p><footer><span>{count(post.mediaCount)===null?'Número de archivos no facilitado':`${post.mediaCount} archivos`}</span><span>ID {post.id}</span></footer></article>)}</div>{page.result&&!rows.length&&<div className="collections-detail-empty"><ListIcon/><h3>No hay publicaciones en esta página</h3><p>OnlyFans no ha devuelto publicaciones guardadas para esta consulta.</p></div>}<More page={page.result?.data} busy={page.busy||page.waiting} load={page.load}/><p className="collections-catalog-footnote">Vista de lectura. El historial se amplía únicamente con los cursores facilitados por OnlyFans.</p></section>;
}
