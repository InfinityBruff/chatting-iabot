// One read-ahead page for the open conversation only. Memory-only and epoch scoped.
export function createHistoryReader({read,cacheEpoch=()=>0,visible=()=>true,onDenied=()=>{},schedule=setTimeout,cancel=clearTimeout,now=Date.now,delay=350,ttl=30000,maxBytes=2097152}){
 let active=false,generation=0,stage=null,attempted=null,demanding=0;
 const abort=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 function discard(){if(stage){stage.active=false;cancel(stage.timer);stage=null}}
 function prepare(result,epoch=cacheEpoch()){
  const cursor=result?.data?.hasMore&&result.data.cursor;
  if(!active||epoch!==cacheEpoch()||!visible()||demanding)return;
  if(!cursor){discard();attempted=null;return}
  if(stage?.cursor===cursor&&stage.epoch===epoch||attempted===cursor)return;
  discard();attempted=cursor;
  const gen=generation,item={cursor,epoch,active:true,started:false,value:null,at:0,promise:null,timer:null};stage=item;
  const valid=()=>active&&generation===gen&&item.active&&cacheEpoch()===epoch;
  item.timer=schedule(()=>{
   if(!valid()||!visible()){if(stage===item){discard();attempted=null}return}
   item.promise=Promise.resolve().then(()=>valid()&&visible()?read(cursor,true,valid,()=>{item.started=true},true):null).then(value=>{
    if(!value||!valid()||JSON.stringify(value).length*2>maxBytes)return null;
    item.value=value;item.at=now();return value;
   }).catch(error=>{if(valid()&&(error?.status===401||error?.status===403))onDenied(error);return null});
  },delay);
 }
 return {
  start(){if(active)return;active=true;generation++;attempted=null},
  stop(){active=false;generation++;discard();attempted=null},
  prepare,
  async read(cursor,background,valid){
   if(cursor)demanding++;
   try{
   const item=stage;
   if(cursor&&item?.cursor===cursor){
    if(item.epoch!==cacheEpoch()){discard()}
    else if(item.value&&now()-item.at<=ttl){const value=item.value;discard();if(!valid())throw abort();return value}
    else if(item.promise&&item.started&&!item.value){const value=await item.promise;if(stage===item)discard();if(!valid())throw abort();if(value)return value}
    else discard(); // A queued preparation never makes an explicit history request wait.
   }
   if(!valid())throw abort();return await read(cursor,background,valid);
   }finally{if(cursor)demanding--}
  }
 };
}
