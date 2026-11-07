import {createAiEventsHandler} from './handler.js';

const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
let base;
try{const value=new URL(url);if(value.protocol==='https:'&&!value.username&&!value.password&&!value.search&&!value.hash&&['','/'].includes(value.pathname))base=value.origin}catch{}
function warmDispatch(result){
 const runtime=globalThis.EdgeRuntime;
 if(result?.accepted!==true||result.queued!==true||typeof result.jobId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(result.jobId)||typeof runtime?.waitUntil!=='function')return;
 // The durable queue is authoritative. This optional wake-up does not delay
 // OFMAPI's acknowledgement, expose the job or retry a failed invocation.
 try{runtime.waitUntil(fetch(base+'/functions/v1/bruff-ai-runner',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({job_id:result.jobId.toLowerCase()})}).then(async response=>{await response.body?.cancel()}).catch(()=>{}))}catch{}
}
async function enqueue(event){
 if(!base||typeof serviceKey!=='string'||!serviceKey||/[\s,]/u.test(serviceKey))throw Error('event_store_unavailable');
 const signal=AbortSignal.timeout(3000),response=await fetch(base+'/rest/v1/rpc/bruff_ai_event_ingest',{method:'POST',redirect:'error',signal,headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({event})});
 if(!response.ok)throw Error('event_store_unavailable');
 const reader=response.body?.getReader();if(!reader)throw Error('event_store_unavailable');
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});let raw='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 try{signal.throwIfAborted();while(true){const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;bytes+=value.byteLength;if(bytes>16384){cancel();throw Error('event_store_unavailable')}raw+=decoder.decode(value,{stream:true})}const result=JSON.parse(raw+decoder.decode());warmDispatch(result);return result}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock()}
}
Deno.serve(createAiEventsHandler({
 enabled:Deno.env.get('BRUFF_AI_AUTOPILOT_ENABLED')==='true',
 webhookSecret:Deno.env.get('OFMAPI_WEBHOOK_SECRET'),
 previousWebhookSecret:Deno.env.get('OFMAPI_WEBHOOK_SECRET_PREVIOUS'),
 enqueue,
}));
