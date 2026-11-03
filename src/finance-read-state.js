// A category never competes with the first summary reads on a cold model.
export function financialSummarySettled(states){
 return states.length===3&&states.every(state=>!state.busy&&!state.waiting&&(state.result!=null||!!state.error));
}
export function financialReadStatus(state){
 if(state.waiting)return {role:'status',text:'En espera del proveedor. Se reintentará automáticamente.'};
 if(state.busy)return {role:'status',text:'Consultando…'};
 if(state.error)return {role:'alert',text:state.error};
 return null;
}
