export const INBOX_WINDOW_INITIAL=40,INBOX_WINDOW_STEP=15,INBOX_WINDOW_MAX_PAGES=8;
const fanId=fan=>String(fan?.userId??fan?.id??'');
const realIds=rows=>new Set((rows||[]).filter(fan=>fan.profileSnapshot!==true).map(fanId).filter(id=>/^\d{1,24}$/.test(id)));
export const validInboxWindowLimit=value=>Number.isSafeInteger(value)&&value>=INBOX_WINDOW_INITIAL&&value<=10000?value:null;
export function restoredInboxWindowLimit(value,rows,raw){const limit=validInboxWindowLimit(value);return limit&&realIds(rows).size>=limit&&realIds(raw).size>=limit?limit:null}

// The complete provider page stays in the ordinary page cache. This controller
// changes only the number of rows revealed and requests one native cursor at a time.
export function createInboxWindow({load,initial={},savedLimit=null,onCommit=()=>{}}){
 let input=initial,active=false,running=false,request=null,committed=false,blocked=false,generation=0;
 const restored=restoredInboxWindowLimit(savedLimit,input.rows,input.result?.data?.conversations),listeners=new Set();
 let visibleLimit=restored||INBOX_WINDOW_INITIAL,phase=realIds(input.result?.data?.conversations).size>=INBOX_WINDOW_INITIAL?null:{kind:'initial',baseline:new Set(),turns:0,seen:new Set()},snapshot;
 const raw=()=>realIds(input.result?.data?.conversations),buffered=()=>Math.max(0,(input.rows?.length||0)-visibleLimit),nativeMore=()=>input.result?.data?.hasMore===true;
 function emit(){const next={visibleLimit,pending:!!phase&&!input.error,restored:!!restored,hasMore:buffered()>0||nativeMore(),canLoadMore:!phase&&!input.busy&&(buffered()>0||nativeMore()&&!!input.result?.data?.cursor&&!blocked)};if(snapshot&&Object.keys(next).every(key=>next[key]===snapshot[key]))return;snapshot=next;for(const listener of listeners)listener()}
 function finish(){phase=null;request=null;const actual=realIds(input.rows).size;onCommit(Math.max(INBOX_WINDOW_INITIAL,Math.min(visibleLimit,actual)));emit()}
 function drive(){
  if(!active||!phase||running||!committed)return;const ids=raw();
  const enough=phase.kind==='initial'?ids.size>=INBOX_WINDOW_INITIAL:realIds(input.rows).size>=visibleLimit||[...ids].filter(id=>!phase.baseline.has(id)).length>=INBOX_WINDOW_STEP;
  if(enough||blocked||input.result&&!input.result.cachedProfiles&&input.result.data?.hasMore===false){finish();return}
  if(input.error||input.busy||!input.result||input.result.cachedProfiles||request)return;
  const cursor=input.result.data?.cursor;
  if(!cursor||phase.seen.has(cursor)||phase.turns>=INBOX_WINDOW_MAX_PAGES){blocked=true;finish();return}
  const token={cursor,revision:input.pageRevision||0,generation};request=token;running=true;emit();
  const current=()=>active&&generation===token.generation;
  Promise.resolve().then(()=>{if(!current()||request!==token)return false;phase.turns++;return load(cursor,{priority:'pagination'})}).then(accepted=>{if(!current())return;token.accepted=accepted===true;if(request===token&&!accepted)request=null}).catch(()=>{if(current()&&request===token)request=null}).finally(()=>{if(!current())return;running=false;emit();if(token.accepted&&request!==token)drive()});
 }
 emit();
 return {
  getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  setInput(next){input=next;if(request&&(input.pageRevision||0)>request.revision){phase?.seen.add(request.cursor);request=null}emit();drive()},
  commit(){committed=true;drive()},
  loadMore(){if(!active||phase||!snapshot.canLoadMore)return false;visibleLimit+=INBOX_WINDOW_STEP;phase={kind:'manual',baseline:raw(),turns:0,seen:new Set()};committed=false;emit();return true},
  start(){if(active)return;active=true;generation++;drive()},
  stop(){active=false;generation++;request=null;running=false;listeners.clear()},
 };
}
