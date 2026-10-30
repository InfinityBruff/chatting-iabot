import {report,shiftDay} from './dashboard.js';
export const fanKey=r=>`${r.creatorId}:${r.fanId}`;
export const sum=(rows,key)=>rows.reduce((n,r)=>n+(Number(r[key])||0),0);
export const pct=(n,d)=>d?n/d*100:0;
export function analyticsEvents(ledger){return ledger.map(r=>({...r,replies:r.messages?Math.ceil(r.messages*1.4):0,sender:r.hour%3===0?'BRUFF · ejemplo':'Equipo · ejemplo',price:1000+(r.hour%5)*500,file:`${r.creatorId}-archivo-${r.hour%4+1}`,fileName:`Archivo de ejemplo ${r.hour%4+1}`,repeat:r.hour%2?'Repetido':'Primera oferta'}))}
export function summarize(records,basis='net'){
 const ids=[...new Set(records.map(r=>r.creatorId))],s=report(records,ids,'0000','9999',basis),buyers=new Map();for(const r of records.filter(r=>r.gross>0))buyers.set(fanKey(r),(buyers.get(fanKey(r))||0)+1);
 return {...s,gross:sum(records,'gross'),sales:records.filter(r=>r.gross>0).length,replies:sum(records,'replies'),conversion:pct(s.paying,new Set(records.map(fanKey)).size),repeat:pct([...buyers.values()].filter(n=>n>1).length,buyers.size),perActive:s.active?s.revenue/s.active:0,ppv:sum(records.filter(r=>r.type==='Contenido PPV'),basis),tips:sum(records.filter(r=>r.type==='Propina'),basis),subs:sum(records.filter(r=>r.type==='Suscripción'),basis),ask:records.reduce((n,r)=>n+r.price*r.ppvOpened,0),avgAsk:s.sent?records.reduce((n,r)=>n+r.price*r.ppvSent,0)/s.sent:0,ai:pct(sum(records.filter(r=>r.sender==='BRUFF · ejemplo'),'replies'),sum(records,'replies'))};
}
export function groupAnalytics(records,dimension,basis='net'){
 const map=new Map();for(const r of records){const key=dimension==='price'?(r.price<2000?'Menos de 20 USD':'20 USD o más'):dimension==='fan'?fanKey(r):String(r[dimension]);if(!map.has(key))map.set(key,[]);map.get(key).push(r)}
 return [...map].map(([id,rs])=>({id,name:dimension==='fan'?rs[0].fanName:dimension==='file'?rs[0].fileName:id,creatorId:rs[0].creatorId,fanId:rs[0].fanId,...summarize(rs,basis)}));
}
export const funnelLabels=['Suscrito','Escribió un mensaje','Escribió 5+ mensajes','Recibió un PPV','Abrió un PPV','Recibió un segundo PPV','Abrió un segundo PPV','Abrió 3 o más'];
export function funnelRows(records,basis='net'){
 return groupAnalytics(records,'fan',basis).filter(r=>r.records.some(e=>e.newFan)).map(r=>{const joined=r.records.find(e=>e.newFan).date,after=r.records.filter(e=>e.date>=joined),s=summarize(after,basis),conditions=[true,s.messages>0,s.messages>=5,s.sent>0,s.opened>0,s.sent>=2,s.opened>=2,s.opened>=3];let stage=0;while(stage+1<conditions.length&&conditions[stage+1])stage++;return {...r,...s,stage,joined}});
}
export function cohortRows(ledger,ids,today,mode='messages'){
 const scoped=ledger.filter(r=>ids.includes(r.creatorId)),joined=scoped.filter(r=>r.newFan),cohorts=new Map(),joinDates=new Map(joined.map(r=>[fanKey(r),r.date]));for(const r of joined){const weekday=(new Date(r.date+'T00:00:00Z').getUTCDay()+6)%7,week=shiftDay(r.date,-weekday);if(!cohorts.has(week))cohorts.set(week,new Set());cohorts.get(week).add(fanKey(r))}
 return [...cohorts].sort((a,b)=>b[0].localeCompare(a[0])).map(([week,keys])=>({week,count:keys.size,cells:Array.from({length:9},(_,i)=>{const start=shiftDay(week,i*7),end=shiftDay(start,6);if(end>today)return null;const rs=scoped.filter(r=>keys.has(fanKey(r))&&r.date>=start&&r.date<=end&&r.date>=joinDates.get(fanKey(r)));const eligible=rs.filter(r=>mode==='paying'?r.gross>0:r.messages>0);return {value:mode==='revenue'?sum(rs,'net')/keys.size:pct(new Set(eligible.map(fanKey)).size,keys.size),records:rs}})}));
}
export function hourlySeries(records,key,basis='net',cumulative=true){return Array.from({length:24},(_,hour)=>{const rs=records.filter(r=>cumulative?r.hour<=hour:r.hour===hour);return summarize(rs,basis)[key]||0})}
