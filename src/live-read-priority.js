import {secondaryReads,foregroundReads} from './live-read-scheduler.js';
export function pageReadBackground(operation,{cursor,background,priority}={}){
 return background===true||operation==='inbox'&&!!cursor&&(priority==='background'||priority==='prefetch');
}
export function pageReadPriority(operation,{cursor,background,preparing=false,priority}={}){
 if(preparing)return 'history-prepare';
 if(cursor){
  if(operation==='messages')return 'history';
  if(operation==='inbox'&&['background','pagination','prefetch'].includes(priority))return priority;
  return 'pagination';
 }
 if(background)return 'refresh';
 return operation==='messages'?'conversation':secondaryReads.has(operation)?'background':'interactive';
}
export function scheduleLiveRead(scheduler,operation,run,{active,priority}={}){
 if(operation==='inbox'&&(priority==='background'||priority==='prefetch'))return scheduler.secondary(run,active,priority);
 return secondaryReads.has(operation)?scheduler.secondary(run,active,priority):foregroundReads.has(operation)?scheduler.primary(run,active,priority):run();
}
