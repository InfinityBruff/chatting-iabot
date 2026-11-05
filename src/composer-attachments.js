import {mediaLabels,vaultDuration} from './vault-library.js';
export function composerAttachmentDetails(item,index=0){
 const type=Object.hasOwn(mediaLabels,item?.media?.type)?item.media.type:'file',label=mediaLabels[type]||'Archivo';
 const name=typeof item?.name==='string'&&item.name.trim()?item.name.trim():`${label} ${index+1}`;
 return {type,label,name,duration:['video','audio'].includes(type)?vaultDuration(item.media.duration):null};
}
export function attachmentScrollState({scrollLeft=0,scrollWidth=0,clientWidth=0}={}){
 const maximum=Math.max(0,scrollWidth-clientWidth),position=Math.max(0,Math.min(maximum,scrollLeft));
 return {previous:clientWidth>0&&position>1,next:clientWidth>0&&maximum-position>1};
}
