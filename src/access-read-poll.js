// Authorization remains fresh on every visible read; hidden tabs do not poll.
export function startAccessReadPoll({read,onValue,onError,visible=()=>document.visibilityState==='visible',interval=5000,maxDelay=60000,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
 let active=true,running=false,timer=null,failures=0,nextAt=0;
 const queue=()=>{cancel(timer);if(active&&visible())timer=schedule(run,Math.max(0,nextAt-now()))};
 async function run(){
  if(!active||running||!visible())return;
  if(now()<nextAt){queue();return}
  running=true;
  try{const value=await read();if(!active)return;failures=0;nextAt=now()+interval;onValue(value)}
  catch(error){if(!active)return;failures=Math.min(failures+1,4);const status=Number(error?.status),retry=Number(error?.retryAfter);const temporary=!status||status===429||status>=500;nextAt=now()+Math.max(temporary?Math.min(maxDelay,interval*2**failures):interval,Number.isFinite(retry)&&retry>0?retry*1000:0);onError(error)}
  finally{running=false;queue()}
 }
 void run();
 return {resume(){if(!active||!visible())return;if(!failures)nextAt=0;void run()},stop(){active=false;cancel(timer)}};
}
