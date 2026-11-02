// Only explicit GET-backed operations enter this scheduler. Writes are never queued or replayed.
export const secondaryReads=new Set(['profile','presence','notifications','fan_profile','fan_history','fan_spend','fan_spend_batch','fan_activity']);
export function createReadScheduler({schedule=setTimeout,cancel=clearTimeout,settleMs=150,backgroundInterval=2500,now=Date.now}={}){
 let foreground=0,background=false,timer,lastBackground=-Infinity,blockedUntil=0,quota=null;const waiting=[];
 const aborted=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 const reserve=()=>quota&&quota.reset*1000>now()&&quota.remaining!==null&&quota.remaining<=Math.max(3,Math.ceil(quota.limit*.2))?Math.max(0,quota.reset*1000-now()):0;
 const interval=()=>quota?.limit>0&&quota.window>0?Math.max(backgroundInterval,Math.ceil(quota.window*1000/quota.limit)*3):backgroundInterval;
 const wake=()=>{cancel(timer);if(!foreground&&!background&&waiting.length)timer=schedule(drain,Math.max(settleMs,lastBackground+interval()-now(),blockedUntil-now(),reserve()))};
 async function drain(){timer=undefined;if(foreground||background)return;if(blockedUntil>now()||reserve()>0){wake();return}let job;
  while(waiting.length){const next=waiting.shift();if(next.active()){job=next;break}next.reject(aborted())}
  if(!job)return;background=true;lastBackground=now();
  try{job.resolve(await job.run())}catch(e){job.reject(e)}finally{background=false;wake()}
 }
 return {
  async primary(run,active=()=>true){if(!active())throw aborted();if(blockedUntil>now())throw Object.assign(Error('El proveedor limita las consultas. Espera antes de actualizar.'),{status:429,retryAfter:Math.ceil((blockedUntil-now())/1000)});foreground++;cancel(timer);try{return await run()}finally{foreground--;wake()}},
  secondary(run,active=()=>true){return new Promise((resolve,reject)=>{waiting.push({run,active,resolve,reject});wake()})},
  block(seconds){if(Number.isFinite(seconds)&&seconds>0){blockedUntil=Math.max(blockedUntil,now()+seconds*1000);wake()}},
  observeQuota(value){if(!Number.isInteger(value?.limit)||value.limit<1||!Number.isInteger(value.window)||value.window<1)return;const remaining=Number.isInteger(value.remaining)&&value.remaining>=0?value.remaining:null,reset=Number.isInteger(value.reset)?value.reset:0;quota={limit:value.limit,window:value.window,reset,remaining:quota?.reset===reset&&quota.remaining!==null&&remaining!==null?Math.min(quota.remaining,remaining):remaining};if(remaining===0&&reset*1000>now())blockedUntil=Math.max(blockedUntil,reset*1000);wake()},
 };
}
export const liveReads=createReadScheduler();
