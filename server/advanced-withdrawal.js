// Exact delivery IDs come from the private cloud queue. No caller-supplied fan/message IDs.
const numeric=x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x)&&Number.isSafeInteger(Number(x));
export async function withdrawAdvanced({job,store,providerKey,fetcher=fetch,enabled=false}){
 if(!enabled)return {state:'disabled'};
 if(!job?.id||!/^acct_[A-Za-z0-9_-]+$/.test(job.binding)||!numeric(job.fan)||!numeric(job.messageId)||!['all','unread'].includes(job.mode))throw Error('Retirada sin ámbito verificable');
 const allowed=async()=>{if(await store.authorize(job)!==true)throw Error('Retirada sin autorización vigente')};
 await allowed();
 const path='https://api.ofmapi.com/v1/accounts/'+job.binding+'/conversations/'+job.fan+'/messages/'+job.messageId;
 const options={headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(15000)};
 let message;
 try{const r=await fetcher(path,{...options,method:'GET'});if(!r.ok)throw Error('Lectura no confirmada');message=await r.json()}catch{await store.finish(job,'blocked');return {state:'blocked'}}
 if(String(message.id)!==job.messageId||message.isFromMe!==true){await store.finish(job,'blocked');return {state:'blocked'}}
 // Do not remove purchased PPV; null read status is not treated as unread.
 if(message.isOpened===true||job.mode==='unread'&&message.seenByFan===true){await store.finish(job,'skipped');return {state:'skipped'}}
 if(job.mode==='unread'&&message.seenByFan!==false){await store.finish(job,'blocked');return {state:'blocked'}}
 await allowed();if(!await store.begin(job))return {state:'not_claimed'};
 let state='uncertain';
 try{const r=await fetcher(path,{...options,method:'DELETE',signal:AbortSignal.timeout(20000)});const body=r.ok?await r.json():null;
  if(r.ok&&body?.success===true&&(body.messageId==null||String(body.messageId)===job.messageId))state='removed';
  else if(r.ok&&body?.success===false)state='blocked';
 }catch{}
 await store.finish(job,state);return {state};
}
