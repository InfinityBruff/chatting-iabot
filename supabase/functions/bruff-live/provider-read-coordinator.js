const providerRead=(url,options)=>{try{const u=new URL(url);return u.origin==='https://api.ofmapi.com'&&u.pathname.startsWith('/v1/accounts/')&&(options.method||'GET').toUpperCase()==='GET'?u:null}catch{return null}};
export function createProviderReadCache({now=Date.now,maxEntries=32,maxBytes=4*1024*1024}={}){
 const rows=new Map();let bytes=0;
 return {
  get(key){const row=rows.get(key);if(!row)return null;if(row.until<=now()){rows.delete(key);bytes-=row.bytes.length;return null}return new Response(row.bytes.slice(),{status:200,headers:row.headers})},
  async put(key,response,ttl){if(!response.ok||ttl<=0)return;const declared=Number(response.headers.get('content-length'));if(declared>512*1024)return;const body=new Uint8Array(await response.clone().arrayBuffer());if(body.length>512*1024)return;const previous=rows.get(key);if(previous)bytes-=previous.bytes.length;rows.delete(key);rows.set(key,{bytes:body,headers:[...response.headers],until:now()+ttl});bytes+=body.length;while(rows.size>maxEntries||bytes>maxBytes){const oldest=rows.keys().next().value;bytes-=rows.get(oldest).bytes.length;rows.delete(oldest)}}
 };
}
export function coordinateProviderReads({fetcher,slot,cache,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWait=8000}){
 return async(url,options={})=>{
  const u=providerRead(url,options);if(!u||!slot)return fetcher(url,options);
  const head=/\/inbox$/.test(u.pathname),messages=/\/conversations\/\d+$/.test(u.pathname),ttl=head?5000:messages?(u.searchParams.has('cursor')?15000:4000):0;
  const {readPriority,...providerOptions}=options;
  const key=u.href,priority=readPriority==='background'?'background':head||messages?'foreground':'background',deadline=now()+maxWait,ticket=crypto.randomUUID();let token,queued=false;
  try{
  while(!token){
   if(ttl){const hit=cache?.get(key);if(hit)return hit}
   if(options.signal?.aborted)throw options.signal.reason||Error('read_slot');
   queued=true;const state=await slot('acquire',ticket,priority);
   if(state?.allowed===true&&typeof state.lease==='string'&&/^[0-9a-f-]{36}$/i.test(state.lease))token=state.lease;
   else if(state?.allowed===false&&Number.isInteger(state.retryAfterMs)&&state.retryAfterMs>=50&&state.retryAfterMs<=1000){if(now()>=deadline)return new Response(JSON.stringify({code:'bruff.read_busy'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':'1'}});await sleep(Math.min(state.retryAfterMs,Math.max(1,deadline-now())))}
   else throw Error('read_slot');
  }
  if(ttl){const hit=cache?.get(key);if(hit)return hit}const response=await fetcher(url,providerOptions);if(ttl)await cache?.put(key,response,ttl);return response}
  finally{if(token||queued)try{await slot(token?'release':'cancel',token||ticket,priority)}catch{console.error(JSON.stringify({event:'bruff_read_slot_release_failure'}))}}
 };
}
