// One state per authorized agency/model. Timestamps belong to individual pages,
// never to the end of a scan (which could make old confirmations look fresh).
const ttl=60000;
const fresh=(rows,now)=>Object.fromEntries(Object.entries(rows||{}).filter(([,stamp])=>{const t=Date.parse(stamp);return Number.isFinite(t)&&t<=now&&now-t<ttl}));
export function startPresenceScan(previous={},now=Date.now()){
 return {confirmations:fresh(previous.confirmations,now),cycleConfirmations:{},cursor:null,seenCursors:[],fingerprints:[],pagesScanned:0,complete:false,scanning:true,issue:null,failures:0,nextAt:now,scope:'followings'};
}
export function failPresenceScan(state,{status,retryAfter,reason}={},now=Date.now()){
 if(status===401||status===403)return {...startPresenceScan({},now),scanning:false,unavailable:true,issue:'access',nextAt:now+45000};
 const failures=(state.failures||0)+1;
 const wait=Math.max(1000,Math.min(120000,Number.isFinite(retryAfter)?retryAfter*1000:5000*2**Math.min(failures-1,4)));
 return {...state,confirmations:fresh(state.confirmations,now),complete:false,unavailable:true,issue:reason||(status===429?'rate_limit':'provider'),failures,nextAt:now+wait};
}
export function acceptPresencePage(state,data,now=Date.now()){
 if(data?.unavailable)return failPresenceScan(state,{status:data.providerStatus,retryAfter:data.retryAfter},now);
 const stamp=Date.parse(data?.checkedAt);
 if(!Array.isArray(data?.onlineIds)||!Number.isFinite(stamp)||stamp>now||typeof data.hasMore!=='boolean')return failPresenceScan(state,{reason:'schema'},now);
 const ids=[...new Set(data.onlineIds.filter(x=>typeof x==='string'&&/^\d{1,24}$/.test(x)))];
 const fingerprint=ids.slice().sort().join(',');
 // A repeated nonempty page with a new cursor is also partial, not success.
 const repeated=ids.length>0&&state.fingerprints.includes(fingerprint);
 if(repeated)return {...failPresenceScan(state,{reason:'repeated_page'},now),scanning:false,nextAt:now+45000};
 const cycle=fresh({...state.cycleConfirmations,...Object.fromEntries(ids.map(id=>[id,data.checkedAt]))},now);
 const next={...state,checkedAt:data.checkedAt,pagesScanned:state.pagesScanned+1,cycleConfirmations:cycle,confirmations:fresh({...state.confirmations,...cycle},now),fingerprints:[...state.fingerprints,fingerprint],failures:0,unavailable:false,issue:null};
 if(!data.hasMore)return {...next,confirmations:cycle,complete:true,scanning:false,cursor:null,nextAt:now+45000};
 if(!data.cursor||state.seenCursors.includes(data.cursor))return {...next,complete:false,scanning:false,issue:data.cursor?'repeated_cursor':'missing_cursor',nextAt:now+45000};
 return {...next,cursor:data.cursor,seenCursors:[...state.seenCursors,data.cursor],nextAt:now+350};
}
export function presenceStatus(state){
 if(!state)return 'Consultando presencia…';
 const pages=`${state.pagesScanned||0} páginas consultadas`;
 if(state.issue==='access')return 'Presencia sin acceso · Actualizando permisos';
 if(state.issue==='rate_limit')return `Consulta parcial · ${pages} · Esperando al proveedor para continuar`;
 if(['missing_cursor','repeated_cursor','repeated_page'].includes(state.issue))return `Consulta parcial · ${pages} · El proveedor no permite avanzar`;
 if(state.unavailable)return `Consulta parcial · ${pages} · Reintentando la página pendiente`;
 return state.complete?`Presencia actualizada · ${pages} · Recorrido completo`:`Comprobando presencia · ${pages}`;
}
