import React,{useState} from 'react';
import {personalizeMessage} from '../dynamic-name.js';
export default function PersonalizedPreview({step,directory,names}){
 const [fanId,setFanId]=useState('');
 const fan=directory?.rows.find(f=>String(f.id??f.userId)===fanId);
 const custom=names?.find(fanId)?.name||'';
 let result,error='';try{result=personalizeMessage(step,fanId?{fan:fan?.name||'',custom}:{fan:'John Smith',custom:'Johnny Bravo'})}catch(e){error=e.message}
 const available=!fanId||names?.ready&&fan;
 return <section className="am-personalized-preview"><label>Destinatario de la vista previa<select value={fanId} onChange={e=>setFanId(e.target.value)}><option value="">Ejemplo ficticio · John Smith / Johnny Bravo</option>{(directory?.rows||[]).map(f=><option key={f.id??f.userId} value={String(f.id??f.userId)}>{f.name||f.username||f.id}</option>)}</select></label><p>No se envía ningún mensaje. {fanId?'Se utilizan los datos disponibles de esta modelo.':'El ejemplo utiliza nombres ficticios.'}</p>{!available?<p role="status">No se han podido verificar los nombres del destinatario.</p>:error?<p role="alert">{error}</p>:<><p>Nombre elegido: <b>{result.name||'Sin personalización'}</b> · {({fan:'Nombre del perfil',custom:'Nombre guardado en el chat',fallback:'Nombre alternativo',none:'Sin nombre dinámico'})[result.source]}</p><div className="am-preview-bubble">{result.text||'Sin texto'}</div></>}</section>;
}
