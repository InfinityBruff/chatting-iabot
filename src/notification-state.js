import {notificationCategory} from './notification-presentation.js';
export {notificationCategories as notificationLabels} from './notification-presentation.js';
export const notificationKey=(user,workspace,account)=>'bruff-notifications:'+JSON.stringify([user,workspace,account]);
export function freshNotifications(rows,baseline,known){return rows.filter(n=>n.id&&!known.has(n.id)&&Number.isFinite(Date.parse(n.createdAt))&&Date.parse(n.createdAt)>baseline)}
export function combineNotifications(previous,incoming){return [...new Map([...previous,...incoming].map(n=>[n.id,n])).values()].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0))}
export function readNotificationState(key){try{const s=JSON.parse(localStorage.getItem(key));if(Number.isFinite(s?.baseline)&&Array.isArray(s.reviewed))return {...s,sections:s.sections&&typeof s.sections==='object'?s.sections:{}}}catch{}return {baseline:Date.now(),reviewed:[],sections:{}}}

export function notificationPending(state,n,section='all'){
 if(!n?.id||!(Date.parse(n.createdAt)>state.baseline))return false;
 if(!['all','sidebar'].includes(section)&&notificationCategory(n)!==section)return false;
 return !(state.sections?.[section]||state.reviewed||[]).includes(n.id);
}
export function reviewNotificationSection(state,rows,section){
 const ids=rows.filter(n=>['all','sidebar'].includes(section)||notificationCategory(n)===section).map(n=>n.id).filter(Boolean);
 return {...state,sections:{...state.sections,[section]:[...new Set([...(state.sections?.[section]||state.reviewed||[]),...ids])]}};
}
