import {secondaryReads,foregroundReads} from './live-read-scheduler.js';
const explicitFinancialCategories=new Set(['total','messages','tips','subscriptions','posts','streams','referrals']);
export function fanVisibleRead(operation,args={},priority){
 if(priority!=='fan-visible')return false;
 if(operation==='fan_spend_batch')return Array.isArray(args.user_ids)&&args.user_ids.length>0&&args.user_ids.length<=20&&args.user_ids.every(id=>typeof id==='string'&&/^\d{1,24}$/.test(id));
 if(operation==='presence')return args.cursor==null||typeof args.cursor==='string'&&args.cursor.length<=2048;
 return ['fan_profile','fan_history','fan_spend','fan_activity'].includes(operation)&&typeof args.conversation_id==='string'&&/^\d{1,24}$/.test(args.conversation_id)&&(operation!=='fan_activity'||args.cursor==null);
}
export function liveReadArgs(operation,args={},options={}){
 const {foreground,...parameters}=args;
 return fanVisibleRead(operation,parameters,options.priority)?{...parameters,foreground:true}:parameters;
}
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
export function scheduleLiveRead(scheduler,operation,run,{active,priority}={},args={}){
 if(fanVisibleRead(operation,args,priority))return scheduler.primary(run,active,'fan-visible');
 if(priority==='fan-visible')priority=undefined;
 if(operation==='inbox'&&(priority==='background'||priority==='prefetch'))return scheduler.secondary(run,active,priority);
 return secondaryReads.has(operation)?scheduler.secondary(run,active,priority):foregroundReads.has(operation)?scheduler.primary(run,active,priority):run();
}
