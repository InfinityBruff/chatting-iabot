// Geometry belongs to rendered rows, whose height changes with screen width.
// Return actual visible fans before a small near-viewport buffer.
export function spendViewportIds(entries,viewport,{overscan=4}={}){
 if(!viewport||viewport.width<=0||viewport.height<=0)return [];
 const valid=entries.filter(row=>typeof row.id==='string'&&/^\d{1,24}$/.test(row.id)&&Number.isFinite(row.top)&&Number.isFinite(row.bottom)&&row.bottom>row.top).sort((a,b)=>a.index-b.index);
 const visible=valid.filter(row=>row.bottom>viewport.top&&row.top<viewport.bottom);
 const nearby=valid.filter(row=>row.bottom<=viewport.top||row.top>=viewport.bottom).sort((a,b)=>Math.max(viewport.top-a.bottom,a.top-viewport.bottom,0)-Math.max(viewport.top-b.bottom,b.top-viewport.bottom,0)||a.index-b.index).slice(0,overscan);
 return [...new Set([...visible,...nearby].map(row=>row.id))];
}
export function spendViewportDemand(selectedId,ids,active){return active?[...new Set([...(selectedId?[String(selectedId)]:[]),...ids])]:[]}
