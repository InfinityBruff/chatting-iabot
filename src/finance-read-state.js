// A category never competes with the first summary reads on a cold model.
export function financialReadSettled(state){return !state.denied&&!state.busy&&!state.waiting&&(state.result!=null||!!state.error)}
export function financialSummarySettled(states){
 return states.length===3&&states.every(financialReadSettled);
}
export function financialReadStatus(state){
 if(state.waiting)return {role:'status',text:'En espera del proveedor. Se reintentará automáticamente.'};
 if(state.busy&&state.queued)return {role:'status',text:'Esperando turno de lectura…'};
 if(state.busy)return {role:'status',text:'Consultando…'};
 if(state.error)return {role:'alert',text:state.error};
 return null;
}
