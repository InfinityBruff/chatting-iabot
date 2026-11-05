export const mediaLabels={photo:'Foto',video:'Vídeo',audio:'Audio',gif:'GIF'};
const hasId=item=>item?.id!==undefined&&item?.id!==null&&String(item.id)!=='';
const token=item=>item?.token??item?.attachment;
const sameAttachment=(a,b)=>a!==null&&typeof a==='object'&&a===b||((hasId(a)&&hasId(b))?String(a.id)===String(b.id):!!token(a)&&token(a)===token(b));
export function vaultSelectionIndex(selected,item){return selected.findIndex(entry=>sameAttachment(entry,item));}
export function initialVaultAttachments(existing=[],replaceSelection=false,limit=10){return replaceSelection?existing.slice(0,limit):[];}
export function vaultAttachment(item){return {token:item.attachment,name:`${mediaLabels[item.type]||'Archivo'} · ${item.id}`,id:item.id,media:item};}
export function toggleVaultAttachments(selected,item,existing=[],replaceSelection=false,limit=10){
 const index=vaultSelectionIndex(selected,item);
 if(index>=0)return selected.filter((_,i)=>i!==index);
 if(!item?.attachment||!replaceSelection&&vaultSelectionIndex(existing,item)>=0||selected.length+(replaceSelection?0:existing.length)>=limit)return selected;
 return [...selected,vaultAttachment(item)];
}
export function vaultDuration(duration){
 if(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0)return null;
 const seconds=Math.floor(duration);if(!Number.isSafeInteger(seconds)||seconds<1)return null;
 return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
export function toggleVaultSelection(selected,item,existing=[],limit=10){
 const id=String(item.id);
 if(selected.some(x=>String(x.id)===id))return selected.filter(x=>String(x.id)!==id);
 if(!item.attachment||existing.some(x=>String(x.id)===id)||selected.length+existing.length>=limit)return selected;
 return [...selected,item];
}
export function sortVaultMedia(rows,order){
 return [...rows].sort((a,b)=>{const delta=(Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0);return order==='oldest'?delta:-delta});
}
export async function collectVaultFolders(request,onPage,isActive=()=>true){
 const rows=new Map(),seen=new Set();let cursor;
 while(isActive()){
  const result=await request(cursor);if(!isActive())return;
  const data=result?.data;if(!Array.isArray(data?.categories))throw Error('No se pudieron leer las carpetas.');
  for(const f of data.categories)rows.set(String(f.id),f);
  onPage([...rows.values()],data.hasMore!==true);
  if(data.hasMore!==true)return;
  if(typeof data.cursor!=='string'||!data.cursor||seen.has(data.cursor))throw Error('La lista de carpetas está incompleta: el proveedor no entregó una página nueva.');
  seen.add(data.cursor);cursor=data.cursor;
 }
}
