export function automationStatus(row,now=Date.now()){
 if(row.status==='active'&&row.type==='mass'&&row.schedule==='scheduled'&&Date.parse(row.at)>now)return {label:'Programada',tone:'scheduled'};
 return ({draft:{label:'Borrador',tone:'draft'},active:{label:'Activa',tone:'active'},paused:{label:'Pausada',tone:'paused'},completed:{label:'Completada',tone:'completed'},error:{label:'Revisión necesaria',tone:'error'}})[row.status]||{label:'Sin confirmar',tone:'error'};
}
export const deliveryCount=(row,key)=>Number.isSafeInteger(row.counts?.[key])&&row.counts[key]>=0?row.counts[key]:0;
export function automationSummary(rows,type){
 const scope=type?rows.filter(r=>r.type===type):rows;
 return {active:scope.filter(r=>!r.archived&&r.status==='active').length,drafts:scope.filter(r=>!r.archived&&r.status==='draft').length,sent:scope.reduce((sum,r)=>sum+deliveryCount(r,'sent'),0),review:scope.filter(r=>!r.archived&&(r.status==='error'||deliveryCount(r,'uncertain')>0)).length};
}
export function automationRows(rows,type,filter){return rows.filter(r=>(!type||r.type===type)&&(filter==='archived'?r.archived:!r.archived)&&(filter==='active'?r.status==='active':filter==='drafts'?r.status==='draft':filter==='paused'?r.status==='paused':filter==='sent'?deliveryCount(r,'sent')>0||r.status==='completed':true))}
