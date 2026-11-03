// One verified user/workspace/account scope owns this reader. Nothing persists
// across instances, tabs or identities; history cursor requests stay independent.
export function createNotificationReads(request,{now=Date.now,ttl=1500}={}){
 const entries=new Map();let generation=0;
 const aborted=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 return {
  async request(workspace,operation,args={},options={}){
   const active=options.active||(()=>true),epoch=generation;
   if(!active())throw aborted();
   if(operation!=='notifications'||args.cursor||!['purchases','tip'].includes(args.type))return request(workspace,operation,args,options);
   const valid=()=>generation===epoch&&active();
   const key=JSON.stringify([workspace,operation,Object.keys(args).sort().map(name=>[name,args[name]])]);
   for(const [cachedKey,row] of entries)if(!row.pending&&now()-row.at>ttl)entries.delete(cachedKey);
   let row=entries.get(key);
   if(row?.value&&!options.fresh&&now()-row.at<=ttl){if(!valid())throw aborted();return row.value}
   if(!row?.pending){
    row={consumers:new Set(),pending:null,value:null,at:0};entries.set(key,row);
    const current=row;
    // Consumers can join before the shared scheduler starts the queued read.
    const sharedActive=()=>generation===epoch&&[...current.consumers].some(consumer=>consumer.active());
    current.pending=Promise.resolve().then(()=>{if(!sharedActive())throw aborted();return request(workspace,operation,args,{...options,active:sharedActive})}).then(value=>{
     if(generation===epoch&&entries.get(key)===current&&sharedActive()&&Array.isArray(value?.data?.notifications)){current.value=value;current.at=now();current.pending=null}
     else if(entries.get(key)===current)entries.delete(key);
     return value;
    },error=>{if(entries.get(key)===current)entries.delete(key);throw error});
   }
   const consumer={active:valid};row.consumers.add(consumer);
   try{const value=await row.pending;if(!valid())throw aborted();return value}
   catch(error){if(!valid())throw aborted();throw error}
   finally{row.consumers.delete(consumer)}
  },
  clear(){generation++;entries.clear()},
 };
}
