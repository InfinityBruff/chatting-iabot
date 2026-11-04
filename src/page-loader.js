import {mergePage} from './chat-sync.js';
import {readFailureState} from './live-page-policy.js';

// Independent read lanes: one head refresh and one cursor page. Never schedules writes.
export function createPageLoader({read,field,retain=false,initial=null,write=()=>{},cacheEpoch=()=>0,onDenied=()=>{},visible=()=>true,shouldPoll=()=>true,now=Date.now,schedule=setTimeout,cancel=clearTimeout,pollInterval=0,cancelReads=false}){
 const listeners=new Set(),lane=()=>({running:null,error:'',limited:false,waitUntil:0,retryCursor:null,retryOptions:{},failures:0,timer:null});
 let head=lane(),page=lane(),result=initial,resultStartedAt=null,resultReadIds=null,active=false,denied=false,generation=0,initialPending=!initial,pollTimer=null,pageRevision=0,lastCursor=null,latencyMs=1000,authorizedEpoch=cacheEpoch(),snapshot;
 function emit(){snapshot={result,resultStartedAt:result?resultStartedAt:null,resultReadIds:result?resultReadIds:null,error:page.error||head.error,busy:initialPending||!!page.running||!!head.running&&(!retain||!result),refreshing:retain&&!!head.running&&!!result,refreshWaiting:head.limited&&!!result,waiting:page.limited||head.limited&&(!retain||!result),pageBusy:!!page.running,pageWaiting:page.limited,requestCursor:page.running?.cursor||lastCursor,pageRevision,latencyMs};for(const listener of listeners)listener()}
 const clearTimers=()=>{cancel(pollTimer);cancel(head.timer);cancel(page.timer)};
 const abortReads=()=>{head.running?.controller?.abort();page.running?.controller?.abort()};
 function revalidate(){
  // Another scope may revoke access and invalidate the shared cache while this
  // read is pending. Discard both lanes, then authorize a fresh head read.
  generation++;clearTimers();abortReads();head=lane();page=lane();result=null;initialPending=true;pageRevision=0;lastCursor=null;authorizedEpoch=cacheEpoch();emit();void load();poll();
 }
 function deny(error){if(!active||denied)return;denied=true;generation++;clearTimers();abortReads();head.running=page.running=null;head.limited=page.limited=false;result=null;head.error=error;page.error='';onDenied();emit()}
 function retry(target,cursor,options){cancel(target.timer);target.timer=schedule(()=>{if(!active||denied)return;if(!visible()){retry(target,cursor,options);return}void load(cursor,options)},Math.min(2147483647,Math.max(1000,target.waitUntil-now())))}
 async function load(cursor=null,options={}){
  const target=cursor?page:head;
  if(!active||denied||!visible()||target.running||target.limited&&now()<target.waitUntil)return false;
  const gen=generation,epoch=cacheEpoch(),token={cursor:cursor||null,...(cancelReads?{controller:new AbortController()}: {})},startedAt=now();
  const valid=()=>active&&!denied&&generation===gen&&cacheEpoch()===epoch;
  cancel(target.timer);target.running=token;target.error='';target.limited=false;initialPending=false;if(cursor)lastCursor=cursor;emit();
  try{
   // Saved profiles have no message previews or usable cursor yet: their first
   // remote page is an opening read, not a background refresh.
   let next=await read(cursor,retain&&!cursor&&!!result&&!result.cachedProfiles,valid,undefined,false,token.controller?.signal,options);
   if(!valid())return false;
   if(field==='conversations'&&Array.isArray(next?.data?.conversations))next={...next,data:{...next.data,conversations:next.data.conversations.map(f=>({...f,profileSnapshot:false}))}};
   authorizedEpoch=epoch;result=mergePage(result,next,field,{append:!!cursor,retain});resultStartedAt=startedAt;resultReadIds=field==='messages'&&Array.isArray(next?.data?.messages)?[...new Set(next.data.messages.map(message=>message?.id).filter(id=>id!=null).map(String))]:null;write(result,epoch);
   if(cursor)pageRevision++;
   target.error='';target.limited=false;target.waitUntil=0;target.retryCursor=null;target.retryOptions={};target.failures=0;
   const elapsed=Math.max(1,now()-startedAt);latencyMs=Math.max(500,Math.min(15000,Math.round(latencyMs*.4+elapsed*.6)));
   return true;
  }catch(error){
   if(!valid())return false;
   const failure=readFailureState(error,now());
   if(failure.denied){deny(failure.error);return false}
   target.error=failure.error;target.limited=failure.waiting;target.retryCursor=cursor||null;target.retryOptions=options;target.waitUntil=failure.retryAt;target.failures=failure.waiting?0:Math.min(target.failures+1,4);
   if(cursor&&!failure.waiting&&error?.name!=='AbortError')target.waitUntil=Math.max(target.waitUntil,now()+Math.min(120000,5000*2**target.failures));
   if(failure.waiting||cursor&&error?.name!=='AbortError')retry(target,cursor,options);
   return false;
  }finally{if(active&&!denied&&generation===gen&&target.running===token){if(cacheEpoch()!==epoch)revalidate();else{target.running=null;emit()}}}
 }
 function poll(){cancel(pollTimer);if(!active||denied||!pollInterval)return;const gen=generation;pollTimer=schedule(async()=>{if(gen!==generation)return;if(active&&visible()&&shouldPoll())await load();if(gen===generation)poll()},Math.max(pollInterval*2**head.failures,head.waitUntil-now()))}
 emit();
 return {
  getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},load,deny,
  start(){if(active)return;active=true;denied=false;generation++;head=lane();page=lane();initialPending=!result;authorizedEpoch=cacheEpoch();void load();poll()},
  stop(){active=false;generation++;clearTimers();abortReads();head.running=page.running=null},
  resume(){if(!active||denied)return;if(page.retryCursor&&now()>=page.waitUntil)void load(page.retryCursor,page.retryOptions);if(shouldPoll()||!result)void load()},
  update(fn){if(!active||denied||authorizedEpoch!==cacheEpoch())return;const next=fn(result);if(next===result)return;result=next;write(result,cacheEpoch());emit()}
 };
}
