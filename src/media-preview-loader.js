// Shared, memory-only image queue. A failed thumbnail must not fan out into
// hundreds of signed-URL requests (the media proxy has its own rate limit).
export function previewSources(item,large=false){
 if(item.canView===false)return [];
 const candidates=large?[...(item.previewSources||[])].reverse().concat(item.preview):[item.preview,...(item.previewSources||[])];
 if(['photo','gif'].includes(item.type)&&!item.convertedToVideo)candidates.push(item.url);
 return [...new Set(candidates.filter(Boolean))];
}
export function createMediaPreviewLoader({createImage=()=>new Image(),now=Date.now,schedule=setTimeout,cancel=clearTimeout,concurrency=3,budget=72,windowMs=60000,maxEntries=128,ttl=120000}={}){
 const entries=new Map(),queue=[],resets=new Set();let active=0,starts=[],blockedUntil=0,failures=0,timer=null,sequence=0;
 const waiting=()=>Math.max(blockedUntil,starts.length>=budget?starts[0]+windowMs:0);
 function prune(){const time=now();starts=starts.filter(t=>time-t<windowMs);for(const [key,row]of entries)if(!row.listeners.size&&row.state!=='loading'&&(time-row.at>ttl||entries.size>maxEntries)){entries.delete(key)}}
 function emit(row,state,src){row.state=state;row.src=src;row.at=now();for(const fn of row.listeners)fn({state,src})}
 function finish(row,ok){
  if(row.state!=='loading')return;cancel(row.timeout);row.image.onload=row.image.onerror=null;if(!ok)row.image.src='';row.image=null;active--;
  if(ok){row.element=null;failures=0;emit(row,'ready',row.sources[row.index])}
  else{
   failures++;if(failures>=4){blockedUntil=Math.max(blockedUntil,now()+30000);failures=0}
   // At most one alternative, through the same queue and rolling budget.
   // Never walk every variant of every failed file at once.
   if(row.index===0&&row.sources.length>1){row.index++;emit(row,'queued');queue.push(row)}else{row.element=null;emit(row,'error')}
  }
  pump();
 }
 function pump(){
  cancel(timer);timer=null;prune();
  queue.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);
  while(queue.length&&active<concurrency){
   if(waiting()>now()){timer=schedule(pump,Math.max(1,waiting()-now()));return}
   const row=queue.shift();if(entries.get(row.key)!==row)continue;if(!row.listeners.size){entries.delete(row.key);continue}
   active++;starts.push(now());row.state='loading';row.image=row.element||createImage();row.image.referrerPolicy='no-referrer';row.image.decoding='async';
   row.image.onload=()=>finish(row,true);row.image.onerror=()=>finish(row,false);row.timeout=schedule(()=>finish(row,false),20000);row.image.src=row.sources[row.index];
  }
 }
 return {
  subscribe(sources,listener,{priority=0,retry=false,element}={}){
   const key=sources.join('|');if(!key){listener({state:'unavailable'});return()=>{}}
   prune();let row=entries.get(key);
   if(row&&row.state==='error'&&retry){entries.delete(key);row=null}
   if(!row){row={key,sources:[...sources],index:0,state:'queued',priority,element,sequence:sequence++,listeners:new Set(),at:now()};entries.set(key,row);queue.push(row)}
   row.priority=Math.max(row.priority,priority);row.listeners.add(listener);listener({state:row.state,src:row.src});pump();
   return()=>{row.listeners.delete(listener);if(!row.listeners.size&&row.state==='queued')entries.delete(key);if(!row.listeners.size&&row.state==='loading'){cancel(row.timeout);row.image.onload=row.image.onerror=null;row.image.src='';row.image=null;row.state='cancelled';entries.delete(key);active--;pump()}};
  },
  onReset(listener){resets.add(listener);return()=>resets.delete(listener)},
  clear(){cancel(timer);timer=null;queue.length=0;for(const row of entries.values()){cancel(row.timeout);row.state='cancelled';if(row.image){row.image.onload=row.image.onerror=null;row.image.src='';row.image=null}}entries.clear();active=0;for(const listener of resets)listener();/* Keep the rolling request budget across access changes. */},
 };
}
export const mediaPreviews=createMediaPreviewLoader();
