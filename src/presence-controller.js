import {startPresenceScan,acceptPresencePage,failPresenceScan,retainPresenceConfirmations} from './presence-scan.js';

// Authorization determines what can be retained. Demand determines what may be
// requested. Neither a model switch nor a hidden pane refreshes a confirmation.
export function createPresenceController({workspace,request,now=Date.now,schedule=setTimeout,cancel=clearTimeout,visible=()=>true}){
 let active=false,authorized=new Set(),demand=[],fastModel=null,states={},snapshot={},timer,running=null;
 const firstHeads=new Set(),listeners=new Set();
 const emit=()=>{states=Object.fromEntries(Object.entries(states).filter(([id])=>authorized.has(id)).map(([id,state])=>[id,retainPresenceConfirmations(state,now())]));snapshot={...states};for(const listener of listeners)listener()};
 const current=token=>active&&running===token&&authorized.has(token.id)&&demand.includes(token.id)&&!token.controller.signal.aborted&&visible();
 function wake(delay=350){cancel(timer);timer=undefined;if(active&&!running&&demand.length)timer=schedule(tick,delay)}
 async function tick(){
  timer=undefined;if(!active||running||!demand.length)return;
  if(!visible()){wake();return}
  const at=now(),id=demand.filter(id=>states[id]?.nextAt<=at).sort((a,b)=>states[a].nextAt-states[b].nextAt)[0];
  if(!id){wake();return}
  if(!states[id].scanning)states[id]=startPresenceScan(states[id],at);
  const previous=states[id],token={id,controller:new AbortController()},priority=!previous.cursor&&firstHeads.has(id)?'fan-visible':'background';
  running=token;states[id]={...previous,pending:true,queued:true};emit();
  try{
   const response=await request(workspace,'presence',{creator_id:id,...(previous.cursor?{cursor:previous.cursor}:{})},{
    active:()=>current(token),signal:token.controller.signal,priority,
    onStart:()=>{if(!current(token))return;firstHeads.delete(id);states[id]={...states[id],queued:false};emit()},
   });
   if(!current(token))return;
   firstHeads.delete(id);states[id]=acceptPresencePage(previous,response.data,now());
   if(states[id].complete&&!states[id].issue)states[id]={...states[id],completedAt:now(),nextAt:now()+(id===fastModel?3000:45000)};
  }catch(error){
   if(current(token)&&error?.name!=='AbortError')states[id]=failPresenceScan(previous,{status:error.status,retryAfter:error.retryAfter},now());
  }finally{
   if(running===token){running=null;if(states[id])states[id]={...states[id],pending:false,queued:false};if(active){emit();wake()}}
  }
 }
 return {
  getSnapshot:()=>snapshot,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  setInput(authorizedIds,demandIds,{fastModel:requestedFast=null}={}){
   const oldDemand=new Set(demand);authorized=new Set(authorizedIds.filter(id=>typeof id==='string'&&id));
   demand=[...new Set(demandIds)].filter(id=>authorized.has(id));
   fastModel=demand.includes(requestedFast)?requestedFast:null;
   for(const id of Object.keys(states))if(!authorized.has(id)){delete states[id];firstHeads.delete(id)}
   for(const id of demand){
    if(!states[id])states[id]=startPresenceScan({},now());
    if(!oldDemand.has(id)&&!states[id].cursor&&states[id].nextAt<=now())firstHeads.add(id);
   }
   for(const [id,state] of Object.entries(states))if(state.complete&&!state.issue&&Number.isFinite(state.completedAt))states[id]={...state,nextAt:state.completedAt+(id===fastModel?3000:45000)};
   for(const id of firstHeads)if(!demand.includes(id))firstHeads.delete(id);
   if(running&&(!authorized.has(running.id)||!demand.includes(running.id)))running.controller.abort();
   emit();wake(0);
  },
  start(){if(active)return;active=true;wake(0)},
  resume(){if(!visible()&&running)running.controller.abort();wake(0)},
  stop(){active=false;cancel(timer);timer=undefined;running?.controller.abort();running=null;states={};snapshot={};authorized.clear();demand=[];firstHeads.clear();for(const listener of listeners)listener()},
 };
}
