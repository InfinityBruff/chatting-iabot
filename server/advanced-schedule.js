import {validateSchedule} from '../src/automation-schedule.js';
// Server-side schedule planning only. No timer, database writes or provider calls.
export function massExecutionSchedule(config,activatedAt){
 const activation=Date.parse(activatedAt);
 if(config?.trigger!=='mass'||!Number.isFinite(activation))throw Error('Activación de masivo inválida');
 const b=config.bulk,error=validateSchedule({...b,type:'mass'},activation);if(error)throw Error(error);
 if(!['manual','scheduled'].includes(b.schedule)||typeof b.repeat!=='boolean')throw Error('Programación inválida');
 const start=b.schedule==='scheduled'?Date.parse(b.at):activation;
 const interval=b.repeat?Number(b.intervalMinutes)*60000:null;
 let count=1,end=start+86400000;
 if(b.repeat){
  if(b.endMode==='runs'){count=Number(b.maxRuns);end=start+count*interval}
  else{end=b.endMode==='date'?Date.parse(b.endAt):start+Number(b.durationMinutes)*60000;count=Math.ceil((end-start)/interval)}
 }
 if(!Number.isSafeInteger(count)||count<1||count>8760||!Number.isFinite(end)||end<=start)throw Error('Intervalo de ejecución inválido');
 return {startAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),intervalMs:interval,cycles:count,missedPolicy:'skip',singleDeliveryWindowHours:b.repeat?null:24};
}
export function nextMassCycle(schedule,{now=Date.now(),lastCycle=-1}={}){
 const start=Date.parse(schedule.startAt),end=Date.parse(schedule.endsAt),interval=schedule.intervalMs;
 if(!Number.isFinite(now)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isSafeInteger(lastCycle)||lastCycle< -1||!Number.isSafeInteger(schedule.cycles)||schedule.cycles<1||(interval!==null&&(!Number.isSafeInteger(interval)||interval<3600000)))throw Error('Estado de programación inválido');
 if(now>=end||lastCycle>=schedule.cycles-1)return {status:'completed'};
 if(now<start)return {status:'waiting',nextAt:schedule.startAt};
 const current=interval===null?0:Math.floor((now-start)/interval),cycle=Math.max(lastCycle+1,current);
 if(cycle>=schedule.cycles)return {status:'completed'};
 const due=start+(interval||0)*cycle;
 if(due>now)return {status:'waiting',nextAt:new Date(due).toISOString()};
 return {status:'due',cycle,dueAt:new Date(due).toISOString(),skipped:Math.max(0,cycle-lastCycle-1)};
}
