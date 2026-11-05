import {notificationCategories} from './notification-presentation.js';

// One verified user/workspace scope owns this memory-only reader. Cursor pages
// never share heads or one another. Retained heads are display seeds, not a
// longer request TTL or proof that the full notification history was read.
export function createNotificationReads(request,{now=Date.now,ttl=1500,onDenied=()=>{},maxEntries=96,maxBytes=2097152}={}){
 const entries=new Map(),versions=new Map(),listeners=new Set();let generation=0;
 const responseTtl=Number.isFinite(ttl)?Math.max(0,Math.min(1500,ttl)):1500;
 const entryLimit=Math.max(1,Math.min(96,Math.floor(maxEntries)||96)),byteLimit=Math.max(1,Math.min(2097152,Math.floor(maxBytes)||2097152));
 const aborted=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 const denied=error=>error?.status===401||error?.status===403;
 const modelKey=(workspace,model)=>typeof workspace==='string'&&workspace&&typeof model==='string'&&model?JSON.stringify([workspace,model]):null;
 const version=key=>versions.get(key)||0;
 function head(workspace,args){
  const model=args.creator_id,modelScope=modelKey(workspace,model);
  if(!modelScope||args.cursor!=null||args.type!=null&&args.type!==''&&(typeof args.type!=='string'||!Object.hasOwn(notificationCategories,args.type)))return null;
  const parameters={...args};if(parameters.type==null||parameters.type==='')delete parameters.type;if(parameters.cursor==null)delete parameters.cursor;
  return {workspace,model,modelScope,args:parameters,key:JSON.stringify([workspace,Object.keys(parameters).sort().map(name=>[name,parameters[name]])])};
 }
 const touch=row=>{entries.delete(row.key);entries.set(row.key,row)};
 function trim(){
  for(const [key,row] of entries)if(row.value&&now()-row.at>60000){row.value=null;row.bytes=0;if(!row.run)entries.delete(key)}
  let count=0,bytes=0;for(const row of entries.values())if(row.value){count++;bytes+=row.bytes}
  for(const [key,row] of entries){if(count<=entryLimit&&bytes<=byteLimit)break;if(!row.value)continue;count--;bytes-=row.bytes;row.value=null;row.bytes=0;if(!row.run)entries.delete(key)}
 }
 const pendingCurrent=(row,run)=>generation===run.epoch&&version(row.modelScope)===run.version&&entries.get(row.key)===row&&row.run===run&&!run.finished;
 const someActive=run=>[...run.consumers].some(consumer=>consumer.active());
 function finish(row,run,error,value){
  if(run.finished)return;run.finished=true;if(row.run===run)row.run=null;
  if(error){if(entries.get(row.key)===row)entries.delete(row.key);run.reject(error)}else run.resolve(value);
 }
 function notify(event){for(const listener of listeners)try{listener(event)}catch{}}
 function invalidate(workspace,model,error,source=null){
  const key=modelKey(workspace,model);if(!key)return;
  const next=version(key)+1;versions.set(key,next);
  for(const row of entries.values())if(row.modelScope===key){
   entries.delete(row.key);const run=row.run;if(!run)continue;
   if(run===source){run.denial=error;run.denialVersion=next}
   finish(row,run,run===source?error:aborted());
  }
  notify({workspace,model,error});if(denied(error))try{onDenied(workspace,model,error)}catch{}
 }
 function launch(row,run){
  const attempt={};run.attempt=attempt;
  const current=()=>pendingCurrent(row,run)&&run.attempt===attempt;
  const active=()=>current()&&someActive(run);
  Promise.resolve().then(()=>{
   if(!active())throw aborted();
   // The shared request belongs to every live consumer. A caller's own signal
   // cannot abort another consumer's read; admission is checked per attempt.
   const {active:ignoredActive,onStart:ignoredStart,signal:ignoredSignal,fresh:ignoredFresh,priority:ignoredPriority,...options}=run.options;
   return request(row.workspace,'notifications',row.args,{...options,priority:run.priority,active,onStart:()=>{if(!active()||run.started)return;run.started=true;for(const consumer of run.consumers)if(consumer.active())try{consumer.onStart?.()}catch{}}});
  }).then(value=>{
   if(!current())return;if(!someActive(run)){finish(row,run,aborted());return}
   row.value=null;row.bytes=0;
   if(Array.isArray(value?.data?.notifications)){
    let bytes;try{bytes=JSON.stringify(value).length*2}catch{}
    if(Number.isFinite(bytes)&&bytes<=byteLimit){row.value=value;row.at=now();row.bytes=bytes;touch(row)}
   }
   finish(row,run,null,value);if(!row.value&&entries.get(row.key)===row)entries.delete(row.key);trim();
  },error=>{
   if(!current())return;
   if(denied(error)){invalidate(row.workspace,row.model,error,run);return}
   finish(row,run,error);
  });
 }
 async function independent(workspace,operation,args,options){
  const epoch=generation,key=modelKey(workspace,args.creator_id),modelVersion=version(key),consumer=options.active||(()=>true);
  const current=()=>generation===epoch&&version(key)===modelVersion;
  const active=()=>current()&&!options.signal?.aborted&&consumer();
  if(!active())throw aborted();
  try{const value=await request(workspace,operation,args,{...options,active});if(!active())throw aborted();return value}
  catch(error){const requested=active();if(current()&&denied(error)&&key)invalidate(workspace,args.creator_id,error);if(!requested)throw aborted();throw error}
 }
 return {
  async request(workspace,operation,args={},options={}){
   if(options.signal?.aborted||options.active?.()===false)throw aborted();
   if(operation!=='notifications')return request(workspace,operation,args,options);
   const descriptor=head(workspace,args);if(!descriptor)return independent(workspace,operation,args,options);
   const epoch=generation,modelVersion=version(descriptor.modelScope),external=options.active||(()=>true);
   const active=()=>generation===epoch&&version(descriptor.modelScope)===modelVersion&&!options.signal?.aborted&&external();
   if(!active())throw aborted();trim();
   let row=entries.get(descriptor.key);
   if(row?.value&&!options.fresh&&now()-row.at<=responseTtl){touch(row);return row.value}
   if(!row){row={...descriptor,value:null,at:0,bytes:0,run:null};entries.set(row.key,row)}
   let run=row.run,created=false;
   if(!run){
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
    run={promise,resolve,reject,epoch,version:modelVersion,consumers:new Set(),priority:options.priority||'background',options,started:false,finished:false};row.run=run;created=true;
   }
   const consumer={active,onStart:options.onStart};run.consumers.add(consumer);
   if(run.started&&active())try{consumer.onStart?.()}catch{}
   if(created)launch(row,run);
   else if(!run.started&&run.priority==='background'&&options.priority==='selected'){
    // Replace only queued admission. Old attempt callbacks cannot settle the
    // stable promise, so existing consumers follow the promoted request too.
    run.priority='selected';run.options=options;launch(row,run);
   }
   try{const value=await run.promise;if(!active())throw aborted();return value}
   catch(error){if(run.denial===error&&generation===epoch&&version(row.modelScope)===run.denialVersion&&!options.signal?.aborted&&external())throw error;if(!active())throw aborted();throw error}
   finally{run.consumers.delete(consumer)}
  },
  peek(workspace,args={}){const descriptor=head(workspace,args);if(!descriptor)return null;trim();const row=entries.get(descriptor.key);if(!row?.value)return null;touch(row);return row.value},
  invalidate,
  subscribeInvalidation(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  clear(){generation++;for(const row of entries.values())if(row.run)finish(row,row.run,aborted());entries.clear();versions.clear();notify({all:true})},
 };
}
