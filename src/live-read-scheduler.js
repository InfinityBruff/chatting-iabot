// Chat reads start immediately. Secondary reads share one lane and yield to chat.
// Only explicitly listed GET-backed operations use this scheduler; writes never enter it.
export const secondaryReads=new Set(['profile','presence','notifications','fan_profile','fan_history','fan_spend','fan_spend_batch','fan_activity']);
export function createReadScheduler({schedule=setTimeout,cancel=clearTimeout,settleMs=150}={}){
 let foreground=0,background=false,timer;const waiting=[];
 const aborted=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 const wake=()=>{cancel(timer);if(!foreground&&!background&&waiting.length)timer=schedule(drain,settleMs)};
 async function drain(){timer=undefined;if(foreground||background)return;let job;
  while(waiting.length){const next=waiting.shift();if(next.active()){job=next;break}next.reject(aborted())}
  if(!job)return;background=true;
  try{job.resolve(await job.run())}catch(e){job.reject(e)}finally{background=false;wake()}
 }
 return {
  async primary(run,active=()=>true){if(!active())throw aborted();foreground++;cancel(timer);try{return await run()}finally{foreground--;wake()}},
  secondary(run,active=()=>true){return new Promise((resolve,reject)=>{waiting.push({run,active,resolve,reject});wake()})},
 };
}
export const liveReads=createReadScheduler();
