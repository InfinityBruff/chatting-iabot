// Only explicitly listed GET-backed reads enter this scheduler. Writes bypass it.
export const secondaryReads=new Set(['profile','presence','notifications','fan_profile','fan_history','fan_spend','fan_spend_batch','fan_activity']);
export function createReadScheduler({schedule=setTimeout,cancel=clearTimeout,settleMs=150,backgroundInterval=2500,minimumGap=200,backgroundIdle=0,startupGrace=0,now=Date.now,visible=()=>typeof document==='undefined'||document.visibilityState==='visible'}={}){
 let running=false,timer,lastRead=-Infinity,lastBackground=-Infinity,lastPrimary=-Infinity,blockedUntil=0,quota=null;const primary=[],secondary=[],started=now();
 const aborted=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 const limited=()=>Object.assign(Error('El proveedor limita las consultas. Espera antes de actualizar.'),{status:429,retryAfter:Math.max(1,Math.ceil((blockedUntil-now())/1000))});
 const reserve=()=>quota&&quota.reset*1000>now()&&quota.remaining!==null&&quota.remaining<=Math.max(3,Math.ceil(quota.limit*.2))?quota.reset*1000-now():0;
 const spacing=()=>quota?.limit>0&&quota.window>0?Math.max(backgroundInterval,Math.ceil(quota.window*1000/quota.limit)*3):backgroundInterval;
 const prune=queue=>{while(queue.length&&!queue[0].active())queue.shift().reject(aborted())};
 const idleWait=()=>Math.max(0,started+startupGrace-now(),lastPrimary+backgroundIdle-now());
 function wake(){cancel(timer);if(running)return;prune(primary);prune(secondary);if(!primary.length&&!secondary.length)return;const delay=Math.max(visible()?0:1000,lastRead+minimumGap-now(),blockedUntil-now(),primary.length?0:Math.max(settleMs,lastBackground+spacing()-now(),idleWait(),reserve()));if(delay===0)void drain();else timer=schedule(drain,Math.min(2147483647,delay))}
 async function drain(){timer=undefined;if(running)return;prune(primary);prune(secondary);const urgent=primary.length>0;if(!visible()){wake();return}if(blockedUntil>now()||!urgent&&(reserve()>0||idleWait()>0)){wake();return}const job=(urgent?primary:secondary).shift();if(!job)return;running=true;lastRead=now();if(!urgent)lastBackground=now();try{job.resolve(await job.run())}catch(e){job.reject(e)}finally{if(urgent)lastPrimary=now();running=false;wake()}}
 const enqueue=(queue,run,active=()=>true,priority='interactive')=>new Promise((resolve,reject)=>{if(!active()){reject(aborted());return}if(queue===primary&&blockedUntil>now()){reject(limited());return}queue.push({run,active,resolve,reject,rank:({interactive:0,pagination:1,refresh:2})[priority]??0});if(queue===primary)queue.sort((a,b)=>a.rank-b.rank);wake()});
 return {
  primary:(run,active,priority)=>enqueue(primary,run,active,priority),secondary:(run,active)=>enqueue(secondary,run,active),
  block(seconds){if(Number.isFinite(seconds)&&seconds>0){blockedUntil=Math.max(blockedUntil,now()+seconds*1000);wake()}},
  observeQuota(value){if(!Number.isInteger(value?.limit)||value.limit<1||!Number.isInteger(value.window)||value.window<1)return;const remaining=Number.isInteger(value.remaining)&&value.remaining>=0?value.remaining:null,reset=Number.isInteger(value.reset)?value.reset:0;quota={limit:value.limit,window:value.window,reset,remaining:quota?.reset===reset&&quota.remaining!==null&&remaining!==null?Math.min(quota.remaining,remaining):remaining};if(remaining===0&&reset*1000>now())blockedUntil=Math.max(blockedUntil,reset*1000);wake()},
 };
}
export const liveReads=createReadScheduler({backgroundIdle:4000,startupGrace:1500});
