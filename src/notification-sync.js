export const reviewSections=['sidebar','all','subscribed','purchases','tip','commented','mentioned','favorited','message','deactivated_media'];
export function cloudSections(state){return Object.fromEntries(reviewSections.map(k=>[k,[...new Set(state.sections?.[k]||state.reviewed||[])]]))}
export function mergeReviewState(local,remote){const a=cloudSections(local),b=cloudSections(remote);return {baseline:remote.baseline,reviewed:[],sections:Object.fromEntries(reviewSections.map(k=>[k,[...new Set([...a[k],...b[k]])]]))}}
export function startReviewSync({ids,sync,read,write,status,visible=()=>true,interval=20000,schedule=setTimeout,cancel=clearTimeout}){
 let stopped=false,timer,running=false,again=false;
 async function tick(){if(stopped||!visible())return;if(running){again=true;return}running=true;
  try{for(const id of ids){if(stopped||!visible())return;try{const local=read(id),remote=await sync(id,local.baseline,cloudSections(local));if(stopped)return;write(id,mergeReviewState(read(id),remote));status(id,'')}catch(e){if(stopped)return;status(id,'No se pudo sincronizar la revisión entre dispositivos. Se reintentará automáticamente.',e)}}}
  finally{running=false;if(!stopped){cancel(timer);timer=schedule(tick,again?0:interval);again=false}}
 }
 tick();return {refresh(){cancel(timer);tick()},stop(){stopped=true;cancel(timer)}};
}
