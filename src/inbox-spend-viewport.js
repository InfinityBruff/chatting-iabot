// Geometry belongs to rendered rows, whose height changes with screen width.
// Return actual visible fans before a small near-viewport buffer.
export function spendViewportIds(entries,viewport,{overscan=4,aheadScreens=1,maxAhead=20}={}){
 if(!viewport||viewport.width<=0||viewport.height<=0)return [];
 const valid=entries.filter(row=>typeof row.id==='string'&&/^\d{1,24}$/.test(row.id)&&Number.isFinite(row.top)&&Number.isFinite(row.bottom)&&row.bottom>row.top).sort((a,b)=>a.index-b.index);
 const visible=valid.filter(row=>row.bottom>viewport.top&&row.top<viewport.bottom);
 const ahead=valid.filter(row=>row.top>=viewport.bottom&&row.top<viewport.bottom+viewport.height*Math.max(0,aheadScreens)).slice(0,maxAhead);
 const nearby=valid.filter(row=>row.bottom<=viewport.top).sort((a,b)=>viewport.top-a.bottom-(viewport.top-b.bottom)||a.index-b.index).slice(0,overscan);
 return [...new Set([...visible,...ahead,...nearby].map(row=>row.id))];
}
export function spendViewportDemand(selectedId,ids,active){return active?[...new Set([...(selectedId?[String(selectedId)]:[]),...ids])]:[]}

// Keep observation attached to stable keyed row nodes as pages append or reorder.
export function createSpendViewportRegistry(initialObserver){
 let observer=initialObserver,positions=new Map(),nodes=new Set();const nearby=new Set();
 return {
  sync(ids,elements){positions=new Map(ids.map((id,index)=>[id,index]));const next=new Set([...elements].filter(node=>positions.has(node.dataset.fanId)));for(const node of nodes)if(!next.has(node)){observer.unobserve(node);nearby.delete(node)}for(const node of next)if(!nodes.has(node))observer.observe(node);nodes=next},
  accept(entries){for(const entry of entries)if(nodes.has(entry.target))entry.isIntersecting?nearby.add(entry.target):nearby.delete(entry.target)},
  entries(){return [...nearby].map(node=>{const box=node.getBoundingClientRect(),id=node.dataset.fanId;return {id,index:positions.get(id),top:box.top,bottom:box.bottom}})},
  replaceObserver(next){observer.disconnect();observer=next;for(const node of nodes)observer.observe(node)},
  disconnect(){observer.disconnect();nodes.clear();nearby.clear();positions.clear()},
 };
}
// A continuing scroll still gets measurements; waiting for scroll-idle can
// otherwise cancel every spend batch until the user stops moving.
export function createSpendViewportSampler(measure,{now=Date.now,schedule=setTimeout,cancel=clearTimeout,interval=100}={}){
 let active=true,timer=null,last=-Infinity;
 return {queue(){if(!active||timer!==null)return;timer=schedule(()=>{timer=null;if(!active)return;last=now();measure()},Math.max(0,last+interval-now()))},stop(){active=false;cancel(timer);timer=null}};
}
