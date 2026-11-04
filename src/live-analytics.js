// Only known monetary fields are formatted as money. Counts/deltas are never inferred as USD.
const chartDate=point=>typeof point?.date==='string'?point.date:typeof point?.datetime==='string'?point.datetime:null;
export function earningsCategories(series){
 if(!series||typeof series!=='object')return [];
 return Object.entries(series).filter(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)).map(([key,v])=>{
  const counts=Array.isArray(v.chartCount)?v.chartCount:[],dated=counts.some(p=>chartDate(p)!==null),byDate=new Map();
  for(const point of counts){const date=chartDate(point);if(date!==null)byDate.set(date,byDate.has(date)?null:point)}
  return {key,
   gross:typeof v.gross==='number'&&Number.isFinite(v.gross)?v.gross:null,
   total:typeof v.total==='number'&&Number.isFinite(v.total)?v.total:null,
   points:Array.isArray(v.chartAmount)?v.chartAmount.map((p,i)=>{
    const date=chartDate(p),count=dated?(date===null?null:byDate.get(date)):counts[i];
    return {label:date??`Punto ${i+1}`,amount:typeof p?.count==='number'&&Number.isFinite(p.count)?p.count:null,operations:typeof count?.count==='number'&&Number.isFinite(count.count)?count.count:null};
   }):[]
  };
 }).filter(v=>v.gross!==null||v.total!==null||v.points.length);
}
export function analyticsRange(preset,now=new Date()){
 const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));let start=new Date(end);
 if(preset==='last-month'){start=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-1,1));end.setUTCDate(0)}
 else if(preset==='month')start.setUTCDate(1);
 else start.setUTCDate(start.getUTCDate()-29);
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
function historicalMonths(months,now){
 if(!Array.isArray(months)||!months.length||!(now instanceof Date)||!Number.isFinite(now.getTime()))return null;
 const latest=now.toISOString().slice(0,7),labels=[];
 for(const row of months){
  if(typeof row?.label!=='string')return null;
  const match=/^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01])(?:T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?)?$/.exec(row.label);
  if(!match)return null;
  const month=match[1]+'-'+match[2];if(month<'2016-01'||month>latest)return null;
  if(match[3]&&Number(match[3])>new Date(Date.UTC(Number(match[1]),Number(match[2]),0)).getUTCDate())return null;
  labels.push(month);
 }
 return new Set(labels).size===labels.length?labels:null;
}
export function historicalSum(months,key,now=new Date()){
 if(!historicalMonths(months,now)||months.some(x=>!Number.isFinite(x[key])))return null;
 return months.reduce((sum,x)=>sum+Math.round(x[key]*100),0)/100;
}
export function historicalRange(months,now=new Date()){
 const labels=historicalMonths(months,now);if(!labels)return null;
 return {start:labels.sort()[0]+'-01',end:now.toISOString().slice(0,10)};
}
