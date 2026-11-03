export const inboxCacheScope=(workspace,account)=>JSON.stringify([workspace,account,'inbox',JSON.stringify({query:'',fast:true})]);
export function startInboxWarmup({workspace,accounts,current,request,readCache,writeCache,epoch,cacheEpoch,onDenied=()=>{},schedule=setTimeout,cancel=clearTimeout}){
 let active=true,timer;const pending=accounts.filter(a=>a.chat&&a.id!==current&&!readCache(inboxCacheScope(workspace,a.id))).slice(0,2);
 const valid=()=>active&&epoch===cacheEpoch();
 async function next(){if(!valid())return;const account=pending.shift();if(!account)return;
  try{const value=await request(workspace,'inbox',{creator_id:account.id,query:'',fast:true,background:true},{priority:'prefetch',active:valid});if(valid())writeCache(inboxCacheScope(workspace,account.id),value,epoch)}
  catch(e){if(valid()&&(e.status===401||e.status===403)){onDenied();return}if(valid()&&e.status===429){pending.unshift(account);timer=schedule(next,Math.max(1000,(e.retryAfter||60)*1000));return}}
  if(valid())timer=schedule(next,1000);
 }
 timer=schedule(next,800);return()=>{active=false;cancel(timer)};
}
