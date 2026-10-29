// Synthetic reporting dataset: never sourced from the reference service or sent to fans.
export const isoDay = date => new Date(date).toISOString().slice(0,10);
export function shiftDay(day,n){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return isoDay(d)}
export function rangeDays(start,end){if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)return [];const result=[];for(let d=start;d<=end&&result.length<366;d=shiftDay(d,1))result.push(d);return result}
export function demoLedger(fans,today){return fans.flatMap((fan,index)=>Array.from({length:90},(_,i)=>{const date=shiftDay(today,-i),seed=(i*13+(index+1)*7)%31;return {id:`${fan.creatorId}:${fan.id}:${date}`,creatorId:fan.creatorId,fanId:fan.id,fanName:fan.name,date,hour:seed%24,gross:seed%3===0?0:(seed+2)*100,net:seed%3===0?0:(seed+2)*80,ppvSent:seed%4,ppvOpened:seed%4>1?1:0,messages:seed%9,newFan:i===index*5,active:seed%5!==0,replySeconds:20+seed*3,type:['Suscripción','Propina','Contenido PPV'][seed%3]}}))}
export function report(ledger,creatorIds,start,end,basis='net'){
 const records=ledger.filter(r=>creatorIds.includes(r.creatorId)&&r.date>=start&&r.date<=end),unique=rs=>new Set(rs.map(r=>`${r.creatorId}:${r.fanId}`)).size;
 const revenue=records.reduce((s,r)=>s+r[basis],0),paying=unique(records.filter(r=>r.gross>0)),sent=records.reduce((s,r)=>s+r.ppvSent,0),opened=records.reduce((s,r)=>s+r.ppvOpened,0),active=unique(records.filter(r=>r.active)),newFans=unique(records.filter(r=>r.newFan));
 return {records,revenue,paying,arppu:paying?revenue/paying:0,newFans,active,sent,opened,unlock:sent?opened/sent*100:0,messages:records.reduce((s,r)=>s+r.messages,0),reply:records.length?Math.round(records.reduce((s,r)=>s+r.replySeconds,0)/records.length):0};
}
export function chartBuckets(ledger,ids,start,end,basis,group='day',metric='revenue'){
 const days=rangeDays(start,end),buckets=[];for(let i=0;i<days.length;){let stop=group==='week'?Math.min(i+6,days.length-1):i;if(group==='month')while(stop+1<days.length&&days[stop+1].slice(0,7)===days[i].slice(0,7))stop++;
 const r=report(ledger,ids,days[i],days[stop],basis);buckets.push({start:days[i],end:days[stop],value:r[metric]});i=stop+1}return buckets;
}
export function csvCell(value){return '"'+String(value).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"'}
