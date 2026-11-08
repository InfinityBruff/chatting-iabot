// Only explicitly listed GET-backed reads enter this scheduler. Writes bypass it.
export const secondaryReads=new Set(['profile','presence','notifications','notification_heads','fan_profile','fan_history','fan_spend','fan_spend_batch','fan_activity','collections','collection_fans','collection_detail','earnings','monthly','balances','transactions']);
export const foregroundReads=new Set(['inbox','messages','vault_media','vault_categories']);
export function createReadScheduler({schedule=setTimeout,cancel=clearTimeout,settleMs=150,backgroundInterval=2500,minimumGap=200,backgroundIdle=0,startupGrace=0,maxConcurrent=1,now=Date.now,visible=()=>typeof document==='undefined'||document.visibilityState==='visible'}={}){
 let running=0,backgroundRunning=false,timer,lastRead=-Infinity,lastBackground=-Infinity,lastPrimary=-Infinity,blockedUntil=0,quota=null;const primary=[],secondary=[],started=now();
 const aborted=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 const limited=()=>Object.assign(Error('El proveedor limita las consultas. Espera antes de actualizar.'),{status:429,retryAfter:Math.max(1,Math.ceil((blockedUntil-now())/1000))});
 const reserve=()=>quota&&quota.reset*1000>now()&&quota.remaining!==null&&quota.remaining<=Math.max(3,Math.ceil(quota.limit*.2))?quota.reset*1000-now():0;
 const reserved=()=>Object.assign(Error('Espera antes de actualizar los datos del fan.'),{status:429,retryAfter:Math.max(1,Math.ceil(reserve()/1000)),readReserved:true});
 const spacing=()=>quota?.limit>0&&quota.window>0?Math.max(backgroundInterval,Math.ceil(quota.window*1000/quota.limit)*3):backgroundInterval;
 const prune=queue=>{while(queue.length&&!queue[0].active())queue.shift().reject(aborted())};
 const idleWait=()=>Math.max(0,started+startupGrace-now(),lastPrimary+backgroundIdle-now());
 const eligible=()=>running<maxConcurrent?(primary.length?primary:running===0&&!backgroundRunning&&secondary.length?secondary:null):null;
 function wake(){cancel(timer);prune(primary);prune(secondary);const queue=eligible();if(!queue)return;const urgent=queue===primary,delay=Math.max(visible()?0:1000,lastRead+minimumGap-now(),blockedUntil-now(),urgent?0:Math.max(settleMs,lastBackground+spacing()-now(),idleWait(),reserve()));if(delay===0)void drain();else timer=schedule(drain,Math.min(2147483647,delay))}
 async function drain(){timer=undefined;prune(primary);prune(secondary);const queue=eligible();if(!queue)return;const urgent=queue===primary;if(!visible()||blockedUntil>now()||lastRead+minimumGap>now()||!urgent&&(reserve()>0||idleWait()>0)){wake();return}const job=queue.shift();if(!job)return;if(urgent&&job.priority==='fan-visible'&&reserve()>0){job.reject(reserved());wake();return}running++;lastRead=now();if(!urgent){backgroundRunning=true;lastBackground=now()}try{const pending=job.run();wake();job.resolve(await pending)}catch(e){job.reject(e)}finally{if(urgent)lastPrimary=now();else backgroundRunning=false;running--;wake()}}
 const enqueue=(queue,run,active=()=>true,priority='interactive')=>new Promise((resolve,reject)=>{if(!active()){reject(aborted());return}if(queue===primary&&blockedUntil>now()){reject(limited());return}queue.push({run,active,resolve,reject,priority,rank:({conversation:-1,interactive:0,selected:.25,'fan-visible':.25,history:.5,'history-prepare':1.5,pagination:1,refresh:2,prefetch:2.5,background:3})[priority]??0});queue.sort((a,b)=>a.rank-b.rank);wake()});
 return {
  primary:(run,active,priority)=>enqueue(priority==='refresh'?secondary:primary,run,active,priority),secondary:(run,active,priority='background')=>enqueue(secondary,run,active,priority),
  block(seconds){if(Number.isFinite(seconds)&&seconds>0){blockedUntil=Math.max(blockedUntil,now()+seconds*1000);wake()}},
  observeQuota(value){if(!Number.isInteger(value?.limit)||value.limit<1||!Number.isInteger(value.window)||value.window<1)return;const remaining=Number.isInteger(value.remaining)&&value.remaining>=0?value.remaining:null,reset=Number.isInteger(value.reset)?value.reset:0;quota={limit:value.limit,window:value.window,reset,remaining:quota?.reset===reset&&quota.remaining!==null&&remaining!==null?Math.min(quota.remaining,remaining):remaining};if(remaining===0&&reset*1000>now())blockedUntil=Math.max(blockedUntil,reset*1000);wake()},
 };
}
export const liveReads=createReadScheduler({backgroundIdle:4000,startupGrace:1500,maxConcurrent:2});
