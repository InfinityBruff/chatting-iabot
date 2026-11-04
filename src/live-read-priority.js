import {secondaryReads,foregroundReads} from './live-read-scheduler.js';
const explicitFinancialCategories=new Set(['total','messages','tips','subscriptions','posts','streams','referrals']);
export function pageReadBackground(operation,{cursor,background,priority}={}){
 return background===true||operation==='inbox'&&!!cursor&&(priority==='background'||priority==='prefetch');
}
export function pageReadPriority(operation,{cursor,background,preparing=false,priority,category}={}){
 if(preparing)return 'history-prepare';
 if(cursor){
  if(operation==='messages')return 'history';
  if(operation==='inbox'&&['background','pagination','prefetch'].includes(priority))return priority;
  return 'pagination';
 }
 if(background)return 'refresh';
 // Selected reports may overtake queued background scans, within the same
 // secondary lane and its existing idle, spacing and provider quota checks.
 if(['monthly','balances','transactions'].includes(operation)||operation==='earnings'&&explicitFinancialCategories.has(category))return 'selected';
 return operation==='messages'?'conversation':secondaryReads.has(operation)?'background':'interactive';
}
export function scheduleLiveRead(scheduler,operation,run,{active,priority}={}){
 if(operation==='inbox'&&(priority==='background'||priority==='prefetch'))return scheduler.secondary(run,active,priority);
 return secondaryReads.has(operation)?scheduler.secondary(run,active,priority):foregroundReads.has(operation)?scheduler.primary(run,active,priority):run();
}
