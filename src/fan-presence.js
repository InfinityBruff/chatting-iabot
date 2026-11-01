// A missing result is unknown, never an offline assertion. Presence expires locally.
export function isFanOnline(fan,now=Date.now()){
 const checked=Date.parse(fan?.presence?.checkedAt);
 return fan?.presence?.online===true&&Number.isFinite(checked)&&now>=checked&&now-checked<60000;
}

export function applyPresence(fans,presence){
 if(!presence)return fans;const ids=new Set(presence.onlineIds||[]);
 return fans.map(f=>({...f,presence:{online:ids.has(String(f.userId??f.id))?true:null,checkedAt:presence.checkedAt}}));
}
