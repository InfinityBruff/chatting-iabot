export function readFailureState(error,now=Date.now()){
 const waiting=error?.status===429,denied=error?.status===401||error?.status===403;
 const seconds=Number(error?.retryAfter);
 return {waiting,denied,error:waiting||error?.name==='AbortError'?'':error?.message||'No se pudieron consultar los datos.',retryAt:now+(waiting?(Number.isFinite(seconds)&&seconds>0?seconds:60):Math.max(0,seconds||0))*1000};
}
