// An optional wake-up only. SQL owns the durable queue and Cron is the fallback.
// No user token, actor, binding, message or arbitrary URL crosses this boundary.
export function createWorkerDispatch({url,serviceKey,fetcher=fetch,runtime=globalThis.EdgeRuntime}={}){
 let base;
 try{const value=new URL(url);if(value.protocol==='https:'&&!value.username&&!value.password&&!value.search&&!value.hash&&['','/'].includes(value.pathname))base=value.origin}catch{}
 return jobId=>{
  if(!base||typeof runtime?.waitUntil!=='function'||typeof serviceKey!=='string'||!serviceKey||/[\s,]/u.test(serviceKey)||typeof jobId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(jobId))throw Error('background_unavailable');
  runtime.waitUntil(fetcher(base+'/functions/v1/bruff-ai-runner',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({job_id:jobId.toLowerCase()})}).then(async response=>{await response.body?.cancel()}).catch(()=>{}));
 };
}
