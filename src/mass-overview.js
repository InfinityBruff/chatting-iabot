const states=new Set(['prepared','active','paused','stopped','completed','submitting','accepted','uncertain','cancelled']);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export function validateMassOverview(data,workspace,creator){
 if(data?.workspaceId!==workspace||data.creatorId!==creator||!Array.isArray(data.runs))throw Error('Estado de otra agencia o modelo');
 const seen=new Set();
 for(const row of data.runs){const key=JSON.stringify([row?.draftId,row?.draftVersion]);
  if(typeof row?.id!=='string'||typeof row.draftId!=='string'||!Number.isSafeInteger(row.draftVersion)||row.draftVersion<1||!['native','advanced'].includes(row.kind)||!states.has(row.state)||typeof row.started!=='boolean'||seen.has(key)||!row.counts||['targets','sent','removed','review'].some(k=>row.counts[k]!==null&&count(row.counts[k])===null)||row.kind==='native'&&(row.counts.sent!==null||row.counts.removed!==null))throw Error('Resumen de ejecución incompleto');
  seen.add(key);
 }
 return data.runs;
}
export function massRowOverview(row,runs,{verified=true}={}){
 if(row.trigger!=='mass')return {state:'draft',label:row.archived?'Archivada':'Borrador',counts:{targets:null,sent:null,removed:null,review:null}};
 if(!verified)return {state:'unknown',label:row.archived?'Archivada · estado sin verificar':'Estado sin verificar',counts:{targets:null,sent:null,removed:null,review:null}};
 const run=runs.find(x=>x.draftId===row.id&&x.draftVersion===row.version);
 const state=run?.state||'draft',review=run?.counts.review>0;
 const labels={draft:'Borrador',prepared:'Preparada · sin activar',active:'Activa / programada',paused:'Pausada',stopped:'Detenida',completed:'Completada',submitting:'Envío por confirmar',accepted:'Aceptada por OnlyFans',uncertain:'Resultado incierto',cancelled:'Cancelación confirmada'};
 return {state,label:(row.archived?'Archivada · ':'')+labels[state]+(review&&state!=='uncertain'?' · Revisar incidencias':''),counts:run?.counts||{targets:null,sent:null,removed:null,review:null}};
}
export function matchesMassState(overview,filter){
 if(filter==='all')return true;
 if(filter==='drafts')return ['draft','prepared'].includes(overview.state);
 if(filter==='active')return overview.state==='active';
 if(filter==='review')return ['accepted','submitting','uncertain'].includes(overview.state)||overview.counts.review>0;
 if(filter==='paused')return overview.state==='paused';
 if(filter==='sent')return overview.counts.sent>0||overview.state==='completed';
 return false;
}
