export {notificationCategories as notificationLabels} from './notification-presentation.js';
export const notificationKey=(user,workspace,account)=>'bruff-notifications:'+JSON.stringify([user,workspace,account]);
export function freshNotifications(rows,baseline,known){return rows.filter(n=>n.id&&!known.has(n.id)&&Number.isFinite(Date.parse(n.createdAt))&&Date.parse(n.createdAt)>baseline)}
export function combineNotifications(previous,incoming){return [...new Map([...previous,...incoming].map(n=>[n.id,n])).values()].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0))}
export function readNotificationState(key){try{const s=JSON.parse(localStorage.getItem(key));if(Number.isFinite(s?.baseline)&&Array.isArray(s.reviewed))return s}catch{}return {baseline:Date.now(),reviewed:[]}}
