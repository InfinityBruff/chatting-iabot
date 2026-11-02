import React,{useState} from 'react';
export function previewSources(item){return item.canView===false?[]:[...new Set([item.preview,...(item.previewSources||[]),...(['photo','gif'].includes(item.type)&&!item.convertedToVideo?[item.url]:[])].filter(Boolean))]}
export function MediaImage({item,alt='',eager=false,...props}){
 const sources=previewSources(item),key=sources.join('|');
 const [failure,setFailure]=useState({key,index:0});const index=failure.key===key?failure.index:0,src=sources[index];
 return src?<img {...props} src={src} alt={alt} loading={eager?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>setFailure({key,index:index+1})}/>:<span className="media-empty-preview">{item.canView===false?'Contenido bloqueado':item.isReady===false?'Procesando':'Vista previa no disponible'}</span>;
}
export function MediaPreview({item}){
 const [open,setOpen]=useState(false);
 if(item.canView===false)return <div className="live-media-placeholder">Contenido bloqueado</div>;
 if(!item.url||['photo','gif'].includes(item.type)&&!item.convertedToVideo||item.isDrm)return <div className="media-image-frame"><MediaImage item={item} alt="Contenido adjunto"/></div>;
 return open?(item.type==='audio'?<audio controls preload="none" src={item.url}/>:<video controls preload="metadata" src={item.url} poster={item.preview||undefined}/>):<button className="media-play-preview" type="button" onClick={()=>setOpen(true)}><MediaImage item={item} alt="Vista previa del contenido"/><span className="media-play-label">▶ {item.type==='audio'?'Audio':'Vídeo'}</span></button>;
}
