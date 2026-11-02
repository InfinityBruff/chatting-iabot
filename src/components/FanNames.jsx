import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {authClient} from '../auth.js';
export function useFanNames(workspace,account,client=authClient){
 const key=workspace+':'+account,active=useRef(0),busy=useRef(false),serial=useRef(0);
 const [state,setState]=useState({key,rows:[],ready:false,error:''});
 useEffect(()=>{const version=++active.current;let pending=false;
  const read=async()=>{if(pending||busy.current||document.visibilityState!=='visible')return;pending=true;const request=++serial.current;try{const r=await client.rpc('bruff_fan_names',{w:workspace,c:account});if(r.error)throw r.error;if(!Array.isArray(r.data?.rows))throw Error('Respuesta incompleta');if(active.current===version&&request===serial.current)setState({key,rows:r.data.rows,ready:true,error:''})}catch{if(active.current===version&&request===serial.current)setState({key,rows:[],ready:false,error:'No se pudieron cargar los nombres personalizados.'})}finally{pending=false}};
  read();const timer=setInterval(read,5000);document.addEventListener('visibilitychange',read);return()=>{++active.current;clearInterval(timer);document.removeEventListener('visibilitychange',read)};
 },[key,client]);
 const current=state.key===key?state:{rows:[],ready:false,error:''};
 const save=useCallback(async(fan,value,expected)=>{if(!current.ready||busy.current)throw Error('Espera a que se verifiquen los nombres.');busy.current=true;++serial.current;const version=active.current;try{const r=await client.rpc('bruff_fan_names',{w:workspace,c:account,fan,value,expected});if(r.error)throw Error(r.error.code==='40001'?'El nombre cambió en otra sesión. Cierra y vuelve a abrir el editor.':'No se pudo guardar el nombre. Revisa tus permisos.');if(active.current===version)setState(s=>({...s,rows:[...s.rows.filter(x=>x.fanId!==fan),r.data]}));}finally{busy.current=false}},[key,client,current.ready]);
 const index=useMemo(()=>new Map(current.rows.map(row=>[row.fanId,row])),[current.rows]);
 return useMemo(()=>({...current,save,find:fan=>index.get(fan)}),[current,save,index]);
}
export function FanNameEditor({names,fan,canEdit}){
 const [open,setOpen]=useState(false),[value,setValue]=useState(''),[version,setVersion]=useState(0),[saving,setSaving]=useState(false),[error,setError]=useState('');const dialog=useRef(null),trigger=useRef(null),fanId=String(fan.userId??fan.id);
 useEffect(()=>{if(open)dialog.current?.showModal()},[open]);
 const close=()=>{if(!saving){setOpen(false);trigger.current?.focus()}};
 return <><button ref={trigger} type="button" aria-label="Editar nombre personalizado del fan" disabled={!canEdit||!names.ready} title={names.error||'Nombre personalizado guardado en BRUFF'} onClick={()=>{const row=names.find(fanId);setValue(row?.name||'');setVersion(row?.version||0);setError('');setOpen(true)}}>✎</button>{open&&<dialog ref={dialog} className="am-modal" aria-label="Nombre personalizado del fan" onCancel={e=>{e.preventDefault();close()}}><h2>Nombre personalizado</h2><p>Nombre del perfil: {fan.name||fan.username||'No disponible'}</p><p>Se guarda en BRUFF para este fan y esta modelo. No modifica su perfil de OnlyFans.</p><form onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{await names.save(fanId,value.trim(),version);setOpen(false);trigger.current?.focus()}catch(e){setError(e.message)}finally{setSaving(false)}}}><label>Nombre asignado por el equipo<input autoFocus aria-label="Nombre personalizado" maxLength={80} value={value} disabled={saving} onChange={e=>setValue(e.target.value)}/></label><p>Déjalo vacío para quitarlo. Las campañas utilizarán su siguiente opción de nombre o el nombre alternativo.</p>{error&&<p role="alert">{error}</p>}<div className="am-modal-actions"><button type="button" disabled={saving} onClick={close}>Cancelar</button><button disabled={saving}>{saving?'Guardando…':'Guardar nombre'}</button></div></form></dialog>}</>;
}
