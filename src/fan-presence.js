// A missing result is unknown, never an offline assertion. Presence expires locally.
export function isFanOnline(fan,now=Date.now()){
 const checked=Date.parse(fan?.presence?.checkedAt);
 return fan?.presence?.online===true&&Number.isFinite(checked)&&now>=checked&&now-checked<60000;
}

export function applyPresence(fans,presence){
 if(!presence)return fans;const ids=new Set(presence.onlineIds||[]);
 return fans.map(f=>{const key=String(f.userId??f.id),stamp=presence.confirmations?.[key];return {...f,presence:{online:stamp||ids.has(key)?true:null,checkedAt:stamp||presence.checkedAt}}});
}
