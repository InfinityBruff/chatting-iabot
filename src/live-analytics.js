// Only known monetary fields are formatted as money. Counts/deltas are never inferred as USD.
export function earningsCategories(series){
 if(!series||typeof series!=='object')return [];
 return Object.entries(series).filter(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)).map(([key,v])=>({key,
 gross:typeof v.gross==='number'&&Number.isFinite(v.gross)?v.gross:null,
 total:typeof v.total==='number'&&Number.isFinite(v.total)?v.total:null,
 points:Array.isArray(v.chartAmount)?v.chartAmount.map((p,i)=>({label:typeof p.date==='string'?p.date:typeof p.datetime==='string'?p.datetime:`Punto ${i+1}`,amount:typeof p.count==='number'&&Number.isFinite(p.count)?p.count:null,operations:typeof v.chartCount?.[i]?.count==='number'?v.chartCount[i].count:null})):[]
 })).filter(v=>v.gross!==null||v.total!==null||v.points.length);
}
