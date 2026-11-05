const fanId=value=>typeof value==='string'&&/^\d{1,24}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
const unavailable=()=>Object.assign(Error('typing_unavailable'),{typingUnavailable:true});

// The public event catalog specifies users.typing but does not fix its payload
// schema. Accept only explicit participant/chat fields, require agreement, and
// never treat a generic payload.id or an arbitrary nested number as a fan ID.
export function typingEvent(frame,{binding,fan,now=Date.now()}){
 if(frame?.type!=='event'||!frame.event||typeof frame.event!=='object')return null;
 const event=frame.event;
 if(event.event!=='users.typing'||event.account_id!==binding||typeof event.event_id!=='string'||!event.event_id||event.event_id.length>128)return null;
 const payload=event.payload;if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
 const values=[payload.conversation_id,payload.user_id,payload.from_user_id,payload.user?.id].filter(v=>v!==undefined&&v!==null);
 if(!values.length||values.some(v=>fanId(v)!==fan))return null;
 const at=typeof event.occurred_at==='string'?Date.parse(event.occurred_at):NaN;
 if(!Number.isFinite(at)||at>now+1000||at+6000<=now)return null;
 if(payload.typing===false||payload.is_typing===false)return {eventId:event.event_id,type:'stopped'};
 return {eventId:event.event_id,type:'typing',typing:true,observedAt:new Date(at).toISOString(),expiresAt:new Date(at+6000).toISOString()};
}

// This relay is intentionally separate from the bounded REST read scheduler.
// API key and account-wide provider JWT never leave the server. Only the active
// authorized fan's transient typing flag is forwarded; no text/media/history.
export async function createTypingResponse({binding,fan,providerKey,fetcher=fetch,authorize,signal,headers={},connect=url=>new WebSocket(url),now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
 if(!/^acct_[A-Za-z0-9_-]+$/.test(binding)||!fanId(fan)||typeof authorize!=='function')throw unavailable();
 if(signal?.aborted)throw unavailable();
 const tokenResponse=await fetcher('https://api.ofmapi.com/v1/ws/token',{method:'POST',headers:{Authorization:'Bearer '+providerKey,'Content-Type':'application/json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
 if(!tokenResponse.ok){const retry=Number(tokenResponse.headers.get('Retry-After'));throw Object.assign(unavailable(),{providerStatus:tokenResponse.status,...(Number.isFinite(retry)&&retry>0?{retryAfter:Math.min(120,retry)}:{})})}
 const credentials=await tokenResponse.json();
 if(typeof credentials?.token!=='string'||!credentials.token||credentials.token.length>8192||!/^[A-Za-z0-9_.-]+$/.test(credentials.token))throw unavailable();
 if(await authorize()!==binding||signal?.aborted)throw Object.assign(Error('access'),{status:403});
 const encoder=new TextEncoder(),seen=new Set();let socket,controller,closed=false,gate=null,pending=null,flushing=false,ready=false;
 const timers=new Set();
 const later=(callback,delay)=>{if(closed)return null;const handle=schedule(()=>{timers.delete(handle);callback()},delay);timers.add(handle);return handle};
 const send=value=>{if(closed||!controller)return false;try{if(controller.desiredSize!==null&&controller.desiredSize<0){close();return false}controller.enqueue(encoder.encode('data: '+JSON.stringify(value)+'\n\n'));return true}catch{close();return false}};
 function close(type){if(closed)return;if(type)send({type});closed=true;pending=null;for(const timer of timers)cancel(timer);timers.clear();signal?.removeEventListener('abort',aborted);try{socket?.close(1000,'finished')}catch{}try{controller?.close()}catch{}}
 const aborted=()=>close();
 async function allowed(){
  if(closed)return false;
  if(!gate)gate=(async()=>{try{if(await authorize()!==binding){close('denied');return false}return !closed}catch(error){close(error?.status===401||error?.status===403||error?.message==='access'?'denied':'unavailable');return false}})().finally(()=>{gate=null});
  return gate;
 }
 async function flush(){
  if(flushing||closed)return;flushing=true;
  try{while(pending&&!closed){if(!await allowed())return;if(closed||!pending)return;const next=pending;pending=null;if(next.type==='typing'&&Date.parse(next.expiresAt)<=now())continue;send(next)}}finally{flushing=false}
 }
 function receive(raw){
  if(closed||typeof raw!=='string'||raw.length>16384)return;
  let frame;try{frame=JSON.parse(raw)}catch{return}
  if(frame?.type==='error'){close('unavailable');return}
  if(frame?.type==='subscribed'){if(!ready){ready=true;send({type:'ready'})}return}
  const event=typingEvent(frame,{binding,fan,now:now()});if(!event||seen.has(event.eventId))return;
  seen.add(event.eventId);if(seen.size>64)seen.delete(seen.values().next().value);
  const {eventId,...value}=event;pending=value;void flush();
 }
 const body=new ReadableStream({start(value){controller=value;signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted){close();return}
  try{socket=connect('wss://gateway.ofmapi.com/v1/ws?token='+encodeURIComponent(credentials.token))}catch{close('unavailable');return}
  socket.onopen=()=>{if(closed)return;try{socket.send(JSON.stringify({type:'subscribe',account_id:binding,events:['users.typing']}))}catch{close('unavailable')}};
  socket.onmessage=event=>receive(event.data);socket.onerror=()=>close('unavailable');socket.onclose=()=>close('unavailable');
  later(()=>{if(!ready)close('unavailable')},10000);
  const verify=async()=>{if(await allowed()&&!closed)later(verify,5000)};later(verify,5000);
  const heartbeat=()=>{if(!closed){send({type:'heartbeat'});later(heartbeat,15000)}};later(heartbeat,15000);
  // Below the Free plan wall-clock limit; the client reconnects with backoff.
  later(()=>close('reconnect'),120000);
 },cancel(){close()}});
 return new Response(body,{status:200,headers:{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
