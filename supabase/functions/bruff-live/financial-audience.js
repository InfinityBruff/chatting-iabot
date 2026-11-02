// Read-only, resumable financial filters. No provider writes or recipient IDs from clients.
const day=86400000;
const validId=x=>typeof x==='string'&&/^[1-9][0-9]{0,23}$/.test(x);
function range(rule){
 const min=Number(rule.min),max=Number(rule.max);
 if(rule.min===''||rule.max===''||!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<min)throw Error('Rango financiero inválido');
 return {min,max};
}
export async function filterFinancialAudience({ids,audience,sources,current,read,save,checkpoint,now=Date.now(),budget=2}){
 const agency=audience.agencySpend?.enabled||audience.agencyPurchase?.enabled;
 if(!Array.isArray(sources)||!sources.length||sources.some(s=>!s.id||!/^acct_[\w-]+$/.test(s.binding))||new Set(sources.map(s=>s.id)).size!==sources.length||new Set(sources.map(s=>s.binding)).size!==sources.length||!sources.some(s=>s.id===current))throw Error('No se pudo verificar toda la agencia');
 sources=[...sources].sort((a,b)=>a.id.localeCompare(b.id));
 const rules=Object.fromEntries(['agencySpend','modelPurchase','agencyPurchase'].filter(k=>audience[k]?.enabled).map(k=>[k,range(audience[k])]));
 if(['modelPurchase','agencyPurchase'].some(k=>rules[k]&&(!Number.isInteger(rules[k].min)||!Number.isInteger(rules[k].max)||rules[k].max>36600)))throw Error('La antigüedad de compra requiere días enteros entre 0 y 36600');
 if(!Object.keys(rules).length)return {complete:true,ids};
 if(!Array.isArray(ids)||ids.some(x=>!validId(x))||new Set(ids).size!==ids.length)throw Error('Audiencia financiera inválida');
 const signature=JSON.stringify({ids:[...ids].sort(),sources,current,rules});
 const old=checkpoint?.financial;
 let state=old?.signature===signature?structuredClone(old):{signature,at:now,index:0,offset:0,cursor:null,cursors:[],pages:0,totals:{},latest:{},modelLatest:{}};
 if(!Number.isFinite(state.at)||state.at>now||now-state.at>1800000||!Number.isInteger(state.index)||state.index<0||state.index>sources.length||!Number.isInteger(state.offset)||state.offset<0||state.offset>ids.length)throw Error('Avance financiero caducado o inválido');
 const sorted=[...ids].sort(),wanted=new Set(ids);
 const maxDays=Math.max(rules.modelPurchase?.max||0,rules.agencyPurchase?.max||0);
 const start=new Date(Math.max(Date.UTC(2016,0,1),state.at-(maxDays+1)*day)).toISOString();
 let remaining=budget;
 for(;state.index<sources.length;){
  const source=sources[state.index];
  if(rules.agencySpend&&state.offset<sorted.length){
   if(remaining--<=0)return {complete:false};
   const batch=sorted.slice(state.offset,state.offset+20),data=await read(source,'fans/spend?'+new URLSearchParams({ids:batch.join(',')}));
   if(!Array.isArray(data?.fans)||data.fans.length!==batch.length||new Set(data.fans.map(r=>String(r.fanId))).size!==batch.length)throw Error('Gasto de agencia incompleto');
   for(const fan of batch){
    const row=data.fans.find(r=>String(r.fanId)===fan),cents=Math.round(row?.total*100);
    if(row?.available!==true||typeof row.total!=='number'||!Number.isSafeInteger(cents)||cents<0||Math.abs(row.total*100-cents)>0.000001)throw Error('Gasto de agencia no disponible; no se supone cero');
    const total=(state.totals[fan]||0)+cents;if(!Number.isSafeInteger(total))throw Error('Gasto fuera de rango');state.totals[fan]=total;
   }
   state.offset+=batch.length;await save(structuredClone(state));continue;
  }
  const purchase=rules.agencyPurchase||rules.modelPurchase&&source.id===current;
  if(purchase){
   if(remaining--<=0)return {complete:false};
   const params=new URLSearchParams({start,pages:'1'});if(state.cursor)params.set('cursor',state.cursor);
   const data=await read(source,'transactions?'+params);
   if(!Array.isArray(data?.transactions)||typeof data.hasMore!=='boolean')throw Error('Histórico de compras incompleto');
   for(const row of data.transactions){
    if(!['message','post'].includes(row?.type))continue;
    // Null/unknown status cannot establish a completed purchase.
    const status=typeof row.status==='string'?row.status.toLowerCase():null;
    if(['refunded','refund','chargeback','failed','pending','cancelled','canceled'].includes(status))continue;
    const fan=String(row.user?.id),at=Date.parse(row.createdAt);
    if(!validId(fan)||!Number.isFinite(at)||typeof row.amount!=='number'||!Number.isFinite(row.amount))throw Error('Compra sin datos verificables');
    if(!wanted.has(fan)||at<Date.parse(start)||at>state.at||row.amount<=0)continue;
    if(!['paid','completed','success','successful','succeeded'].includes(status))throw Error('Estado de compra no confirmado por el proveedor');
    state.latest[fan]=Math.max(state.latest[fan]||0,at);
    if(source.id===current)state.modelLatest[fan]=Math.max(state.modelLatest[fan]||0,at);
   }
   state.pages++;
   if(data.hasMore){
    if(state.pages>=10000||typeof data.cursor!=='string'||!data.cursor||data.cursor.length>2048||state.cursors.includes(data.cursor))throw Error('Paginación de compras incompleta');
    state.cursor=data.cursor;state.cursors.push(data.cursor);await save(structuredClone(state));continue;
   }
  }
  state.index++;state.offset=0;state.cursor=null;state.cursors=[];state.pages=0;await save(structuredClone(state));
 }
 const matches=(value,r)=>value!=null&&value>=r.min&&value<=r.max;
 const age=at=>at?Math.floor((state.at-at)/day):null;
 return {complete:true,ids:ids.filter(fan=>(!rules.agencySpend||matches(state.totals[fan]/100,rules.agencySpend))&&(!rules.modelPurchase||matches(age(state.modelLatest[fan]),rules.modelPurchase))&&(!rules.agencyPurchase||matches(age(state.latest[fan]),rules.agencyPurchase))),observedAt:new Date(state.at).toISOString(),agency};
}
