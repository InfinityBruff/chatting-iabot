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
export function historicalSum(months,key){
 if(!Array.isArray(months)||!months.length||months.some(x=>!x.label||!Number.isFinite(x[key])))return null;
 if(new Set(months.map(x=>x.label)).size!==months.length)return null;
 return months.reduce((sum,x)=>sum+Math.round(x[key]*100),0)/100;
}
export function historicalRange(months,now=new Date()){
 if(!Array.isArray(months)||!months.length)return null;
 const labels=months.map(m=>typeof m.label==='string'?m.label.slice(0,7):'');
 if(labels.some(m=>!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m))||new Set(labels).size!==labels.length)return null;
 const start=labels.sort()[0]+'-01',end=now.toISOString().slice(0,10);
 return start<'2016-01-01'||start>end?null:{start,end};
}
