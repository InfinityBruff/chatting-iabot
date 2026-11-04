import {spendTime} from './inbox-spend.js';
export const fanRecordPriority=(kind,summaryVisible)=>kind==='profile'&&summaryVisible?'selected':'background';
export function fanSectionFresh(value,now=Date.now(),ttl=30000){const stamp=spendTime(value?.updated);return !!value?.data&&Number.isFinite(stamp)&&stamp<=now&&now-stamp<ttl}
export function adoptFanSpend(current,spend,checkedAt){
 if(!spend||typeof spend.available!=='boolean')return current;
 const stamp=spendTime(checkedAt),previous=spendTime(current?.updated);
 if(Number.isFinite(stamp)&&(!Number.isFinite(previous)||stamp>previous))return {data:spend,busy:false,updated:new Date(stamp).toISOString()};
 // Legacy rows can be displayed immediately, but never overwrite a newer
 // confirmed read or acquire a fabricated "consulted now" timestamp.
 return !current?.data&&spend.available?{data:spend,busy:false}:current;
}
// Profile data feeds two visible consumers: the upper subscription summary and
// the lower profile section. One leaving view must not cancel the other.
export function createFanSectionDemand(){
 const consumers=new Map([['note',new Set(['notes'])]]);
 return {
  set(kind,source,visible){const group=consumers.get(kind)||new Set();if(visible)group.add(source);else group.delete(source);if(group.size)consumers.set(kind,group);else consumers.delete(kind)},
  has:kind=>consumers.has(kind),
  [Symbol.iterator]:()=>consumers.keys(),
 };
}
