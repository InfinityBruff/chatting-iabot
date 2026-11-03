const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
export function scrollAheadDistance({viewport=400,velocity=0,latencyMs=1000,kind='inbox'}={}){
 const height=Math.max(100,finite(viewport,400)),speed=Math.min(8,Math.abs(finite(velocity,0))),latency=Math.min(15000,Math.max(500,finite(latencyMs,1000)));
 const base=kind==='history'?Math.max(600,height*1.5):Math.max(1000,height*2);
 return Math.min(20000,Math.max(base,speed*latency*1.25));
}
export function createScrollMotion({now=Date.now}={}){
 let position=null,at=0,speed=0;
 return {
  reset(top=0){position=top;at=now();speed=0},
  sample(top){const time=now(),elapsed=time-at,delta=position===null?0:top-position;if(elapsed>0&&elapsed<400&&Math.abs(delta)>1){const next=Math.max(-8,Math.min(8,delta/elapsed));speed=Math.sign(next)!==Math.sign(speed)?next:speed*.4+next*.6}else speed=0;position=top;at=time;return speed},
  velocity(){return now()-at>300?0:speed}
 };
}
