// Coordinates read cooldowns across Edge instances/users. Never retries or gates writes.
export function retrySeconds(headers,now=Date.now()){
 const raw=headers.get('retry-after');
 const seconds=/^\d+$/.test(raw||'')?Number(raw):Math.ceil((Date.parse(raw)-now)/1000);
 return Number.isFinite(seconds)?Math.max(1,Math.min(2147483647,Math.ceil(seconds))):60;
}
export function protectProviderReads({fetcher,gate,now=Date.now,onQuota=()=>{}}){
 return async(url,options={})=>{
  let providerRead=false;
  try{const u=new URL(url);providerRead=u.origin==='https://api.ofmapi.com'&&u.pathname.startsWith('/v1/accounts/')&&(options.method||'GET').toUpperCase()==='GET'}catch{}
  if(!providerRead||!gate)return fetcher(url,options);
  const state=await gate('check');
  if(typeof state?.allowed!=='boolean')throw Error('read_guard');
  if(!state.allowed){
   if(!Number.isInteger(state.retryAfter)||state.retryAfter<1)throw Error('read_guard');
   return new Response(JSON.stringify({code:'rate_limit.exceeded'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':String(state.retryAfter)}});
  }
  const response=await fetcher(url,options);
  const number=name=>{const raw=response.headers.get(name),value=Number(raw);return raw!==null&&Number.isInteger(value)&&value>=0&&value<=2147483647?value:null};
  const quota={limit:number('x-ratelimit-limit'),remaining:number('x-ratelimit-remaining'),reset:number('x-ratelimit-reset'),window:number('x-ratelimit-window')};
  if(quota.limit>0&&quota.window>0)onQuota(quota);
  let wait=0;
  if(response.status===429)wait=retrySeconds(response.headers,now());
  else if(response.ok&&response.headers.get('x-ratelimit-remaining')==='0'){
   const reset=Number(response.headers.get('x-ratelimit-reset'));
   if(Number.isFinite(reset)&&reset*1000>now())wait=Math.max(1,Math.min(2147483647,Math.ceil((reset*1000-now())/1000)));
  }
  if(wait){const saved=await gate('block',wait);if(saved?.allowed!==false||!Number.isInteger(saved.retryAfter)||saved.retryAfter<1)throw Error('read_guard')}
  return response;
 };
}
