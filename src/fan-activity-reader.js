import {mergeActivity} from './fan-activity.js';
import {readFailureState} from './live-page-policy.js';

// A single fan/model/period reader. Only confirmed rows enter the existing
// memory cache; timestamps and the partial traversal cursor survive a return.
export function createFanActivityReader({workspace,account,fan,start,request,initial=null,onCache=()=>{},onDenied=()=>{},epoch=()=>0,now=Date.now,schedule=setTimeout,cancel=clearTimeout,visible=()=>true}){
 const scope=JSON.stringify([workspace,account,String(fan),start]);if(initial?.scope!==scope)initial=null;
 const cacheEpoch=epoch();let active=false,denied=false,running=null,timer,generation=0,failures=0,limited=false,waitUntil=0;
 let cursor=initial?.cursor||null,seen=new Set(initial?.seen||[]),cycleRows=initial?.cycleRows||[],fullAt=initial?.fullAt||0,nextAt=initial?.nextAt||0;
 let state=initial?.state?{...initial.state,busy:false,waiting:false,error:''}:{rows:[],busy:true,pages:0,start,complete:false};const listeners=new Set();
 const emit=patch=>{state={...state,...patch};for(const listener of listeners)listener()};
 const current=token=>active&&running===token&&token.generation===generation&&cacheEpoch===epoch()&&!token.controller.signal.aborted;
 function wake(delay=0){cancel(timer);timer=undefined;if(active&&!denied&&!running)timer=schedule(tick,Math.max(delay,waitUntil-now(),nextAt-now()))}
 function changedAccess(){denied=true;emit({rows:[],busy:false,waiting:false,error:'El acceso ha cambiado. Vuelve a abrir la ficha.',complete:false})}
 async function tick(){
  timer=undefined;if(!active||running||denied)return;if(cacheEpoch!==epoch()){changedAccess();return}
  if(now()<Math.max(waitUntil,nextAt)){wake();return}if(!visible()){wake(30000);return}
  if(state.complete&&now()-fullAt>=300000){cursor=null;seen=new Set();cycleRows=[];emit({complete:false,pages:0,unidentified:false})}
  const token={generation,controller:new AbortController()},continuing=!state.complete&&!!cursor;
  running=token;emit({busy:true,waiting:false,error:''});
  try{
   const response=await request(workspace,'fan_activity',{creator_id:account,conversation_id:fan,start,...(continuing?{cursor}:{})},{active:()=>current(token)&&visible(),signal:token.controller.signal,priority:!state.updated&&!continuing?'fan-visible':'background'});
   if(!current(token)||!visible())return;
   if(!Array.isArray(response.data?.transactions))throw Error('El historial de movimientos no está disponible.');
   const transactions=response.data.transactions;let rows=mergeActivity(state.rows,transactions),pages=state.pages,complete=state.complete;
   if(!complete){cycleRows=mergeActivity(cycleRows,transactions);pages++;if(response.data.hasMore){if(!response.data.cursor||seen.has(response.data.cursor))throw Error('El proveedor no permite continuar este historial.');cursor=response.data.cursor;seen.add(cursor)}else{complete=true;fullAt=now();rows=cycleRows;cycleRows=[];cursor=null}}
   failures=0;limited=false;waitUntil=0;nextAt=now()+(complete?30000:1000);
   emit({rows,busy:false,pages,start,complete,unidentified:state.unidentified||transactions.some(row=>!row.id),updated:response.observedAt||new Date(now()).toISOString()});
   onCache({scope,state:{...state,busy:false},cursor,seen:[...seen],cycleRows,fullAt,nextAt});
  }catch(error){
   if(!current(token))return;
   if(error?.name==='AbortError')return;
   const failure=readFailureState(error,now());limited=failure.waiting;waitUntil=failure.retryAt;failures=limited?0:Math.min(failures+1,4);
   if(failure.denied){denied=true;emit({rows:[],busy:false,waiting:false,error:failure.error,complete:false});onDenied();return}
   const rejectedCursor=continuing&&[400,422].includes(error.providerStatus??error.status);
   if(rejectedCursor||!limited&&state.complete){cursor=null;seen=new Set();cycleRows=[];fullAt=0;emit({pages:0,unidentified:false})}
   nextAt=limited?waitUntil:now()+30000*2**failures;emit({busy:false,waiting:limited,error:failure.error,complete:limited?state.complete:false});
   // Persist only repaired traversal metadata, preserving the original row
   // timestamp and backoff, so leaving the card cannot revive a rejected cursor.
   if(rejectedCursor&&state.updated)onCache({scope,state:{...state,busy:false},cursor,seen:[],cycleRows,fullAt,nextAt:Math.max(nextAt,waitUntil)});
  }finally{
   if(running===token){running=null;if(active){if(cacheEpoch!==epoch()&&!denied)changedAccess();else emit({busy:false});wake()}}
  }
 }
 return {
  getSnapshot:()=>state,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  start(){if(active)return;active=true;wake()},
  resume(){if(!visible()&&running)running.controller.abort();wake()},
  refresh(){if(denied||!active)return;nextAt=0;wake()},
  restart(){if(denied||!active)return;generation++;running?.controller.abort();cursor=null;seen=new Set();cycleRows=[];fullAt=0;nextAt=0;failures=0;emit({complete:false,pages:0,unidentified:false,error:''});wake()},
  stop(){active=false;generation++;cancel(timer);timer=undefined;running?.controller.abort();running=null},
 };
}
