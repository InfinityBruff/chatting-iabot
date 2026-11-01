export const mediaLabels={photo:'Foto',video:'Vídeo',audio:'Audio',gif:'GIF'};
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
