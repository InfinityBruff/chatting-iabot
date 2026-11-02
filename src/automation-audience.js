export function completeListMembers(list){
 if(!Array.isArray(list?.users)||!Number.isSafeInteger(list.usersCount)||list.usersCount<0)throw Error('El proveedor no confirma la totalidad de esta colección.');
 const ids=[...new Set(list.users.map(f=>String(f.id)).filter(id=>/^\d{1,24}$/.test(id)))];
 if(ids.length!==list.usersCount)throw Error('La colección está incompleta. No se utilizará una vista previa para enviar.');
 return ids;
}
export function freshOnlineFans(rows,presence,now=Date.now()){
 const map=new Map(rows.map(f=>[String(f.id),f]));return Object.entries(presence?.confirmations||{}).filter(([,stamp])=>{const t=Date.parse(stamp);return t<=now&&now-t<60000}).map(([id])=>map.get(id)||{id,name:'Fan '+id});
}
